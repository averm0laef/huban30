import { describe, expect, it } from "vitest";

import {
  CATALOG_LAST_PAGE,
  catalogPageHref,
  catalogPageNumbers,
  clearCatalogFiltersHref,
  hasActiveCatalogFilters,
  parseCatalogPageQuery,
  priceKopeks,
  sectionLinkState,
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
      view: "grid",
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
      view: "grid",
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

// A link to a section opens the section. It used to carry the search text along: after a search every section in
// the list was searched for the same text, found nothing and said «по запросу … ничего не нашлось» — the customer
// who had typed something and then went to look through the sections never saw a section as it is.
describe("a link from any catalogue page to a section", () => {
  it("leads to the section itself, whatever was searched and however much was found", () => {
    const state = parseCatalogPageQuery({ page: "3", q: "антифриз" });
    expect(catalogPageHref("/catalog/tormoznaya-sistema", sectionLinkState(state))).toBe("/catalog/tormoznaya-sistema");
  });

  it("leaves the brand and the price behind: they are of the section the customer is leaving", () => {
    const state = parseCatalogPageQuery({ brand: "mann-filter", maxPrice: "900", minPrice: "100" });
    expect(catalogPageHref("/catalog/tormoznaya-sistema", sectionLinkState(state))).toBe("/catalog/tormoznaya-sistema");
  });

  it("keeps how the list is shown: the order, «в наличии» and the view", () => {
    const state = parseCatalogPageQuery({ availability: "in_stock", brand: "mann-filter", q: "антифриз", sort: "name", view: "list" });
    expect(catalogPageHref("/catalog/filtry", sectionLinkState(state))).toBe("/catalog/filtry?sort=name&availability=in_stock&view=list");
  });
});

describe("the page numbers under a list", () => {
  it("names every page of a short list", () => {
    expect(catalogPageNumbers(1, 1)).toEqual([1]);
    expect(catalogPageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the first, the last and the neighbours of the current page of a long list", () => {
    expect(catalogPageNumbers(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(catalogPageNumbers(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(catalogPageNumbers(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });

  it("does not hide a single page behind a gap", () => {
    expect(catalogPageNumbers(4, 20)).toEqual([1, 2, 3, 4, 5, null, 20]);
    expect(catalogPageNumbers(17, 20)).toEqual([1, null, 16, 17, 18, 19, 20]);
  });

  it("is never longer than seven places, so it fits a phone", () => {
    for (let last = 1; last <= 60; last += 1) {
      for (let page = 1; page <= last; page += 1) {
        const numbers = catalogPageNumbers(page, last);
        expect(numbers.length).toBeLessThanOrEqual(7);
        expect(numbers).toContain(page);
        expect(numbers[0]).toBe(1);
        expect(numbers.at(-1)).toBe(last);
      }
    }
  });

  it("stays inside the list when the address names a page beyond it", () => {
    expect(catalogPageNumbers(99, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(catalogPageNumbers(0, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  // The catalogue API gives the first 4 824 items of a list (offset up to 4 800); the root of the owner's catalogue
  // has 1 781 pages. «Дальше» past the last reachable page used to open page 1 again.
  it("knows the last page a list can be opened at", () => {
    expect(CATALOG_LAST_PAGE).toBe(201);
    expect(parseCatalogPageQuery({ page: String(CATALOG_LAST_PAGE) }).page).toBe(CATALOG_LAST_PAGE);
    expect(parseCatalogPageQuery({ page: String(CATALOG_LAST_PAGE + 1) }).page).toBe(1);
  });
});
