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
    expect(canIssueInvoiceForOrder("processing")).toBe(true);
    expect(canIssueInvoiceForOrder("completed")).toBe(true);
    expect(canIssueInvoiceForOrder("awaiting_confirmation")).toBe(false);
    expect(canIssueInvoiceForOrder("cancelled")).toBe(false);
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

  it("orders the default queue by who is waiting for an answer, and reports since when", async () => {
    const waitingSince = new Date("2026-08-05T08:30:02.000Z");
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ...freshGuestThreadRow, waiting_since: waitingSince }] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });
    const service = new StaffService({} as AuditService, {} as ChatEventBus, { query } as unknown as DatabaseService);

    const result = await service.chats({}, auth);

    const [rowsSql] = query.mock.calls[0] as [string, unknown[]];
    expect(rowsSql).toMatch(/ORDER BY CASE thread\.status WHEN 'waiting_staff' THEN 0/u);
    expect(result.items[0]).toMatchObject({ waitingSince: waitingSince.toISOString() });
  });

  it("still sorts by the last message when a caller asks for it", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [freshGuestThreadRow] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });
    const service = new StaffService({} as AuditService, {} as ChatEventBus, { query } as unknown as DatabaseService);

    const result = await service.chats({ sort: "lastMessageAt" }, auth);

    const [rowsSql] = query.mock.calls[0] as [string, unknown[]];
    expect(rowsSql).toContain("ORDER BY thread.last_message_at DESC NULLS LAST,thread.id");
    expect(result.items[0]).toMatchObject({ waitingSince: null });
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

describe("chat numbers, avatars and deletion", () => {
  const staff = (role: AuthContext["role"]): AuthContext => ({
    csrfTokenHash: Buffer.alloc(32), email: `${role}@example.test`, mfaSetupRequired: false, mfaVerified: true,
    role, sessionId: "66666666-6666-4666-8666-666666666666", userId: STAFF_ID,
  });
  const row = {
    assigned_name: null, assigned_staff_id: null, created_at: new Date("2026-11-20T08:00:00Z"), customer_avatar_key: null,
    customer_email: null, customer_name: null, customer_user_id: null, id: THREAD_ID, last_message_at: null,
    last_message_body: null, order_id: null, order_number: null, public_number: "123", status: "open", subject: "Колодки",
    unread_count: "0", version: 3,
  };
  function service(query: ReturnType<typeof vi.fn>) {
    const publish = vi.fn().mockResolvedValue(undefined), record = vi.fn().mockResolvedValue(undefined);
    const database = { query, transaction: (work: (client: unknown) => unknown) => work({ query }) };
    return { publish, record, service: new StaffService({ record } as unknown as AuditService, { publish } as unknown as ChatEventBus, database as unknown as DatabaseService) };
  }

  it("lists the chat number and a stable avatar, and finds a chat by «Ч-000123»", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row, { ...row, customer_user_id: STAFF_ID, customer_avatar_key: "customer-07", id: "x", public_number: "7" }] })
      .mockResolvedValueOnce({ rows: [{ count: "2" }] });
    const { service: staffService } = service(query);
    const result = await staffService.chats({ q: "Ч-000123" }, staff("manager"));
    const [rowsSql, rowsParams] = query.mock.calls[0] as [string, unknown[]];
    const [countSql, countParams] = query.mock.calls[1] as [string, unknown[]];
    expect(rowsSql).toContain("thread.public_number=$8::bigint");
    expect(rowsParams[7]).toBe(123);
    expect(countSql).toContain("thread.public_number=$5::bigint");
    expect(countParams[4]).toBe(123);
    expect(result.items[0]).toMatchObject({ number: "Ч-000123", publicNumber: 123 });
    expect(result.items[0]?.customerAvatarKey).toMatch(/^customer-(0[1-9]|1[0-5])$/u);
    expect(result.items[1]).toMatchObject({ customerAvatarKey: "customer-07", number: "Ч-000007" });
  });

  it("does not treat an ordinary search phrase as a chat number", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: "0" }] });
    await service(query).service.chats({ q: "колодки" }, staff("manager"));
    expect((query.mock.calls[0] as [string, unknown[]])[1][7]).toBeNull();
  });

  it("lets only a director or administrator delete, softly, with an audit entry and a closed broadcast", async () => {
    const forbidden = service(vi.fn());
    await expect(forbidden.service.deleteChat(THREAD_ID, { reason: "Спам", version: 3 }, staff("manager"), {})).rejects.toMatchObject({ status: 403 });

    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ public_number: "123", status: "open", version: 3 }] })
      .mockResolvedValueOnce({ rows: [{ deleted_at: new Date("2026-11-21T10:00:00Z") }] });
    const { publish, record, service: staffService } = service(query);
    await expect(staffService.deleteChat(THREAD_ID, { reason: "Спам-рассылка", version: 3 }, staff("admin"), {})).resolves.toMatchObject({ id: THREAD_ID });
    expect(String(query.mock.calls[1]?.[0])).toContain("deleted_at=clock_timestamp()");
    expect(String(query.mock.calls[1]?.[0])).not.toContain("DELETE FROM");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "chat.thread_deleted", beforeState: { number: "Ч-000123", status: "open" }, metadata: { reason: "Спам-рассылка" } }), expect.anything());
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ status: "closed" }), threadId: THREAD_ID }));
  });

  it("refuses to delete a chat that changed meanwhile and never broadcasts", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ public_number: "123", status: "open", version: 4 }] });
    const { publish, service: staffService } = service(query);
    await expect(staffService.deleteChat(THREAD_ID, { reason: "Дубль обращения", version: 3 }, staff("director"), {})).rejects.toMatchObject({ status: 409 });
    expect(publish).not.toHaveBeenCalled();
    await expect(staffService.deleteChat(THREAD_ID, { version: 3 }, staff("admin"), {})).rejects.toMatchObject({ status: 400 });
  });
});
