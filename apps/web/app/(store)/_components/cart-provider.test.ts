import { describe, expect, it } from "vitest";

import { parseStoredCart } from "./cart-provider";

const productId = "550e8400-e29b-41d4-a716-446655440000";

describe("parseStoredCart", () => {
  it("keeps only a product identifier and a safe quantity", () => {
    const result = parseStoredCart(JSON.stringify([{ productId, quantity: 2, price: 1, title: "unsafe" }]));
    expect(result).toEqual([{ productId, quantity: 2 }]);
  });

  it("rejects malformed persisted data", () => {
    expect(parseStoredCart("not-json")).toEqual([]);
    expect(parseStoredCart(JSON.stringify([{ productId: "wrong", quantity: 2 }]))).toEqual([]);
    expect(parseStoredCart(JSON.stringify([{ productId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 2 }]))).toEqual([]);
  });

  it("deduplicates lines and caps quantity", () => {
    const result = parseStoredCart(JSON.stringify([
      { productId, quantity: 1 },
      { productId, quantity: 500 },
    ]));
    expect(result).toEqual([{ productId, quantity: 100 }]);
  });
});
