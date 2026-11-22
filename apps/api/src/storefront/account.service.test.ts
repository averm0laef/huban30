import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import type { PasswordService } from "../security/password.service.js";
import { AccountService } from "./account.service.js";

const USER_ID = "019bf9ea-0d3e-7def-8c9a-000000000001";
const SESSION_ID = "019bf9ea-0d3e-7def-8c9a-000000000002";
const PRODUCT_ID = "019bf9ea-0d3e-7def-8c9a-000000000003";
const ADDRESS_ID = "019bf9ea-0d3e-7def-8c9a-000000000004";
const auth: AuthContext = {
  csrfTokenHash: Buffer.alloc(32),
  email: "user@example.test",
  mfaSetupRequired: false,
  mfaVerified: true,
  role: "customer",
  sessionId: SESSION_ID,
  userId: USER_ID,
};

describe("AccountService ownership boundaries", () => {
  it("always scopes history deletion to the authenticated user", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const service = new AccountService(
      { record: vi.fn() } as unknown as AuditService,
      { query } as unknown as DatabaseService,
      {} as PasswordService,
      { name: "local" } as StorageProvider,
    );

    await service.clearHistory(auth);

    expect(query).toHaveBeenCalledWith(
      "DELETE FROM app.product_views WHERE user_id=$1",
      [USER_ID],
    );
  });

  it("shows a saved product's name without the staff's notes typed into it in 1С", async () => {
    // «(Ш)», «+++» and the shelf box are the staff's own marks (packages/contracts/src/product-name.ts).
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{
        amount_kopeks: "30000", available_quantity: "3", brand_name: null, category_name: null, category_slug: null,
        created_at: new Date("2026-11-22T00:00:00Z"), id: "019bf9ea-0d3e-7def-9c9a-000000000777",
        name: "(Ш) +++ Клипса крепежная TORSO КОРОБКА 9", primary_image_id: null, sku: "KP-170", slug: "klipsa-kp-170",
      }],
    });
    const service = new AccountService(
      { record: vi.fn() } as unknown as AuditService,
      { query } as unknown as DatabaseService,
      {} as PasswordService,
      { name: "local" } as StorageProvider,
    );

    const wishlist = await service.wishlist({}, auth) as { items: Array<{ name: string }> };
    const history = await service.history({}, auth) as { items: Array<{ name: string }> };

    expect(wishlist.items[0]?.name).toBe("Клипса крепежная TORSO");
    expect(history.items[0]?.name).toBe("Клипса крепежная TORSO");
  });

  it("scopes wishlist mutations to the session user and validates the local product", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ product_id: PRODUCT_ID }] });
    const service = new AccountService(
      { record: vi.fn() } as unknown as AuditService,
      { query } as unknown as DatabaseService,
      {} as PasswordService,
      { name: "local" } as StorageProvider,
    );

    await expect(service.addWishlist({ productId: PRODUCT_ID }, auth)).resolves.toEqual({
      productId: PRODUCT_ID,
      saved: true,
    });
    expect(query.mock.calls[0]?.[1]).toEqual([USER_ID, PRODUCT_ID]);
    expect(String(query.mock.calls[0]?.[0])).toContain("product.is_active");
  });

  it("revokes every other session after a verified password change", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ password_hash: "old-hash" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const database = {
      query: vi.fn().mockResolvedValue({
        rows: [{ email: "user@example.test", password_hash: "old-hash" }],
      }),
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    };
    const passwords = {
      hash: vi.fn().mockResolvedValue("new-hash"),
      verify: vi.fn().mockResolvedValue(true),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AccountService(
      audit as unknown as AuditService,
      database as unknown as DatabaseService,
      passwords as unknown as PasswordService,
      { name: "local" } as StorageProvider,
    );

    await service.changePassword(
      { currentPassword: "old-password-value", newPassword: "new-secure-password-value" },
      auth,
      { ipAddress: "127.0.0.1" },
    );

    expect(clientQuery.mock.calls[2]?.[0]).toContain("id<>$2");
    expect(clientQuery.mock.calls[2]?.[1]).toEqual([USER_ID, SESSION_ID]);
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it("updates an address only through the authenticated owner scope", async () => {
    const row = {
      apartment: null,
      city: "Чита",
      created_at: new Date("2026-08-02T00:00:00.000Z"),
      delivery_note: null,
      house: "30",
      id: ADDRESS_ID,
      is_default: true,
      label: "Дом",
      phone: "+79141234567",
      postal_code: "672000",
      recipient_name: "Антон Ермолаев",
      region: "Забайкальский край",
      street: "Ленина",
      updated_at: new Date("2026-08-02T00:00:00.000Z"),
    };
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...row, label: "Склад" }] });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AccountService(
      audit as unknown as AuditService,
      database as unknown as DatabaseService,
      {} as PasswordService,
      { name: "local" } as StorageProvider,
    );

    await expect(service.updateAddress(
      ADDRESS_ID,
      { label: "Склад" },
      auth,
      { ipAddress: "127.0.0.1" },
    )).resolves.toMatchObject({ id: ADDRESS_ID, label: "Склад" });

    expect(clientQuery.mock.calls[1]?.[1]).toEqual([ADDRESS_ID, USER_ID]);
    expect(clientQuery.mock.calls[2]?.[1]?.slice(0, 2)).toEqual([ADDRESS_ID, USER_ID]);
  });
});

describe("AccountService avatar", () => {
  function make(query: ReturnType<typeof vi.fn>, record = vi.fn()) {
    return new AccountService({ record } as unknown as AuditService, { query, transaction: (work: (client: unknown) => unknown) => work({ query }) } as unknown as DatabaseService, {} as PasswordService, { name: "local" } as StorageProvider);
  }
  const accountRow = (avatarKey: string | null) => ({ avatar_key: avatarKey, created_at: new Date("2026-01-01T00:00:00Z"), display_name: "Иван", email: "user@example.test", id: USER_ID, phone: null });

  it("returns a stable automatic avatar until the customer picks one", async () => {
    const read = await make(vi.fn().mockResolvedValue({ rows: [accountRow(null)] })).read(auth);
    expect(read).toMatchObject({ avatarChosen: false });
    expect(read.avatarKey).toMatch(/^customer-(0[1-9]|1[0-5])$/u);
  });

  it("saves one of the 15 pictures for the session user and audits it", async () => {
    const record = vi.fn();
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ avatar_key: null }] }).mockResolvedValueOnce({ rows: [accountRow("customer-04")] });
    await expect(make(query, record).updateAvatar({ avatarKey: "customer-04" }, auth, { ipAddress: "127.0.0.1" })).resolves.toMatchObject({ avatarChosen: true, avatarKey: "customer-04" });
    expect(query.mock.calls[1]?.[1]).toEqual([USER_ID, "customer-04"]);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "account.avatar.updated", afterState: { avatarKey: "customer-04" } }), expect.anything());
  });

  it("rejects an unknown avatar key before touching the database", async () => {
    const query = vi.fn();
    await expect(make(query).updateAvatar({ avatarKey: "customer-99" }, auth, { ipAddress: "127.0.0.1" })).rejects.toMatchObject({ status: 400 });
    await expect(make(query).updateAvatar({ avatarKey: "/etc/passwd" }, auth, { ipAddress: "127.0.0.1" })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});
