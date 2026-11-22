import { describe, expect, it } from "vitest";

import type { CatalogBrand } from "../_lib/catalog-api";
import { filterBrandsByTerm, sortBrandsForFacet } from "./catalog-filter-logic";

function brand(overrides: Partial<CatalogBrand> & Pick<CatalogBrand, "id" | "name" | "slug">): CatalogBrand {
  return { productCount: 1, ...overrides };
}

const brands: CatalogBrand[] = [
  brand({ id: "1", name: "Bosch", productCount: 40, slug: "bosch" }),
  brand({ id: "2", name: "NGK", productCount: 12, slug: "ngk" }),
  brand({ id: "3", name: "Mann-Filter", productCount: 40, slug: "mann-filter" }),
  brand({ id: "4", name: "Дромос", productCount: 0, slug: "dromos" }),
];

describe("sortBrandsForFacet", () => {
  it("drops brands with no purchasable products — the empty-catalog case", () => {
    expect(sortBrandsForFacet([], [])).toEqual([]);
    expect(sortBrandsForFacet(brands, []).map((b) => b.slug)).not.toContain("dromos");
  });

  it("orders by product count, then Russian-collated name, ties broken alphabetically", () => {
    expect(sortBrandsForFacet(brands, []).map((b) => b.slug)).toEqual(["bosch", "mann-filter", "ngk"]);
  });

  it("always surfaces every currently-selected brand first, regardless of count", () => {
    const sorted = sortBrandsForFacet(brands, ["ngk"]);
    expect(sorted[0]?.slug).toBe("ngk");
  });
});

describe("filterBrandsByTerm", () => {
  it("returns everything for a blank or whitespace-only term", () => {
    expect(filterBrandsByTerm(brands, "")).toEqual(brands);
    expect(filterBrandsByTerm(brands, "   ")).toEqual(brands);
  });

  it("matches case-insensitively as a substring", () => {
    expect(filterBrandsByTerm(brands, "bosch").map((b) => b.slug)).toEqual(["bosch"]);
    expect(filterBrandsByTerm(brands, "BOSCH").map((b) => b.slug)).toEqual(["bosch"]);
    expect(filterBrandsByTerm(brands, "filter").map((b) => b.slug)).toEqual(["mann-filter"]);
  });

  it("returns an empty list rather than falling back to the full list on no match", () => {
    expect(filterBrandsByTerm(brands, "zzz")).toEqual([]);
  });
});
