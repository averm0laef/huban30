import { describe, expect, it } from "vitest";

import type { CatalogProductSummary, SupplierPartView, SupplierSearchResponse } from "@an30/contracts";

import { composeTwoSourceCatalog, filterSupplierParts } from "./supplier-results";

function ownItem(overrides: Partial<CatalogProductSummary> = {}): CatalogProductSummary {
  return {
    availableQuantity: 3,
    brand: null,
    category: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    matchedVia: "query",
    name: "Фильтр масляный",
    priceKopeks: 45000,
    primaryImage: null,
    sku: "OWN-1",
    slug: "filtr-maslyanyy",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function supplierPart(overrides: Partial<SupplierPartView> = {}): SupplierPartView {
  return {
    availability: "under_order",
    brand: "Mann",
    crosses: [],
    guid: "NSIN0000486850",
    name: "Фильтр масляный",
    partNumber: "W 914/2",
    stocks: [{ deliveryTime: null, id: "HST1", priceKopeks: 53510, quantity: 38 }],
    ...overrides,
  };
}

function supplierResponse(overrides: Partial<SupplierSearchResponse> = {}): SupplierSearchResponse {
  return {
    message: "",
    parts: [supplierPart()],
    query: "W914/2",
    success: true,
    totalFound: 1,
    truncated: false,
    ...overrides,
  };
}

describe("filterSupplierParts", () => {
  it("returns nothing when the response has not arrived yet", () => {
    expect(filterSupplierParts(null)).toEqual([]);
  });

  it("returns nothing when the supplier call failed or was disabled", () => {
    const response = supplierResponse({ parts: [supplierPart()], success: false });
    expect(filterSupplierParts(response)).toEqual([]);
  });

  it("passes through a properly tagged under_order row", () => {
    const part = supplierPart();
    expect(filterSupplierParts(supplierResponse({ parts: [part] }))).toEqual([part]);
  });

  it("drops any row that is not tagged under_order, even if one slipped past validation upstream", () => {
    const mistagged = { ...supplierPart(), availability: "in_stock" } as unknown as SupplierPartView;
    const clean = supplierPart({ guid: "clean-guid" });
    expect(filterSupplierParts(supplierResponse({ parts: [mistagged, clean] }))).toEqual([clean]);
  });

  it("applies real brand and retail-price filters to direct and analogue offers", () => {
    const part = supplierPart({
      crosses: [{
        availability: "under_order",
        brand: "Bosch",
        crosses: [],
        guid: "cross-bosch",
        name: "Аналог Bosch",
        partNumber: "B-1",
        stocks: [{ deliveryTime: "2 дня", id: "B", priceKopeks: 80_000, quantity: 2 }],
      }],
      stocks: [{ deliveryTime: null, id: "M", priceKopeks: 50_000, quantity: 1 }],
    });

    expect(filterSupplierParts(supplierResponse({ parts: [part] }), {
      brandNames: ["BOSCH"],
      minPriceKopeks: 70_000,
      maxPriceKopeks: 90_000,
    })).toEqual([{ ...part, stocks: [] }]);
  });

  it("removes supplier identities already available on the shop floor", () => {
    expect(filterSupplierParts(supplierResponse(), {
      ownAvailable: [{ brand: "MANN", sku: "W914/2" }],
    })).toEqual([]);
  });

  it("does not render a supplier identity without an actionable stock line", () => {
    expect(filterSupplierParts(supplierResponse({
      parts: [supplierPart({ crosses: [], stocks: [] })],
    }))).toEqual([]);
  });
});

describe("composeTwoSourceCatalog", () => {
  it("surfaces supplier results even when the shop's own list is empty", () => {
    const result = composeTwoSourceCatalog([], supplierResponse());

    expect(result.own).toEqual([]);
    expect(result.supplier).toHaveLength(1);
  });

  it("keeps both sources when the shop's own list also has matches", () => {
    const result = composeTwoSourceCatalog([ownItem()], supplierResponse());

    expect(result.own).toHaveLength(1);
    expect(result.supplier).toHaveLength(1);
  });

  it("never merges the two sources into one combined list", () => {
    const result = composeTwoSourceCatalog([ownItem()], supplierResponse());

    expect(Object.keys(result).sort()).toEqual(["own", "supplier"]);
    expect(Array.isArray((result as unknown as { items?: unknown }).items)).toBe(false);
    // The own array must never contain a supplier-shaped row (partNumber/guid)
    // and vice versa — each item keeps exactly its source's own shape.
    for (const item of result.own) expect(item).not.toHaveProperty("partNumber");
    for (const part of result.supplier) expect(part).not.toHaveProperty("sku");
  });

  it("every supplier row in the composed view carries the fixed under_order literal", () => {
    const result = composeTwoSourceCatalog([], supplierResponse({
      parts: [supplierPart({ guid: "a" }), supplierPart({ guid: "b" })],
    }));

    expect(result.supplier.length).toBeGreaterThan(0);
    for (const part of result.supplier) expect(part.availability).toBe("under_order");
  });

  it("returns an empty supplier list while the supplier response has not loaded", () => {
    const result = composeTwoSourceCatalog([ownItem()], null);

    expect(result.own).toHaveLength(1);
    expect(result.supplier).toEqual([]);
  });
});
