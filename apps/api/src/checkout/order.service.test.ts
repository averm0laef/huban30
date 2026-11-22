import { randomUUID } from "node:crypto";

import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import { CryptoService } from "../security/crypto.service.js";
import { OrderService } from "./order.service.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function createCrypto() {
  return new CryptoService(new ConfigService({
    DATA_ENCRYPTION_KEY: "test-data-encryption-key-with-more-than-32-characters",
    SESSION_SECRET: "test-session-hmac-secret-with-more-than-32-characters",
  }));
}

const managerAuth: AuthContext = {
  csrfTokenHash: Buffer.alloc(32),
  email: "manager@example.invalid",
  mfaSetupRequired: false,
  mfaVerified: true,
  role: "manager",
  sessionId: randomUUID(),
  userId: randomUUID(),
};

describe("OrderService.updateStatus", () => {
  it("lets a manager confirm a заявка (awaiting_confirmation -> processing) and audits the change", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: "awaiting_confirmation", version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ status: "processing", version: 2 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const database = { transaction: (work: (client: unknown) => unknown) => work({ query }) };
    const record = vi.fn().mockResolvedValue(undefined);
    const service = new OrderService(
      { record } as unknown as AuditService,
      createCrypto(),
      database as unknown as DatabaseService,
    );

    const result = await service.updateStatus(
      ORDER_ID,
      { reason: "Подтвердил по телефону", status: "processing", version: 1 },
      managerAuth,
      {},
    );

    expect(result.status).toBe("processing");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "order.status_changed" }),
      expect.anything(),
    );
  });

  it("refuses to skip straight from awaiting_confirmation to completed", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: "awaiting_confirmation", version: 1 }] });
    const database = { transaction: (work: (client: unknown) => unknown) => work({ query }) };
    const service = new OrderService(
      { record: vi.fn() } as unknown as AuditService,
      createCrypto(),
      database as unknown as DatabaseService,
    );

    await expect(service.updateStatus(
      ORDER_ID,
      { reason: "Пропускаем этапы", status: "completed", version: 1 },
      managerAuth,
      {},
    )).rejects.toBeInstanceOf(ConflictException);
    // Only the lock-read happened; no UPDATE or history insert was attempted.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale version instead of silently applying a change nobody re-read", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: "awaiting_confirmation", version: 2 }] });
    const database = { transaction: (work: (client: unknown) => unknown) => work({ query }) };
    const service = new OrderService(
      { record: vi.fn() } as unknown as AuditService,
      createCrypto(),
      database as unknown as DatabaseService,
    );

    await expect(service.updateStatus(
      ORDER_ID,
      { reason: "Устаревшая версия", status: "processing", version: 1 },
      managerAuth,
      {},
    )).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("OrderService.list", () => {
  it("shows staff every заявка, but a customer only their own", async () => {
    const rows = [{
      created_at: new Date("2026-08-30T10:00:00Z"),
      customer_name: "Клиент",
      id: ORDER_ID,
      public_number: "AN-20260830-TEST",
      status: "awaiting_confirmation",
      total_amount_kopeks: "9000",
      version: 1,
    }];
    const query = vi.fn().mockResolvedValue({ rows });
    const service = new OrderService(
      { record: vi.fn() } as unknown as AuditService,
      createCrypto(),
      { query } as unknown as DatabaseService,
    );

    const staffResult = await service.list(managerAuth, {});
    expect(staffResult[0]?.status).toBe("awaiting_confirmation");
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [true, managerAuth.userId, 20]);

    const customerAuth: AuthContext = { ...managerAuth, role: "customer" };
    await service.list(customerAuth, {});
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [false, customerAuth.userId, 20]);
  });
});

describe("OrderService.readForGuest", () => {
  it("grants access with the right guest token, checked against orders.guest_token_hash directly", async () => {
    const crypto = createCrypto();
    const token = crypto.randomToken();
    const tokenHash = crypto.opaqueHash("guest-order-access", token);
    const orderRow = {
      contact_snapshot: { email: "buyer@example.invalid", name: "Гость", phone: "+79141234567" },
      created_at: new Date("2026-08-30T10:00:00Z"),
      customer_note: null,
      delivery_snapshot: { method: "pickup" },
      guest_token_hash: tokenHash,
      id: ORDER_ID,
      public_number: "AN-20260830-TEST",
      status: "awaiting_confirmation",
      subtotal_kopeks: "9000",
      total_amount_kopeks: "9000",
      user_id: null,
      version: 1,
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // ownership check
      .mockResolvedValueOnce({ rows: [orderRow] }) // order detail
      .mockResolvedValueOnce({ rows: [] }); // order items
    const service = new OrderService(
      { record: vi.fn() } as unknown as AuditService,
      crypto,
      { query } as unknown as DatabaseService,
    );

    const detail = await service.readForGuest(ORDER_ID, token);
    expect(detail.status).toBe("awaiting_confirmation");
    // The ownership check runs against orders.guest_token_hash, keyed by this
    // exact token's hash -- no stock_reservations join left to route through.
    expect(query.mock.calls[0]?.[1]).toEqual([ORDER_ID, tokenHash]);
  });

  it("refuses a token that does not own the order", async () => {
    const crypto = createCrypto();
    const wrongToken = crypto.randomToken();
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const service = new OrderService(
      { record: vi.fn() } as unknown as AuditService,
      crypto,
      { query } as unknown as DatabaseService,
    );

    await expect(service.readForGuest(ORDER_ID, wrongToken)).rejects.toBeInstanceOf(NotFoundException);
  });
});
