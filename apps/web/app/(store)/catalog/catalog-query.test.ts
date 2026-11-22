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

// A search inside a section (an address with ?q=, a bookmark) that finds nothing there used to send the customer
// to the results of the whole catalogue; the section they had asked for never opened.
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
