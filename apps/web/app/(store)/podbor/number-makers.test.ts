import { describe, expect, it } from "vitest";

import type { ShopOffer } from "../_lib/parts-finder";
import { numberMakers } from "./number-makers";

const offer = (productId: string, brand: string | null, extra: Partial<ShopOffer> = {}): ShopOffer => ({
  availableQuantity: 0, brand, matchedVia: "exact", name: `Товар ${productId}`, priceKopeks: 10_000, productId, sku: "3930", slug: productId, ...extra,
});

describe("one number, several makers", () => {
  it("asks whose part the customer means when the number belongs to several makers", () => {
    const makers = numberMakers([
      offer("oil", "LIQUI MOLY", { name: "10W-40 SL/CF OPTIMAL 4л", priceKopeks: 300_000 }),
      offer("lamp", "OSRAM", { availableQuantity: 1, name: "Лампа T4W 24V BA9s Osram", priceKopeks: 10_000 }),
      offer("lamp-twin", "Osram", { name: "Лампа OSRAM 3930", priceKopeks: 5_000 }),
      offer("analog", "NARVA", { matchedVia: "cross" }),
    ]);
    expect(makers.map((maker) => [maker.brand, maker.offers.map((item) => item.productId), maker.fromKopeks, maker.inStock])).toEqual([
      ["OSRAM", ["lamp", "lamp-twin"], 5_000, true],
      ["LIQUI MOLY", ["oil"], 300_000, false],
    ]);
    expect(makers[0]!.example).toBe("Лампа T4W 24V BA9s Osram");
  });

  it("asks nothing when the number is one maker's, or names no maker but one", () => {
    expect(numberMakers([offer("a", "OSRAM"), offer("b", "Osram"), offer("c", "NARVA", { matchedVia: "cross" })])).toEqual([]);
    expect(numberMakers([offer("a", null)])).toEqual([]);
  });

  it("keeps products without a maker apart", () => {
    expect(numberMakers([offer("a", "OSRAM"), offer("b", null)]).map((maker) => maker.brand)).toEqual(["OSRAM", null]);
  });
});
