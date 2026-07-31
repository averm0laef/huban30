import { describe, expect, it } from "vitest";

import {
  CheckoutRequestSchema,
  MoneySchema,
  OneCImportEnvelopeSchema,
  OrderStatusSchema,
  PaymentStatusSchema,
  ROLE_PERMISSIONS,
  RoleSchema,
} from "./index.js";

describe("public contracts", () => {
  it("accepts only declared roles and states", () => {
    expect(RoleSchema.safeParse("manager").success).toBe(true);
    expect(RoleSchema.safeParse("super_admin").success).toBe(false);
    expect(OrderStatusSchema.safeParse("pending_payment").success).toBe(true);
    expect(PaymentStatusSchema.safeParse("partially_refunded").success).toBe(true);
  });

  it("stores money as non-negative integer kopeks", () => {
    expect(MoneySchema.parse(125_099)).toBe(125_099);
    expect(MoneySchema.safeParse(12.5).success).toBe(false);
    expect(MoneySchema.safeParse(-1).success).toBe(false);
  });

  it("validates checkout identity, quantities and duplicate products", () => {
    const request = {
      contact: { email: "client@example.com", name: "Антон Ермолаев", phone: "+79141234567" },
      delivery: { method: "pickup" },
      idempotencyKey: "019bf9ea-0d3e-7def-9c9a-000000000001",
      items: [{ productId: "019bf9ea-0d3e-7def-9c9a-000000000002", quantity: 2 }],
      sandboxScenario: "success",
    };

    expect(CheckoutRequestSchema.parse(request).customerNote).toBeNull();
    expect(CheckoutRequestSchema.safeParse({
      ...request,
      contact: { ...request.contact, phone: "89141234567" },
    }).success).toBe(false);
    expect(CheckoutRequestSchema.safeParse({
      ...request,
      items: [request.items[0], request.items[0]],
    }).success).toBe(false);
  });

  it("keeps privileged staff actions out of customer and manager roles", () => {
    expect(ROLE_PERMISSIONS.customer).not.toContain("orders:read:any");
    expect(ROLE_PERMISSIONS.manager).not.toContain("staff:invite");
    expect(ROLE_PERMISSIONS.admin).toContain("staff:invite");
  });

  it("validates the versioned 1C envelope and integer kopeks", () => {
    const parsed = OneCImportEnvelopeSchema.parse({
      exportedAt: "2026-08-01T00:00:00+09:00",
      externalBatchId: "exchange-42",
      rows: [{
        amountKopeks: 123_45,
        entityType: "price",
        productExternalId: "product-1",
        version: 7,
      }],
      schemaVersion: 1,
    });

    expect(parsed.rows[0]).toMatchObject({ amountKopeks: 123_45, currency: "RUB" });
    expect(() => OneCImportEnvelopeSchema.parse({
      ...parsed,
      rows: [{ ...parsed.rows[0], amountKopeks: 123.45 }],
    })).toThrow();
  });

  it("rejects control characters and pathologically deep 1C attributes", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 14; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const base = {
      exportedAt: "2026-08-01T00:00:00+09:00",
      externalBatchId: "exchange-safe",
      rows: [{
        attributes: deep,
        entityType: "product",
        externalId: "product-1",
        name: "Product",
        sku: "SKU-1",
        slug: "product-1",
        version: 1,
      }],
      schemaVersion: 1,
    };
    expect(OneCImportEnvelopeSchema.safeParse(base).success).toBe(false);
    expect(OneCImportEnvelopeSchema.safeParse({
      ...base,
      externalBatchId: "unsafe\nrequest",
      rows: [],
    }).success).toBe(false);
  });
});
