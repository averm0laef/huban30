import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCartProduct, overStockNote, refreshCartProducts, resetCartProductCache, subscribeToCartProductRefresh,
  summariseCart,
} from "./cart-products";
import { StorefrontApiError, apiRequest } from "./storefront-api";
import type { CartProductState, CartProductView } from "./cart-products";

vi.mock("./storefront-api", async (original) => ({
  ...(await original<typeof import("./storefront-api")>()),
  apiRequest: vi.fn(),
}));

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

  it("marks a line that holds more pieces than the catalog has", () => {
    const summary = summariseCart(
      [{ productId: productA, quantity: 6 }, { productId: productB, quantity: 5 }],
      { [productA]: ready(), [productB]: ready() },
    );

    expect(summary.hasOverStock).toBe(true);
    expect(summary.lines.map((line) => line.overStock)).toEqual([true, false]);
    expect(summary.lines[0]?.availableQuantity).toBe(5);
    expect(overStockNote(5)).toBe("В наличии только 5 шт.");
    expect(overStockNote(0)).toBe("Нет в наличии");
  });

  it("does not guess stock for a line that is still loading", () => {
    const summary = summariseCart([{ productId: productA, quantity: 99 }], {});

    expect(summary.hasOverStock).toBe(false);
    expect(summary.lines[0]?.availableQuantity).toBeNull();
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

describe("refreshCartProducts", () => {
  const request = vi.mocked(apiRequest);

  beforeEach(() => {
    resetCartProductCache();
    request.mockReset();
    request.mockRejectedValue(new StorefrontApiError("Не найдено", 404, null));
  });

  it("asks the catalog again after a refused order and tells open carts to re-read", async () => {
    await fetchCartProduct(productA);
    await fetchCartProduct(productA);
    expect(request).toHaveBeenCalledTimes(1);

    const rereads: number[] = [];
    const unsubscribe = subscribeToCartProductRefresh(() => rereads.push(request.mock.calls.length));
    refreshCartProducts();
    expect(rereads).toEqual([1]);

    expect((await fetchCartProduct(productA)).status).toBe("unavailable");
    expect(request).toHaveBeenCalledTimes(2);

    unsubscribe();
    refreshCartProducts();
    expect(rereads).toEqual([1]);
  });

  it("does not keep an answer that was requested before the refresh", async () => {
    const answers: Array<(error: unknown) => void> = [];
    request.mockImplementation(() => new Promise((_resolve, reject) => { answers.push(reject); }));
    const old = fetchCartProduct(productA);

    refreshCartProducts();
    const fresh = fetchCartProduct(productA);
    answers[0]?.(new StorefrontApiError("Не найдено", 404, null));
    await old;

    // The old answer is not served as the current one: the cart still waits for the fresh request.
    expect(fetchCartProduct(productA)).toBe(fresh);
    answers[1]?.(new StorefrontApiError("Не найдено", 404, null));
    expect((await fresh).status).toBe("unavailable");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
