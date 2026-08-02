import { describe, expect, it } from "vitest";

import { summariseCart } from "./cart-products";
import type { CartProductState, CartProductView } from "./cart-products";

const productA = "11111111-1111-4111-8111-111111111111";
const productB = "22222222-2222-4222-8222-222222222222";

function ready(overrides: Partial<CartProductView> = {}): CartProductState {
  return {
    product: {
      availableQuantity: 5,
      brandName: "Bosch",
      imageUrl: null,
      name: "Фильтр масляный",
      priceKopeks: 125_000,
      sku: "F-1",
      slug: "filtr-maslyanyj",
      ...overrides,
    },
    status: "ready",
  };
}

describe("summariseCart", () => {
  it("multiplies the catalog price by the quantity of each line", () => {
    const summary = summariseCart(
      [{ productId: productA, quantity: 3 }],
      { [productA]: ready() },
    );

    expect(summary.lines[0]?.subtotalKopeks).toBe(375_000);
    expect(summary.knownSubtotalKopeks).toBe(375_000);
    expect(summary.pricesComplete).toBe(true);
    expect(summary.hasUnavailable).toBe(false);
  });

  it("keeps the total partial while a line is still loading", () => {
    const summary = summariseCart(
      [{ productId: productA, quantity: 1 }, { productId: productB, quantity: 2 }],
      { [productA]: ready() },
    );

    expect(summary.knownSubtotalKopeks).toBe(125_000);
    expect(summary.pricesComplete).toBe(false);
    expect(summary.lines[1]?.state.status).toBe("loading");
    expect(summary.lines[1]?.subtotalKopeks).toBeNull();
  });

  it("reports a line the catalog no longer sells", () => {
    const summary = summariseCart(
      [{ productId: productA, quantity: 1 }],
      { [productA]: { status: "unavailable" } },
    );

    expect(summary.hasUnavailable).toBe(true);
    expect(summary.knownSubtotalKopeks).toBe(0);
    expect(summary.pricesComplete).toBe(false);
  });

  it("treats a product without a price as not yet priced", () => {
    const summary = summariseCart(
      [{ productId: productA, quantity: 4 }],
      { [productA]: ready({ priceKopeks: null }) },
    );

    expect(summary.lines[0]?.subtotalKopeks).toBeNull();
    expect(summary.pricesComplete).toBe(false);
    expect(summary.knownSubtotalKopeks).toBe(0);
  });

  it("does not let a failed lookup hide the line", () => {
    const summary = summariseCart(
      [{ productId: productA, quantity: 2 }],
      { [productA]: { status: "error" } },
    );

    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]?.quantity).toBe(2);
    expect(summary.hasUnavailable).toBe(false);
    expect(summary.pricesComplete).toBe(false);
  });
});
