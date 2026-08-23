import { describe, expect, it } from "vitest";

import type { SupplierPart } from "../adapters/provider-contracts.js";
import { rankSupplierParts } from "./supplier-ranking.js";

function part(overrides: Partial<SupplierPart> = {}): SupplierPart {
  return {
    brand: "MANN",
    crosses: [],
    guid: "g1",
    name: "Фильтр масляный",
    partNumber: "W 914/2",
    stocks: [],
    ...overrides,
  };
}

function stock(overrides: Partial<SupplierPart["stocks"][number]> = {}) {
  return { deliveryTime: "2", id: "s1", priceKopeks: 1_000, quantity: 1, ...overrides };
}

describe("rankSupplierParts", () => {
  it("reproduces the measured live-staging case: exact brand+article with real offers beats a normalised-article collision, a stockless collision and a name-mismatched collision", () => {
    // Captured from /api/v1/suppliers/search for the query "W 914/2": Rossko
    // returned these five in this exact order, worst first.
    const unigomHose = part({
      brand: "UNIGOM", guid: "unigom", name: "Шланг радиатора", partNumber: "W9142", stocks: [],
    });
    const nnnFilter = part({
      brand: "NNN", guid: "nnn", name: "Фильтр масляный", partNumber: "W9142", stocks: [],
    });
    const manFilter = part({
      brand: "MAN", guid: "man", name: "Фильтр масляный", partNumber: "W9142", stocks: [],
    });
    const filmantFilter = part({
      brand: "FILMANT", guid: "filmant", name: "Фильтр масляный ВАЗ 2108-",
      partNumber: "W9142", stocks: [stock({ id: "f1" })],
    });
    const mannFilter = part({
      brand: "Mann", guid: "mann", name: "Фильтр масляный", partNumber: "W 914/2",
      stocks: [stock({ id: "m1" }), stock({ id: "m2" }), stock({ id: "m3" }), stock({ id: "m4" }), stock({ id: "m5" })],
    });

    const ranked = rankSupplierParts(
      [unigomHose, nnnFilter, manFilter, filmantFilter, mannFilter],
      "W 914/2",
    );

    expect(ranked.map((p) => p.guid)).toEqual(["mann", "filmant", "nnn", "man", "unigom"]);
  });

  it("never lets a zero-offer part outrank a part that has offers, regardless of match quality", () => {
    const exactButEmpty = part({ guid: "empty-exact", partNumber: "W 914/2", stocks: [] });
    const collisionWithStock = part({
      brand: "OTHER", guid: "collision-stocked", partNumber: "W9142", stocks: [stock()],
    });

    const ranked = rankSupplierParts([exactButEmpty, collisionWithStock], "W 914/2");

    expect(ranked.map((p) => p.guid)).toEqual(["collision-stocked", "empty-exact"]);
  });

  it("ranks an exact brand+article match above a normalised-article-only collision when both have offers", () => {
    const collision = part({ brand: "UNIGOM", guid: "collision", partNumber: "W9142", stocks: [stock()] });
    const exact = part({ brand: "Mann", guid: "exact", partNumber: "W 914/2", stocks: [stock()] });

    // Deliberately fed in "wrong" order so a passing test cannot be an
    // accident of the input order / stable sort.
    const ranked = rankSupplierParts([collision, exact], "W 914/2");

    expect(ranked.map((p) => p.guid)).toEqual(["exact", "collision"]);
  });

  it("demotes, but does not drop, a result whose name is a different kind of part from the majority", () => {
    const hose = part({ guid: "hose", name: "Шланг радиатора", partNumber: "W9142", stocks: [] });
    const filterA = part({ guid: "filter-a", name: "Фильтр масляный", partNumber: "W9142", stocks: [] });
    const filterB = part({ guid: "filter-b", name: "Фильтр масляный", partNumber: "W9142", stocks: [] });

    const ranked = rankSupplierParts([hose, filterA, filterB], "W 914/2");

    expect(ranked.map((p) => p.guid)).toEqual(["filter-a", "filter-b", "hose"]);
    // The outlier is demoted, never removed.
    expect(ranked).toHaveLength(3);
  });

  it("leaves the name signal inactive when there is no clear plurality, so nothing is demoted arbitrarily", () => {
    // Every name distinct: no majority to compare against.
    const a = part({ guid: "a", name: "Фильтр масляный", partNumber: "W9142", stocks: [] });
    const b = part({ guid: "b", name: "Шланг радиатора", partNumber: "W9142", stocks: [] });
    const c = part({ guid: "c", name: "Комплект прокладок", partNumber: "W9142", stocks: [] });

    const ranked = rankSupplierParts([a, b, c], "W 914/2");

    // No offers, no exact match, no active name signal anywhere: original
    // (Rossko) order is preserved via the stable fallback.
    expect(ranked.map((p) => p.guid)).toEqual(["a", "b", "c"]);
  });

  it("keeps Rossko's own relative order as the final tie-break when every signal agrees", () => {
    const first = part({ guid: "first", partNumber: "W9142", stocks: [stock()] });
    const second = part({ guid: "second", partNumber: "W9142", stocks: [stock()] });

    const ranked = rankSupplierParts([first, second], "W 914/2");

    expect(ranked.map((p) => p.guid)).toEqual(["first", "second"]);
  });

  it("does not mutate the input array and returns a shallow copy even for zero or one part", () => {
    const empty: SupplierPart[] = [];
    expect(rankSupplierParts(empty, "W 914/2")).toEqual([]);

    const single = [part({ guid: "solo" })];
    const ranked = rankSupplierParts(single, "W 914/2");
    expect(ranked).toEqual(single);
    expect(ranked).not.toBe(single);
  });
});
