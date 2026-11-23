import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS } from "@an30/contracts";

import {
  allowedNavigation,
  canOpenSection,
  counterLabel,
  groupedNavigation,
  NAVIGATION,
  NAVIGATION_GROUPS,
  rolesWithAccess,
  sectionCounters,
  serviceSection,
} from "./navigation";
import { STAFF_SECTIONS } from "./sections";

describe("staff navigation", () => {
  it("describes every section exactly once", () => {
    expect(NAVIGATION.map((item) => item.section).sort()).toEqual([...STAFF_SECTIONS].sort());
    expect(new Set(NAVIGATION.map((item) => item.href)).size).toBe(NAVIGATION.length);
  });

  it("puts every grouped section into a known group", () => {
    const known = new Set(NAVIGATION_GROUPS.map((group) => group.id));
    for (const item of NAVIGATION) if (item.group) expect(known.has(item.group)).toBe(true);
  });

  it("shows a manager daily work only", () => {
    expect(allowedNavigation("manager").map((item) => item.section)).toEqual([
      "overview", "orders", "invoices", "requests", "chats", "client-hub", "catalog", "imports",
    ]);
  });

  it("adds reports and staff for a director, everything for an administrator", () => {
    const director = allowedNavigation("director").map((item) => item.section);
    expect(director).toContain("reports");
    expect(director).toContain("staff");
    expect(director).not.toContain("settings");
    expect(director).not.toContain("audit");
    expect(allowedNavigation("admin")).toHaveLength(STAFF_SECTIONS.length);
  });

  it("never lets a customer in, whatever permissions the role has", () => {
    expect(ROLE_PERMISSIONS.customer).toContain("catalog:read");
    expect(allowedNavigation("customer")).toEqual([]);
    expect(canOpenSection("customer", "catalog")).toBe(false);
  });

  it("gives no role fewer sections than the role below it", () => {
    const manager = new Set(allowedNavigation("manager").map((item) => item.section));
    const director = new Set(allowedNavigation("director").map((item) => item.section));
    const admin = new Set(allowedNavigation("admin").map((item) => item.section));
    for (const section of manager) expect(director.has(section)).toBe(true);
    for (const section of director) expect(admin.has(section)).toBe(true);
  });

  it("names who can open a closed section", () => {
    expect(rolesWithAccess("settings")).toEqual(["admin"]);
    expect(rolesWithAccess("reports")).toEqual(["director", "admin"]);
    expect(rolesWithAccess("orders")).toEqual(["manager", "director", "admin"]);
  });

  it("drops a group with no visible sections", () => {
    expect(groupedNavigation("manager").map((group) => group.id)).toEqual(["home", "sales", "customers", "goods"]);
    expect(groupedNavigation("admin").map((group) => group.id)).toEqual(["home", "sales", "customers", "goods", "management"]);
  });

  it("counts only what waits for a person", () => {
    expect(sectionCounters(null)).toEqual({});
    expect(sectionCounters({ chats: { unassigned: 0, waitingStaff: 0 }, orders: { active: 5, awaitingConfirmation: 0, ready: 2 } })).toEqual({});
    expect(sectionCounters({ chats: { unassigned: 1, waitingStaff: 3 }, orders: { active: 5, awaitingConfirmation: 2, ready: 0 } })).toEqual({ chats: 3, orders: 2 });
    expect(counterLabel(7)).toBe("7");
    expect(counterLabel(140)).toBe("99+");
  });

  it("sends a service row to the section where it is set up", () => {
    expect(serviceSection("hub:telegram")).toBe("client-hub");
    expect(serviceSection("hub:vk:АН-30")).toBe("client-hub");
    expect(serviceSection("one_c")).toBe("settings");
    expect(serviceSection("one_c_secondary")).toBe("settings");
    expect(serviceSection("smtp")).toBeNull();
  });
});
