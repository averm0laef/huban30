import { describe, expect, it } from "vitest";

import {
  AdminPendingTokenQuerySchema,
  CatalogFeaturedQuerySchema,
  CatalogImageIdentifierSchema,
  CatalogProductIdentifierSchema,
  CatalogProductsQuerySchema,
  CatalogSearchQuerySchema,
  ChatClientEventSchema,
  ChatMessageCreateSchema,
  CheckoutRequestSchema,
  MoneySchema,
  OneCImportEnvelopeSchema,
  OrderStatusSchema,
  PaymentStatusSchema,
  ROLE_PERMISSIONS,
  RoleSchema,
  StaffCatalogQuerySchema,
  StaffChatUpdateSchema,
  StaffOrdersQuerySchema,
  StaffRequestsQuerySchema,
  StaffRequestUpdateSchema,
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
      legalPolicyVersion: "checkout-terms-v1",
      sandboxScenario: "success",
      termsAccepted: true,
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

  it("normalises a pasted or autofilled contact email before validating it", () => {
    const request = {
      contact: { email: "  Client@Example.COM  ", name: "Антон Ермолаев", phone: "+79141234567" },
      delivery: { method: "pickup" },
      idempotencyKey: "019bf9ea-0d3e-7def-9c9a-000000000001",
      items: [{ productId: "019bf9ea-0d3e-7def-9c9a-000000000002", quantity: 1 }],
      legalPolicyVersion: "checkout-terms-v1",
      termsAccepted: true,
    };

    // Surrounding whitespace arrives from browser autofill and copy-paste, so
    // it must be stripped rather than rejected as a malformed address.
    expect(CheckoutRequestSchema.parse(request).contact.email).toBe("client@example.com");

    // Normalising must not rescue an address that is genuinely invalid.
    expect(CheckoutRequestSchema.safeParse({
      ...request,
      contact: { ...request.contact, email: "  client@example  " },
    }).success).toBe(false);
    expect(CheckoutRequestSchema.safeParse({
      ...request,
      contact: { ...request.contact, email: "   " },
    }).success).toBe(false);
    expect(CheckoutRequestSchema.safeParse({
      ...request,
      contact: { ...request.contact, email: `${"a".repeat(250)}@example.com` },
    }).success).toBe(false);
  });

  it("keeps privileged staff actions out of customer and manager roles", () => {
    expect(ROLE_PERMISSIONS.customer).not.toContain("orders:read:any");
    expect(ROLE_PERMISSIONS.manager).not.toContain("staff:invite");
    expect(ROLE_PERMISSIONS.admin).toContain("staff:invite");
  });

  it("keeps the pending-token support tool exclusive to admin", () => {
    expect(ROLE_PERMISSIONS.customer).not.toContain("auth:tokens:read");
    expect(ROLE_PERMISSIONS.manager).not.toContain("auth:tokens:read");
    expect(ROLE_PERMISSIONS.director).not.toContain("auth:tokens:read");
    expect(ROLE_PERMISSIONS.admin).toContain("auth:tokens:read");
  });

  it("normalizes the admin pending-token lookup email and rejects extra fields", () => {
    expect(AdminPendingTokenQuerySchema.parse({ email: " Client@Example.com " }))
      .toEqual({ email: "client@example.com" });
    expect(AdminPendingTokenQuerySchema.safeParse({ email: "client@example.com", extra: 1 }).success)
      .toBe(false);
    expect(AdminPendingTokenQuerySchema.safeParse({ email: "not-an-email" }).success).toBe(false);
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

  it("validates bounded chat events and deterministic search input", () => {
    const message = {
      body: "Здравствуйте!\nНужна помощь с заказом.",
      clientMessageId: "019bf9ea-0d3e-7def-9c9a-000000000010",
    };
    expect(ChatMessageCreateSchema.parse(message).replyToId).toBeNull();
    expect(ChatMessageCreateSchema.safeParse({ ...message, body: "unsafe\u0000text" }).success).toBe(false);
    expect(ChatClientEventSchema.safeParse({
      afterSequence: "42",
      threadId: "019bf9ea-0d3e-7def-9c9a-000000000011",
      type: "subscribe",
    }).success).toBe(true);
    expect(CatalogSearchQuerySchema.parse({ q: "  фильтр масляный  " })).toMatchObject({
      limit: 20,
      q: "фильтр масляный",
    });
  });

  it("normalizes strict public catalog filters", () => {
    expect(CatalogProductsQuerySchema.parse({
      availability: "in_stock",
      brand: ["toyota", "ngk"],
      category: "filters",
      limit: "48",
      maxPriceKopeks: "900000",
      minPriceKopeks: "10000",
      offset: "24",
      q: "  фильтр масляный  ",
      sort: "price_asc",
    })).toMatchObject({
      availability: "in_stock",
      brand: ["toyota", "ngk"],
      category: "filters",
      limit: 48,
      maxPriceKopeks: 900000,
      minPriceKopeks: 10000,
      offset: 24,
      q: "фильтр масляный",
      sort: "price_asc",
    });
    expect(CatalogProductsQuerySchema.parse({ brand: "toyota" }).brand).toEqual(["toyota"]);
    expect(CatalogProductsQuerySchema.safeParse({ extra: "unsafe" }).success).toBe(false);
    expect(CatalogProductsQuerySchema.safeParse({ brand: ["toyota", "toyota"] }).success).toBe(false);
    expect(CatalogProductsQuerySchema.safeParse({ minPriceKopeks: 200, maxPriceKopeks: 100 }).success)
      .toBe(false);
    expect(CatalogProductsQuerySchema.safeParse({ q: "x" }).success).toBe(false);
    expect(CatalogProductsQuerySchema.safeParse({ limit: 49 }).success).toBe(false);
    expect(CatalogProductsQuerySchema.safeParse({ offset: 4_801 }).success).toBe(false);
  });

  it("accepts bounded featured queries and UUID-or-slug product identifiers", () => {
    expect(CatalogFeaturedQuerySchema.parse({ limit: "12" })).toEqual({ limit: 12 });
    expect(CatalogFeaturedQuerySchema.safeParse({ limit: 25 }).success).toBe(false);
    expect(CatalogProductIdentifierSchema.safeParse("oil-filter-1").success).toBe(true);
    expect(CatalogProductIdentifierSchema.safeParse("019bf9ea-0d3e-7def-9c9a-000000000010").success)
      .toBe(true);
    expect(CatalogProductIdentifierSchema.safeParse("../private").success).toBe(false);
    expect(CatalogImageIdentifierSchema.safeParse("oil-filter-1").success).toBe(false);
  });

  it("normalizes bounded staff table queries", () => {
    expect(StaffOrdersQuerySchema.parse({ limit: "50", offset: "25" })).toMatchObject({
      direction: "desc",
      limit: 50,
      offset: 25,
      sort: "createdAt",
    });
    expect(StaffCatalogQuerySchema.safeParse({ limit: "1000" }).success).toBe(false);
    expect(StaffOrdersQuerySchema.safeParse({ q: "x" }).success).toBe(false);
  });

  it("requires optimistic version and a real chat change", () => {
    expect(StaffChatUpdateSchema.safeParse({ reason: "Назначение менеджера", version: 1 }).success)
      .toBe(false);
    expect(StaffChatUpdateSchema.safeParse({
      assignedStaffId: null,
      reason: "Снятие назначения",
      version: 2,
    }).success).toBe(true);
    expect(StaffChatUpdateSchema.safeParse({
      reason: "Закрыт после ответа",
      status: "closed",
      version: 0,
    }).success).toBe(false);
  });

  it("bounds staff request filters and requires an optimistic change", () => {
    expect(StaffRequestsQuerySchema.parse({ assigned: "mine", source: "expert_help" }))
      .toMatchObject({ assigned: "mine", source: "expert_help" });
    expect(StaffRequestsQuerySchema.safeParse({ offset: 4_801 }).success).toBe(false);
    expect(StaffRequestUpdateSchema.safeParse({ reason: "Взято в работу", version: 1 }).success)
      .toBe(false);
    expect(StaffRequestUpdateSchema.safeParse({
      assignedStaffId: null,
      reason: "Снято назначение",
      version: 1,
    }).success).toBe(true);
  });
});
