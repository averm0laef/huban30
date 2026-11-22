import { describe, expect, it } from "vitest";

import {
  PartsFinderCrossesRequestSchema,
  PartsFinderCrossesResponseSchema,
  PartsFinderSearchRequestSchema,
  PartsFinderSearchResponseSchema,
  PartsFinderShopAnalogsRequestSchema,
  PartsFinderVehicleRequestSchema,
  ShopOfferSchema,
} from "./index.js";

const offer = {
  availableQuantity: 3,
  brand: "Toyota",
  matchedVia: "exact",
  name: "Фильтр масляный",
  priceKopeks: 89_000,
  productId: "7a1c3c2e-6f0d-4c3a-9d1b-0f2b8f7e6a11",
  sku: "04152-40060",
  slug: "filtr-maslyanyy-toyota-04152-40060",
} as const;

describe("parts finder contracts", () => {
  it("accepts a query with known choice steps and drops fields the service must never receive", () => {
    const parsed = PartsFinderSearchRequestSchema.parse({
      catalog: "autodoc",
      choices: { engine: 1, version: 3 },
      confirmed: true,
      query: "  масляный фильтр пробокс ",
    });
    expect(parsed).toEqual({ choices: { engine: 1, version: 3 }, confirmed: true, query: "масляный фильтр пробокс" });
    expect(parsed).not.toHaveProperty("catalog");
  });

  it("rejects empty, long or control-character queries and invalid choices", () => {
    expect(PartsFinderSearchRequestSchema.safeParse({ query: "   " }).success).toBe(false);
    expect(PartsFinderSearchRequestSchema.safeParse({ query: "x".repeat(141) }).success).toBe(false);
    expect(PartsFinderSearchRequestSchema.safeParse({ query: "фильтр\nпробокс" }).success).toBe(false);
    expect(PartsFinderSearchRequestSchema.safeParse({ choices: { engine: 0 }, query: "фильтр" }).success).toBe(false);
    expect(PartsFinderSearchRequestSchema.safeParse({ choices: { engine: 1.5 }, query: "фильтр" }).success).toBe(false);
    expect(PartsFinderSearchRequestSchema.safeParse({ choices: { colour: 1 }, query: "фильтр" }).success).toBe(false);
    expect(PartsFinderSearchRequestSchema.safeParse({ choices: { local_variant: 2 ** 47 }, query: "фильтр" }).success).toBe(true);
  });

  it("limits VIN, article and brand lengths", () => {
    expect(PartsFinderVehicleRequestSchema.safeParse({ vin: "XTAGFK330JY144213" }).success).toBe(true);
    expect(PartsFinderVehicleRequestSchema.safeParse({ vin: "X".repeat(33) }).success).toBe(false);
    expect(PartsFinderCrossesRequestSchema.safeParse({ article: "04152-40060", manufacturer_id: 12 }).success).toBe(true);
    expect(PartsFinderCrossesRequestSchema.safeParse({ article: "A".repeat(65) }).success).toBe(false);
    expect(PartsFinderCrossesRequestSchema.safeParse({ article: "42", manufacturer_id: -1 }).success).toBe(false);
    expect(PartsFinderShopAnalogsRequestSchema.parse({ article: " 04152-40060 ", brand: " Toyota " }))
      .toEqual({ article: "04152-40060", brand: "Toyota" });
    expect(PartsFinderShopAnalogsRequestSchema.safeParse({ article: "" }).success).toBe(false);
  });

  it("keeps unknown service fields in responses and validates shop offers", () => {
    const search = PartsFinderSearchResponseSchema.parse({
      parts: [{ article: "04152-40060", brand: "Toyota", shop: [offer], source_url: "https://example.test" }],
      status: "reference",
      vehicle: "Toyota Probox",
    });
    expect(search.parts?.[0]).toHaveProperty("source_url", "https://example.test");
    const crosses = PartsFinderCrossesResponseSchema.parse({
      article: "W 75/3", groups: { analogs: [{ article: "AB100", brand: "Other", votes_for: 3 }] }, status: "found",
    });
    expect(crosses.groups?.analogs?.[0]).toHaveProperty("votes_for", 3);
    expect(ShopOfferSchema.safeParse({ ...offer, matchedVia: "supplier" }).success).toBe(false);
    expect(ShopOfferSchema.safeParse({ ...offer, availableQuantity: -1 }).success).toBe(false);
  });
});
