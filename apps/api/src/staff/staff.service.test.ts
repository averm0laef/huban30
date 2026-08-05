import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import type { ChatEventBus } from "../chat/chat-event-bus.service.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import {
  canIssueInvoiceForOrder,
  canManagerChangeAssignment,
  canReopenRequest,
  canReopenChat,
  StaffService,
} from "./staff.service.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "33333333-3333-4333-8333-333333333333";

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

describe("StaffService.updateChat realtime broadcast", () => {
  const auth: AuthContext = {
    csrfTokenHash: Buffer.alloc(32),
    email: "manager@example.test",
    mfaSetupRequired: false,
    mfaVerified: true,
    role: "manager",
    sessionId: "44444444-4444-4444-8444-444444444444",
    userId: STAFF_ID,
  };

  it("publishes the new assignment only after the update actually commits, with the real assignee name", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ assigned_staff_id: null, status: "waiting_staff", version: 1 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        assigned_staff_id: STAFF_ID, closed_at: null, status: "waiting_staff", version: 2,
      }] })
      .mockResolvedValueOnce({ rows: [{ display_name: "Ирина Соколова" }] });
    const database = { transaction: (work: (client: unknown) => unknown) => work({ query }) };
    const publish = vi.fn().mockResolvedValue(undefined);
    const record = vi.fn().mockResolvedValue(undefined);
    const service = new StaffService(
      { record } as unknown as AuditService,
      { publish } as unknown as ChatEventBus,
      database as unknown as DatabaseService,
    );

    const result = await service.updateChat(
      THREAD_ID,
      { assignedStaffId: STAFF_ID, reason: "Взял чат себе", version: 1 },
      auth,
      {},
    );

    expect(result.assignedStaffId).toBe(STAFF_ID);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      payload: {
        assignedStaffId: STAFF_ID,
        assignedStaffName: "Ирина Соколова",
        status: "waiting_staff",
        type: "thread",
      },
      threadId: THREAD_ID,
    });
    // The publish call must happen after every DB call the transaction made
    // (i.e. after commit), never interleaved before the update lands.
    expect(publish.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...query.mock.invocationCallOrder),
    );
  });

  it("never broadcasts when the update is rejected (stale version, no real change)", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ assigned_staff_id: STAFF_ID, status: "waiting_staff", version: 5 }] });
    const database = { transaction: (work: (client: unknown) => unknown) => work({ query }) };
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = new StaffService(
      { record: vi.fn() } as unknown as AuditService,
      { publish } as unknown as ChatEventBus,
      database as unknown as DatabaseService,
    );

    await expect(service.updateChat(
      THREAD_ID,
      { assignedStaffId: STAFF_ID, reason: "Устаревшая версия", version: 1 },
      auth,
      {},
    )).rejects.toThrow();

    expect(publish).not.toHaveBeenCalled();
  });
});

// Regression guard for the "chat messages never reach the staff workspace"
// bug: a fresh, unassigned guest thread (no status/assignment/search filter
// applied) must come back from the default queue view. This asserts on the
// actual SQL/params sent to Postgres — not just on a canned mock response —
// because a mock that simply echoes back "the thread is visible" regardless
// of the filters the service builds would pass even if a real WHERE clause
// silently excluded it, which is exactly the class of bug a fixture can
// paper over. The row fixture mirrors a thread reproduced live against
// staging (see chat.service.ts createForGuest + insertMessage): guest-only
// (customer_user_id/customer_email null), unassigned, status flipped to
// 'waiting_staff' by the guest's first message.
describe("StaffService.chats visibility of a brand-new guest thread", () => {
  const auth: AuthContext = {
    csrfTokenHash: Buffer.alloc(32),
    email: "director@example.test",
    mfaSetupRequired: false,
    mfaVerified: true,
    role: "director",
    sessionId: "55555555-5555-4555-8555-555555555555",
    userId: STAFF_ID,
  };
  const freshGuestThreadRow = {
    assigned_name: null,
    assigned_staff_id: null,
    created_at: new Date("2026-08-05T08:30:01.670Z"),
    customer_email: null,
    customer_name: null,
    id: THREAD_ID,
    last_message_at: new Date("2026-08-05T08:30:17.433Z"),
    last_message_body: "Здравствуйте, у меня вопрос по заказу",
    order_id: null,
    order_number: null,
    status: "waiting_staff",
    subject: "Диагностика бага AN30-QA",
    unread_count: "1",
    version: 2,
  };

  it("applies no status/assignment filter for the default 'any' queue view, and surfaces the guest thread", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [freshGuestThreadRow] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });
    const database = { query } as unknown as DatabaseService;
    const service = new StaffService(
      {} as AuditService,
      {} as ChatEventBus,
      database,
    );

    const result = await service.chats({}, auth);

    const [rowsSql, rowsParams] = query.mock.calls[0] as [string, unknown[]];
    expect(rowsSql).toContain("thread.deleted_at IS NULL");
    // StaffChatsQuerySchema defaults to assigned:"any" and no status — the
    // query must therefore pass through every non-deleted thread, unassigned
    // or not, exactly like a fresh guest thread with nobody on it yet.
    expect(rowsParams[0]).toBeNull(); // status filter
    expect(rowsParams[1]).toBeNull(); // assignedStaffId filter
    expect(rowsParams[2]).toBe(false); // "only unassigned" restriction
    expect(result.items).toEqual([expect.objectContaining({
      assignedStaffId: null,
      customerName: "Гость",
      id: THREAD_ID,
      status: "waiting_staff",
      unreadCount: 1,
    })]);
  });

  it("also surfaces it when a manager explicitly asks for unassigned threads", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [freshGuestThreadRow] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });
    const database = { query } as unknown as DatabaseService;
    const service = new StaffService(
      {} as AuditService,
      {} as ChatEventBus,
      database,
    );

    const result = await service.chats({ assigned: "unassigned" }, auth);

    const [, rowsParams] = query.mock.calls[0] as [string, unknown[]];
    expect(rowsParams[2]).toBe(true); // "only unassigned" now active
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(THREAD_ID);
  });
});
