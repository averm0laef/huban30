import { describe, expect, it } from "vitest";

import {
  SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION,
  SupplierCrossPairSchema,
  SupplierSearchQuerySchema,
  SupplierSearchResponseSchema,
  SupplierWaitlistContactSchema,
  SupplierWaitlistCreateSchema,
  StaffSupplierWaitlistQuerySchema,
  StaffSupplierWaitlistUpdateSchema,
} from "./suppliers.js";

describe("supplier search contracts", () => {
  it("rejects a search query shorter than two characters", () => {
    expect(SupplierSearchQuerySchema.safeParse({ q: "w" }).success).toBe(false);
    expect(SupplierSearchQuerySchema.safeParse({ q: "W914/2" }).success).toBe(true);
  });

  it("keeps supplier results structurally separate from the shop's own catalog", () => {
    const parsed = SupplierSearchResponseSchema.parse({
      message: "OK",
      parts: [{
        availability: "under_order",
        brand: "MANN",
        crosses: [],
        guid: "g1",
        name: "Масляный фильтр",
        partNumber: "W914/2",
        stocks: [{ deliveryTime: "2", id: "s1", priceKopeks: 45_670, quantity: 12 }],
      }],
      query: "W914/2",
      success: true,
      totalFound: 1,
      truncated: false,
    });
    // The literal "under_order" tag (never "в наличии") is what keeps a
    // supplier result from ever being confused with 1C shelf stock — there is
    // no shared "availableQuantity" style field a client could conflate.
    expect(parsed.parts[0]?.availability).toBe("under_order");
    // The response must not name the distributor anywhere: the shop presents
    // this stock as its own, and a JSON field is as visible as rendered text
    // to anyone who opens the network tab.
    expect(JSON.stringify(parsed).toLowerCase()).not.toContain("rossko");
  });

  it("accepts a part with nested analogues (crosses) and no stock at all", () => {
    const parsed = SupplierSearchResponseSchema.parse({
      message: "OK",
      parts: [{
        availability: "under_order",
        brand: "BOSCH",
        crosses: [{
          availability: "under_order",
          brand: "MAHLE",
          crosses: [],
          guid: "cross-1",
          name: "Аналог",
          partNumber: "OC90",
          stocks: [],
        }],
        guid: "g2",
        name: "Деталь без остатка",
        partNumber: "NOSTOCK",
        stocks: [],
      }],
      query: "NOSTOCK",
      success: true,
      totalFound: 1,
      truncated: false,
    });
    expect(parsed.parts[0]?.stocks).toEqual([]);
    expect(parsed.parts[0]?.crosses).toHaveLength(1);
  });

  it("rejects a non-positive supplier price", () => {
    expect(SupplierSearchResponseSchema.safeParse({
      message: "OK",
      parts: [{
        availability: "under_order",
        brand: "MANN",
        crosses: [],
        guid: "g1",
        name: "x",
        partNumber: "x",
        stocks: [{ deliveryTime: null, id: "s1", priceKopeks: 0, quantity: 1 }],
      }],
      query: "x",
      success: true,
      totalFound: 1,
      truncated: false,
    }).success).toBe(false);
  });
});

describe("supplier cross pair contract", () => {
  it("accepts a pair with a brand on both sides and one with a blank brand", () => {
    expect(SupplierCrossPairSchema.safeParse({
      partA: { article: "W914/2", brand: "MANN" },
      partB: { article: "OC90", brand: "MAHLE" },
    }).success).toBe(true);
    // A supplier cross entry can carry an empty brand (see rossko-soap.ts's
    // `findChild(node, "brand")?.text ?? ""`) -- the schema must accept it,
    // ingestion is what decides such a pair is unconfirmed, not this schema.
    expect(SupplierCrossPairSchema.safeParse({
      partA: { article: "W914/2", brand: "MANN" },
      partB: { article: "OC90", brand: "" },
    }).success).toBe(true);
  });

  it("rejects a pair missing an article number on either side", () => {
    expect(SupplierCrossPairSchema.safeParse({
      partA: { article: "", brand: "MANN" },
      partB: { article: "OC90", brand: "MAHLE" },
    }).success).toBe(false);
  });
});

describe("supplier waiting list contracts", () => {
  it("requires an email or a phone for the waiting-list contact", () => {
    const result = SupplierWaitlistContactSchema.safeParse({ name: "Иван Петров" });
    expect(result.success).toBe(false);
  });

  it("accepts a waiting-list request with a snapshot lookup key, not a client-supplied price", () => {
    const parsed = SupplierWaitlistCreateSchema.parse({
      consent: true,
      contact: { name: "Иван Петров", phone: "+79261234567" },
      idempotencyKey: "019bf9ea-0d3e-7def-9c9a-000000000001",
      partGuid: "part-guid-1",
      policyVersion: SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION,
      quantity: 2,
      query: "W914/2",
      stockId: "stock-1",
    });
    // The supplier is filled in server-side rather than sent by the browser:
    // this is a request the client makes, not a response the customer reads,
    // so the default keeps the client from ever needing to know the name.
    expect(parsed.source).toBe("rossko");
    expect(parsed).not.toHaveProperty("priceKopeks");
  });

  it("rejects a stale consent policy version", () => {
    expect(SupplierWaitlistCreateSchema.safeParse({
      consent: true,
      contact: { name: "Иван Петров", phone: "+79261234567" },
      idempotencyKey: "019bf9ea-0d3e-7def-9c9a-000000000001",
      partGuid: "part-guid-1",
      policyVersion: "old-version",
      quantity: 1,
      query: "W914/2",
      stockId: "stock-1",
    }).success).toBe(false);
  });

  it("bounds quantity between 1 and 100", () => {
    const base = {
      consent: true as const,
      contact: { name: "Иван Петров", phone: "+79261234567" },
      idempotencyKey: "019bf9ea-0d3e-7def-9c9a-000000000001",
      partGuid: "part-guid-1",
      policyVersion: SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION,
      query: "W914/2",
      stockId: "stock-1",
    };
    expect(SupplierWaitlistCreateSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(SupplierWaitlistCreateSchema.safeParse({ ...base, quantity: 101 }).success).toBe(false);
    expect(SupplierWaitlistCreateSchema.safeParse({ ...base, quantity: 100 }).success).toBe(true);
  });

  it("requires either an assignment or a status change in a staff update", () => {
    expect(StaffSupplierWaitlistUpdateSchema.safeParse({
      reason: "test reason",
      version: 1,
    }).success).toBe(false);
    expect(StaffSupplierWaitlistUpdateSchema.safeParse({
      reason: "test reason",
      status: "in_progress",
      version: 1,
    }).success).toBe(true);
  });

  it("defaults the staff query to a stable, bounded page", () => {
    const query = StaffSupplierWaitlistQuerySchema.parse({});
    expect(query).toMatchObject({ assigned: "any", direction: "desc", limit: 25, offset: 0, sort: "createdAt" });
  });
});
