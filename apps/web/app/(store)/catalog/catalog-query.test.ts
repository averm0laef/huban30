import { describe, expect, it } from "vitest";

import {
  catalogPageHref,
  clearCatalogFiltersHref,
  hasActiveCatalogFilters,
  parseCatalogPageQuery,
  priceKopeks,
} from "./catalog-query";

describe("catalog query", () => {
  it("normalizes useful public filters and discards malformed values", () => {
    const parsed = parseCatalogPageQuery({
      availability: "in_stock",
      brand: [" NGK ", "ngk", "mann-filter", "../bad"],
      maxPrice: "9000",
      minPrice: "500",
      page: "3",
      q: "  фильтр  ",
      sort: "price_asc",
    });

    expect(parsed).toEqual({
      availability: "in_stock",
      brands: ["ngk", "mann-filter"],
      maxPriceRubles: 9000,
      minPriceRubles: 500,
      page: 3,
      priceRangeValid: true,
      query: "фильтр",
      sort: "price_asc",
    });
  });

  it("does not silently swap an inverted price range", () => {
    const parsed = parseCatalogPageQuery({ maxPrice: "100", minPrice: "500" });
    expect(parsed.priceRangeValid).toBe(false);
    expect(parsed.minPriceRubles).toBe(500);
    expect(parsed.maxPriceRubles).toBe(100);
  });

  it("bounds numeric values and starts malformed pages at one", () => {
    const parsed = parseCatalogPageQuery({ maxPrice: "12.5", minPrice: "-1", page: "9999" });
    expect(parsed.maxPriceRubles).toBeNull();
    expect(parsed.minPriceRubles).toBeNull();
    expect(parsed.page).toBe(1);
    expect(priceKopeks(null)).toBeUndefined();
    expect(priceKopeks(1250)).toBe(125_000);
  });

  it("builds canonical pagination and reset links", () => {
    const parsed = parseCatalogPageQuery({
      availability: "out_of_stock",
      brand: ["ngk", "bosch"],
      minPrice: "1000",
      q: "свеча",
      sort: "name",
    });
    expect(hasActiveCatalogFilters(parsed)).toBe(true);
    expect(catalogPageHref("/catalog", parsed, 2)).toBe(
      "/catalog?q=%D1%81%D0%B2%D0%B5%D1%87%D0%B0&sort=name&availability=out_of_stock&brand=ngk&brand=bosch&minPrice=1000&page=2",
    );
    expect(clearCatalogFiltersHref("/catalog", parsed)).toBe(
      "/catalog?q=%D1%81%D0%B2%D0%B5%D1%87%D0%B0&sort=name",
    );
  });
});
