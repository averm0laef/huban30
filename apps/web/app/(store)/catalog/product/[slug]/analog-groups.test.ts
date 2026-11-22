import { describe, expect, it } from "vitest";

import type { ShopOffer } from "../../../_lib/parts-finder";
import { analogGroups, basisText, inStockAlternative } from "./analog-groups";

const offer = (productId: string, extra: Partial<ShopOffer>): ShopOffer => ({
  availableQuantity: 0, brand: "OSRAM", matchedVia: "exact", name: `Лампа ${productId}`, priceKopeks: 10_000, productId, sku: "3930", slug: productId, ...extra,
});

describe("the analogs of a product card, in the order a customer can trust them", () => {
  const result = {
    article: "3930",
    offers: [
      offer("self", {}),
      offer("twin", { availableQuantity: 0, basis: "same_number", priceKopeks: 5_000 }),
      offer("possible", { availableQuantity: 9, basis: "supplier", matchedVia: "possible" }),
      offer("checked-out", { basis: "maker", matchedVia: "cross", priceKopeks: 9_000 }),
      offer("checked-in", { availableQuantity: 2, basis: "shop", matchedVia: "cross", priceKopeks: 12_000 }),
    ],
    sameSize: { label: "T4W 24 В BA9s", offers: [offer("narva", { availableQuantity: 3, basis: "same_size", brand: "NARVA", matchedVia: "same_size" })] },
  };

  it("puts the same part, checked analogs, the same size and possible analogs apart, in stock first", () => {
    const groups = analogGroups(result, "self");
    expect(groups.same.map((item) => item.productId)).toEqual(["twin"]);
    expect(groups.checked.map((item) => item.productId)).toEqual(["checked-in", "checked-out"]);
    expect(groups.sameSize.map((item) => item.productId)).toEqual(["narva"]);
    expect(groups.sizeLabel).toBe("T4W 24 В BA9s");
    expect(groups.possible.map((item) => item.productId)).toEqual(["possible"]);
  });

  it("offers what to buy instead when the product is out of stock: the same part, a checked analog, the same size", () => {
    expect(inStockAlternative(analogGroups(result, "self"))?.productId).toBe("checked-in");
    const onlySize = analogGroups({ ...result, offers: [offer("possible", { availableQuantity: 9, matchedVia: "possible" })] }, "self");
    expect(inStockAlternative(onlySize)?.productId).toBe("narva");
    expect(inStockAlternative(analogGroups({ article: "3930", offers: [offer("possible", { availableQuantity: 9, matchedVia: "possible" })] }, "self"))).toBeNull();
  });

  it("says in a few words why each one is there", () => {
    expect(basisText(offer("a", { basis: "shop" }), null)).toBe("подтверждено магазином");
    expect(basisText(offer("a", { basis: "maker" }), null)).toBe("по каталогу производителя");
    expect(basisText(offer("a", { basis: "supplier" }), null)).toBe("по данным поставщика");
    expect(basisText(offer("a", { basis: "same_size" }), "T4W 24 В BA9s")).toBe("тот же типоразмер: T4W 24 В BA9s");
    expect(basisText(offer("a", { matchedVia: "possible" }), null)).toBe("возможный аналог");
    expect(basisText(offer("a", {}), null)).toBe("тот же номер");
  });
});
