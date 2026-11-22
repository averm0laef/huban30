import { describe, expect, it } from "vitest";

import { canonicalBrand, decideProductLink } from "./parts-finder-assortment.logic.js";

const identities = new Map([["MANN", "MANN"], ["MANNFILTER", "MANN"], ["TOYOTA", "TOYOTA"], ["LEXUS", "TOYOTA"]]);

describe("linking our products to the parts catalogue", () => {
  it("compares brands by identity, not spelling", () => {
    expect(canonicalBrand("Mann-Filter", identities)).toBe("MANN");
    expect(canonicalBrand("mann", identities)).toBe("MANN");
    expect(canonicalBrand("Febest", identities)).toBe("FEBEST");
    expect(canonicalBrand(null, identities)).toBe("");
  });

  it("links a card whose brand is ours", () => {
    const card = { part: { article: "W 914/2", brand: "MANN-FILTER" }, status: "found" };
    expect(decideProductLink(card, "MANN", identities)).toEqual({ action: "linked" });
    const replaced = { current: { article: "W 914/3", brand: "MANN-FILTER" }, part: { article: "W 914/2", brand: "MANN-FILTER" }, status: "found" };
    expect(decideProductLink(replaced, "Mann-Filter", identities)).toEqual({ action: "linked" });
  });

  it("asks for our brand when several brands share the number", () => {
    const card = { candidates: [{ article: "1234", brand: "BOSCH", manufacturer_id: 30 }, { article: "1234", brand: "MANN-FILTER", manufacturer_id: 4 }], status: "choose_brand" };
    expect(decideProductLink(card, "MANN", identities)).toEqual({ action: "ask_brand", manufacturerId: 4 });
  });

  it("never links by number alone", () => {
    const card = { part: { article: "1234", brand: "BOSCH" }, status: "found" };
    expect(decideProductLink(card, "MANN", identities)).toEqual({ action: "brand_mismatch", note: "BOSCH" });
    const several = { candidates: [{ article: "1234", brand: "BOSCH", manufacturer_id: 30 }, { article: "1234", brand: "HELLA", manufacturer_id: 2 }], status: "choose_brand" };
    expect(decideProductLink(several, "MANN", identities)).toEqual({ action: "brand_mismatch", note: "BOSCH, HELLA" });
    expect(decideProductLink({ status: "no_data" }, "MANN", identities)).toEqual({ action: "no_data" });
  });
});
