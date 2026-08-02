import { describe, expect, it } from "vitest";

import {
  canIssueInvoiceForOrder,
  canManagerChangeAssignment,
  canReopenRequest,
  canReopenChat,
} from "./staff.service.js";

describe("staff workspace policy", () => {
  it("allows only director and admin to reopen closed chats", () => {
    expect(canReopenChat("manager")).toBe(false);
    expect(canReopenChat("customer")).toBe(false);
    expect(canReopenChat("director")).toBe(true);
    expect(canReopenChat("admin")).toBe(true);
  });

  it("allows only director and admin to reopen finished contact requests", () => {
    expect(canReopenRequest("manager")).toBe(false);
    expect(canReopenRequest("customer")).toBe(false);
    expect(canReopenRequest("director")).toBe(true);
    expect(canReopenRequest("admin")).toBe(true);
  });

  it("prevents a manager from taking another employee's chat", () => {
    expect(canManagerChangeAssignment(null, "manager-1", "manager-1")).toBe(true);
    expect(canManagerChangeAssignment("manager-1", null, "manager-1")).toBe(true);
    expect(canManagerChangeAssignment("manager-2", "manager-1", "manager-1")).toBe(false);
    expect(canManagerChangeAssignment("manager-2", null, "manager-1")).toBe(false);
  });

  it("issues invoices only for an eligible order state", () => {
    expect(canIssueInvoiceForOrder("paid")).toBe(true);
    expect(canIssueInvoiceForOrder("completed")).toBe(true);
    expect(canIssueInvoiceForOrder("pending_payment")).toBe(false);
    expect(canIssueInvoiceForOrder("cancelled")).toBe(false);
    expect(canIssueInvoiceForOrder("refunded")).toBe(false);
  });
});
