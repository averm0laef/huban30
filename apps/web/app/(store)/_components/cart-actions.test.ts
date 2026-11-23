import { describe, expect, it } from "vitest";

import { isRepeatClick, quantityLimit } from "./cart-actions";

describe("isRepeatClick", () => {
  it("treats the second click of a double click as the same intent", () => {
    expect(isRepeatClick(1_000, 1_120)).toBe(true);
    expect(isRepeatClick(1_000, 1_499)).toBe(true);
  });

  it("lets a first click and a deliberate later click through", () => {
    expect(isRepeatClick(null, 1_000)).toBe(false);
    expect(isRepeatClick(1_000, 1_500)).toBe(false);
    expect(isRepeatClick(1_000, 4_000)).toBe(false);
  });
});

describe("quantityLimit", () => {
  it("stops «+» at the stock the catalog reports", () => {
    expect(quantityLimit(5)).toBe(5);
    expect(quantityLimit(0)).toBe(0);
  });

  it("falls back to the cart limit when stock is unknown or larger", () => {
    expect(quantityLimit()).toBe(100);
    expect(quantityLimit(null)).toBe(100);
    expect(quantityLimit(250)).toBe(100);
  });
});
