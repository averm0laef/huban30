import { describe, expect, it } from "vitest";

import {
  catalogPageHref,
  clearCatalogFiltersHref,
  hasActiveCatalogFilters,
  missedSearchText,
  parseCatalogPageQuery,
  priceKopeks,
  sectionLinkState,
  sectionWithoutMatchesHref,
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

// The list of sections beside the results used to carry the search text into every section. After a search that
// found nothing, each section found nothing either and sent the customer back to the same empty page: there was
// no way out of an empty search through the list of sections.
describe("a link from the results to another section", () => {
  it("leads to the section itself when the search found nothing", () => {
    const state = parseCatalogPageQuery({ q: "антифриз" });
    expect(catalogPageHref("/catalog/tormoznaya-sistema", sectionLinkState(state, 0))).toBe("/catalog/tormoznaya-sistema");
  });

  it("keeps the search text while there is something to narrow", () => {
    const state = parseCatalogPageQuery({ page: "3", q: "фильтр" });
    expect(catalogPageHref("/catalog/filtry", sectionLinkState(state, 12))).toBe("/catalog/filtry?q=%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80");
  });

  it("starts the section afresh when it was the filters that left nothing", () => {
    // The brands of one section are not the brands of another: «MANN-FILTER до 100 ₽» found nothing among the
    // filters and would find nothing among the brakes.
    const state = parseCatalogPageQuery({ brand: "mann-filter", maxPrice: "100" });
    expect(catalogPageHref("/catalog/tormoznaya-sistema", sectionLinkState(state, 0))).toBe("/catalog/tormoznaya-sistema");
    expect(catalogPageHref("/catalog/tormoznaya-sistema", sectionLinkState(state, 5))).toBe("/catalog/tormoznaya-sistema?brand=mann-filter&maxPrice=100");
  });

  it("leaves the brand and the price behind with an empty result, and keeps how the list is shown", () => {
    const state = parseCatalogPageQuery({ availability: "in_stock", brand: "mann-filter", maxPrice: "900", minPrice: "100", q: "антифриз", sort: "name", view: "list" });
    expect(catalogPageHref("/catalog/filtry", sectionLinkState(state, 0))).toBe("/catalog/filtry?sort=name&availability=in_stock&view=list");
  });
});

// A section opened from the results carries the search text. When the section had nothing for it, the customer
// was sent back to the results of the whole catalogue — the section they had asked for never opened.
describe("a search inside a section that has nothing for it", () => {
  it("opens the section itself and tells it what was not found there", () => {
    const state = parseCatalogPageQuery({ page: "2", q: "антифриз", view: "list" });
    expect(sectionWithoutMatchesHref("/catalog/filtry", state))
      .toBe("/catalog/filtry?view=list&missed=%D0%B0%D0%BD%D1%82%D0%B8%D1%84%D1%80%D0%B8%D0%B7");
    expect(sectionWithoutMatchesHref("/catalog/filtry", parseCatalogPageQuery({ q: "антифриз" })))
      .toBe("/catalog/filtry?missed=%D0%B0%D0%BD%D1%82%D0%B8%D1%84%D1%80%D0%B8%D0%B7");
  });

  it("reads what was missed as one line of text of a bounded length", () => {
    expect(missedSearchText({ missed: "  анти\tфриз  " })).toBe("анти фриз");
    expect(missedSearchText({ missed: ["первое", "второе"] })).toBe("первое");
    expect(missedSearchText({ missed: "я".repeat(500) })).toHaveLength(120);
    expect(missedSearchText({})).toBe("");
  });
});
