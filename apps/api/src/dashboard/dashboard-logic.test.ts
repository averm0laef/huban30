import { describe, expect, it } from "vitest";

import { hubState, oneCState, parseDashboardRange, percentChange, quotaState, searchLogQuery, zeroShare } from "./dashboard-logic.js";

describe("searchLogQuery", () => {
  it("normalizes case and spaces", () => {
    expect(searchLogQuery("  Колодки   ВЕСТА ")).toBe("колодки веста");
  });
  it("keeps only the manufacturer code of a VIN", () => {
    expect(searchLogQuery("фильтр XTA210990Y2765432")).toBe("фильтр vin:xta…");
  });
  it("drops phones and e-mails", () => {
    expect(searchLogQuery("перезвоните +7 924 474-26-05 masha@mail.ru колодки")).toBe("перезвоните колодки");
  });
  it("returns null for nothing useful", () => {
    expect(searchLogQuery(" +79244742605 ")).toBeNull();
  });
});

describe("numbers", () => {
  it("percentChange handles empty base", () => {
    expect(percentChange(12, 10)).toBe(20);
    expect(percentChange(5, 0)).toBeNull();
  });
  it("zeroShare is one decimal percent", () => {
    expect(zeroShare(412, 26)).toBe(6.3);
    expect(zeroShare(0, 0)).toBeNull();
  });
  it("range falls back to today", () => {
    expect(parseDashboardRange("7d")).toBe("7d");
    expect(parseDashboardRange("year")).toBe("today");
  });
});

describe("service states", () => {
  const now = new Date("2026-11-21T06:00:00Z");
  const run = { error: null, finishedAt: "2026-11-21T05:00:00Z", rejected: 0, status: "completed" as const, touched: 10 };
  it("1С", () => {
    expect(oneCState(false, run, now)).toBe("off");
    expect(oneCState(true, null, now)).toBe("warn");
    expect(oneCState(true, { ...run, status: "failed" }, now)).toBe("error");
    expect(oneCState(true, { ...run, rejected: 3 }, now)).toBe("warn");
    expect(oneCState(true, { ...run, finishedAt: "2026-11-19T00:00:00Z" }, now)).toBe("warn");
    expect(oneCState(true, run, now)).toBe("ok");
  });
  it("bots", () => {
    expect(hubState(false, false, null)).toBe("off");
    expect(hubState(true, false, null)).toBe("warn");
    expect(hubState(true, true, { checks: [{ ok: true }, { ok: false }] })).toBe("error");
    expect(hubState(true, true, { checks: [{ ok: true }] })).toBe("ok");
  });
  it("quotas", () => {
    expect(quotaState(null, null)).toBe("off");
    expect(quotaState(0, 100)).toBe("error");
    expect(quotaState(5, 100)).toBe("warn");
    expect(quotaState(80, 100)).toBe("ok");
  });
});
