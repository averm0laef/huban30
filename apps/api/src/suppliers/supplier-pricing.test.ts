import { describe, expect, it } from "vitest";

import { applySupplierMarkup } from "./supplier-pricing.js";

describe("applySupplierMarkup", () => {
  it("applies the shop's margin and rounds up to a whole rouble", () => {
    // 456.70 + 30% = 593.71 -> 594.00
    expect(applySupplierMarkup(45_670, 30)).toBe(59_400);
    // 250.00 + 30% = 325.00, already whole
    expect(applySupplierMarkup(25_000, 30)).toBe(32_500);
  });

  it("never returns a price below the purchase price", () => {
    expect(applySupplierMarkup(100, 0)).toBeGreaterThanOrEqual(100);
  });

  it("rejects a non-positive or non-integer purchase price rather than guessing", () => {
    expect(() => applySupplierMarkup(0, 30)).toThrow();
    expect(() => applySupplierMarkup(-1, 30)).toThrow();
    expect(() => applySupplierMarkup(1.5, 30)).toThrow();
  });

  it("rejects a negative margin", () => {
    expect(() => applySupplierMarkup(1_000, -5)).toThrow();
  });
});
