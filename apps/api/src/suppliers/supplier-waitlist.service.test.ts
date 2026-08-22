import { describe, expect, it, vi } from "vitest";

import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import { SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION } from "@an30/contracts";

import type { SupplierProvider, SupplierSearchResult } from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import { requestHash, SupplierWaitlistService } from "./supplier-waitlist.service.js";

const SEARCH_RESULT: SupplierSearchResult = {
  message: "OK",
  parts: [{
    brand: "MANN",
    crosses: [{
      brand: "MAHLE",
      crosses: [],
      guid: "cross-guid",
      name: "Аналог",
      partNumber: "OC90",
      stocks: [{ deliveryTime: "3", id: "cross-stock", priceKopeks: 41_000, quantity: 5 }],
    }],
    guid: "part-guid",
    name: "Масляный фильтр",
    partNumber: "W914/2",
    stocks: [{ deliveryTime: "2", id: "stock-1", priceKopeks: 45_670, quantity: 12 }],
  }],
  success: true,
};

const VALID_CREATE_INPUT = {
  consent: true,
  contact: { name: "Иван Петров", phone: "+79261234567" },
  idempotencyKey: "019bf9ea-0d3e-7def-9c9a-000000000001",
  partGuid: "part-guid",
  policyVersion: SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION,
  quantity: 2,
  query: "W914/2",
  stockId: "stock-1",
};

function makeSupplier(result: SupplierSearchResult = SEARCH_RESULT): SupplierProvider {
  return { enabled: true, search: async () => result };
}

function makeConfig(markupPercent = 30, legalDocumentsApproved = true): ConfigService {
  return {
    get: (key: string) => {
      if (key === "LEGAL_DOCUMENTS_APPROVED") return legalDocumentsApproved;
      if (key === "SUPPLIER_MARKUP_PERCENT") return markupPercent;
      return undefined;
    },
  } as ConfigService;
}

const auth: AuthContext = {
  csrfTokenHash: Buffer.alloc(32),
  email: "manager@example.test",
  mfaSetupRequired: false,
  mfaVerified: true,
  role: "manager",
  sessionId: "019bf9ea-0d3e-7def-8c9a-000000000002",
  userId: "019bf9ea-0d3e-7def-8c9a-000000000009",
};

describe("SupplierWaitlistService.create", () => {
  it("fails closed before parsing or sending PII when legal documents are not approved", async () => {
    const database = { transaction: vi.fn() } as unknown as DatabaseService;
    const supplier = { enabled: true, search: vi.fn() } as unknown as SupplierProvider;
    const service = new SupplierWaitlistService(
      { record: vi.fn() } as unknown as AuditService,
      database,
      supplier,
      makeConfig(30, false),
    );

    await expect(service.create(VALID_CREATE_INPUT, { ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(supplier.search).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("snapshots the same server-marked-up retail price the search response showed", async () => {
    const insertQuery = vi.fn().mockResolvedValueOnce({
      rows: [{ created_at: new Date("2026-08-03T00:00:00Z"), id: "waitlist-1", status: "new" }],
    }).mockResolvedValueOnce({ rows: [] });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof insertQuery }) => Promise<unknown>) => (
        work({ query: insertQuery })
      )),
    } as unknown as DatabaseService;
    const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new SupplierWaitlistService(audit, database, makeSupplier(), makeConfig());

    const result = await service.create(VALID_CREATE_INPUT, { ipAddress: "127.0.0.1" });

    expect(result).toEqual({
      createdAt: "2026-08-03T00:00:00.000Z",
      id: "waitlist-1",
      message: expect.any(String),
      replayed: false,
      status: "new",
    });
    const insertParams = insertQuery.mock.calls[0]?.[1] as unknown[];
    // brand/partNumber/name/stockId/price/deliveryTime all come from the
    // supplier lookup result above, not from VALID_CREATE_INPUT.
    expect(insertParams).toEqual(expect.arrayContaining([
      "MANN", "W914/2", "Масляный фильтр", "stock-1", 59_400, "2",
    ]));
    expect(insertParams).not.toContain(45_670);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "supplier_waitlist.request.created" }),
      expect.anything(),
    );
  });

  it("resolves a cross (analogue) part by guid, not only a top-level part", async () => {
    const insertQuery = vi.fn().mockResolvedValueOnce({
      rows: [{ created_at: new Date(), id: "waitlist-2", status: "new" }],
    });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof insertQuery }) => Promise<unknown>) => (
        work({ query: insertQuery })
      )),
    } as unknown as DatabaseService;
    const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new SupplierWaitlistService(audit, database, makeSupplier(), makeConfig());

    await service.create(
      { ...VALID_CREATE_INPUT, partGuid: "cross-guid", stockId: "cross-stock" },
      { ipAddress: "127.0.0.1" },
    );
    const insertParams = insertQuery.mock.calls[0]?.[1] as unknown[];
    expect(insertParams).toEqual(expect.arrayContaining(["MAHLE", "OC90", "cross-stock", 53_300, "3"]));
  });

  it("rejects when the part is no longer present in a fresh supplier lookup", async () => {
    const database = { transaction: vi.fn() } as unknown as DatabaseService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SupplierWaitlistService(
      audit,
      database,
      makeSupplier({ message: "", parts: [], success: true }),
      makeConfig(),
    );

    await expect(service.create(VALID_CREATE_INPUT, {})).rejects.toThrow(/не найдена/u);
  });

  it("rejects a supplier-side failure before trusting any attached part rows", async () => {
    const database = { transaction: vi.fn() } as unknown as DatabaseService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SupplierWaitlistService(
      audit,
      database,
      makeSupplier({ ...SEARCH_RESULT, message: "Ошибка", success: false }),
      makeConfig(),
    );

    await expect(service.create(VALID_CREATE_INPUT, {})).rejects.toMatchObject({ status: 503 });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects when the stock line is no longer present on the part", async () => {
    const database = { transaction: vi.fn() } as unknown as DatabaseService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SupplierWaitlistService(audit, database, makeSupplier(), makeConfig());

    await expect(service.create({ ...VALID_CREATE_INPUT, stockId: "missing-stock" }, {})).rejects.toThrow(/не доступна/u);
  });

  it("returns a replayed view (not a duplicate) when the same idempotency key repeats with the same payload", async () => {
    // The exact same hash the service itself derives for this payload — a
    // genuine retry of the same request, e.g. after a dropped response.
    const matchingHash = requestHash({
      consent: true,
      contact: { name: "Иван Петров", phone: "+79261234567" },
      idempotencyKey: VALID_CREATE_INPUT.idempotencyKey,
      partGuid: VALID_CREATE_INPUT.partGuid,
      policyVersion: SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION,
      quantity: VALID_CREATE_INPUT.quantity,
      query: VALID_CREATE_INPUT.query,
      source: "rossko",
      stockId: VALID_CREATE_INPUT.stockId,
    });
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // INSERT ... ON CONFLICT DO NOTHING -> no row
      .mockResolvedValueOnce({
        rows: [{
          created_at: new Date("2026-08-03T00:00:00Z"),
          id: "waitlist-3",
          request_hash: matchingHash,
          status: "new",
        }],
      });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    } as unknown as DatabaseService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SupplierWaitlistService(audit, database, makeSupplier(), makeConfig());

    const result = await service.create(VALID_CREATE_INPUT, {});
    expect(result).toMatchObject({ id: "waitlist-3", replayed: true, status: "new" });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with a different payload as a conflict, not a silent replay", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // INSERT ... ON CONFLICT DO NOTHING -> no row
      .mockResolvedValueOnce({
        rows: [{
          created_at: new Date(),
          id: "waitlist-4",
          request_hash: Buffer.alloc(32, 9), // deliberately does not match this payload's hash
          status: "new",
        }],
      });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    } as unknown as DatabaseService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SupplierWaitlistService(audit, database, makeSupplier(), makeConfig());

    await expect(service.create(VALID_CREATE_INPUT, {})).rejects.toMatchObject({ status: 409 });
  });
});

describe("SupplierWaitlistService.update", () => {
  it("rejects a stale version with a conflict", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({
      rows: [{ assigned_staff_id: null, status: "new", version: 3 }],
    });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    } as unknown as DatabaseService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SupplierWaitlistService(audit, database, makeSupplier(), makeConfig());

    await expect(service.update(
      "019bf9ea-0d3e-7def-9c9a-000000000005",
      { reason: "test reason for update", status: "in_progress", version: 1 },
      auth,
      {},
    )).rejects.toMatchObject({ status: 409 });
  });

  it("stops a manager from assigning a request to someone else", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({
      rows: [{ assigned_staff_id: null, status: "new", version: 1 }],
    });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    } as unknown as DatabaseService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SupplierWaitlistService(audit, database, makeSupplier(), makeConfig());

    await expect(service.update(
      "019bf9ea-0d3e-7def-9c9a-000000000005",
      { assignedStaffId: "019bf9ea-0d3e-7def-9c9a-000000000099", reason: "assign to someone else", version: 1 },
      auth,
      {},
    )).rejects.toMatchObject({ status: 403 });
  });
});
