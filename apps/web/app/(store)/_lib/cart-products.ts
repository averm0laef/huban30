"use client";

import { useEffect, useState } from "react";

import { CatalogProductDetailSchema } from "@an30/contracts";

import type { CartLine } from "../_components/cart-provider";
import { StorefrontApiError, apiRequest } from "./storefront-api";

/**
 * Display-only catalog data for the lines kept in the browser cart.
 *
 * The cart itself stores nothing but product identifiers and quantities, so the
 * name and price shown here are fetched from the public catalog for orientation.
 * Checkout still recomputes both on the server, which stays the only source of
 * the amount an order is created with.
 */
export interface CartProductView {
  availableQuantity: number;
  brandName: string | null;
  category?: { name: string; slug: string } | null;
  imageUrl: string | null;
  name: string;
  priceKopeks: number | null;
  sku: string;
  slug: string;
}

export type CartProductState =
  | { status: "loading" }
  | { status: "ready"; product: CartProductView }
  | { status: "unavailable" }
  | { status: "error" };

export interface CartLineView {
  /** Stock the catalog reports for the line; null until the product is loaded. */
  availableQuantity: number | null;
  imageAlt: string;
  /** The cart holds more pieces than the catalog has: checkout would be refused. */
  overStock: boolean;
  productId: string;
  quantity: number;
  state: CartProductState;
  subtotalKopeks: number | null;
}

export interface CartSummary {
  hasOverStock: boolean;
  hasUnavailable: boolean;
  knownSubtotalKopeks: number;
  lines: CartLineView[];
  pricesComplete: boolean;
}

const cache = new Map<string, CartProductState>();
const inflight = new Map<string, Promise<CartProductState>>();

function toView(parsed: ReturnType<typeof CatalogProductDetailSchema.parse>): CartProductView {
  return {
    availableQuantity: parsed.availableQuantity,
    brandName: parsed.brand?.name ?? null,
    category: parsed.category,
    imageUrl: parsed.primaryImage?.url ?? parsed.images[0]?.url ?? null,
    name: parsed.name,
    priceKopeks: parsed.priceKopeks,
    sku: parsed.sku,
    slug: parsed.slug,
  };
}

async function loadProduct(productId: string): Promise<CartProductState> {
  try {
    const payload = await apiRequest<unknown>(`/catalog/products/${encodeURIComponent(productId)}`);
    const parsed = CatalogProductDetailSchema.safeParse(payload);
    if (!parsed.success) return { status: "error" };
    return { product: toView(parsed.data), status: "ready" };
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) return { status: "unavailable" };
    return { status: "error" };
  }
}

/** Resolves a product once and reuses the result for the rest of the visit. */
export function fetchCartProduct(productId: string): Promise<CartProductState> {
  const cached = cache.get(productId);
  if (cached && cached.status !== "error") return Promise.resolve(cached);
  const running = inflight.get(productId);
  if (running) return running;
  const request = loadProduct(productId).then((state) => {
    // An answer that was requested before a refresh is not kept as the fresh one.
    if (inflight.get(productId) !== request) return state;
    if (state.status !== "error") cache.set(productId, state);
    inflight.delete(productId);
    return state;
  });
  inflight.set(productId, request);
  return request;
}

/** Short text for a line that holds more than the catalog has. */
export function overStockNote(availableQuantity: number): string {
  return availableQuantity > 0 ? `В наличии только ${availableQuantity} шт.` : "Нет в наличии";
}

export function resetCartProductCache(): void {
  cache.clear();
  inflight.clear();
}

const refreshListeners = new Set<() => void>();

export function subscribeToCartProductRefresh(listener: () => void): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

/**
 * Forgets what the catalog said and makes every open cart ask again.
 *
 * Checkout calls it when the server refuses an order: price or stock changed
 * after the page read them, and the page must show the current ones.
 */
export function refreshCartProducts(): void {
  resetCartProductCache();
  for (const listener of refreshListeners) listener();
}

/** Builds the rendered cart rows and the indicative total, without any I/O. */
export function summariseCart(
  items: CartLine[],
  products: Record<string, CartProductState>,
): CartSummary {
  let knownSubtotalKopeks = 0;
  let pricesComplete = true;
  let hasUnavailable = false;
  let hasOverStock = false;

  const lines = items.map((item) => {
    const state = products[item.productId] ?? { status: "loading" as const };
    const price = state.status === "ready" ? state.product.priceKopeks : null;
    const subtotalKopeks = price === null ? null : price * item.quantity;
    if (subtotalKopeks === null) pricesComplete = false;
    else knownSubtotalKopeks += subtotalKopeks;
    if (state.status === "unavailable") hasUnavailable = true;
    const availableQuantity = state.status === "ready" ? state.product.availableQuantity : null;
    const overStock = availableQuantity !== null && item.quantity > availableQuantity;
    if (overStock) hasOverStock = true;
    return {
      availableQuantity,
      imageAlt: state.status === "ready" ? state.product.name : "Товар корзины",
      productId: item.productId,
      overStock,
      quantity: item.quantity,
      state,
      subtotalKopeks,
    };
  });

  return { hasOverStock, hasUnavailable, knownSubtotalKopeks, lines, pricesComplete };
}

/** Loads catalog details for every cart line and re-renders as they arrive. */
export function useCartProducts(items: CartLine[]): Record<string, CartProductState> {
  const key = items.map((item) => item.productId).join(",");
  const [products, setProducts] = useState<Record<string, CartProductState>>({});
  const [revision, setRevision] = useState(0);

  useEffect(() => subscribeToCartProductRefresh(() => setRevision((current) => current + 1)), []);

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setProducts({});
      return;
    }
    let active = true;
    setProducts((current) => {
      const next: Record<string, CartProductState> = {};
      for (const id of ids) next[id] = current[id] ?? cache.get(id) ?? { status: "loading" };
      return next;
    });
    for (const id of ids) {
      void fetchCartProduct(id).then((state) => {
        if (!active) return;
        setProducts((current) => (id in current ? { ...current, [id]: state } : current));
      });
    }
    return () => {
      active = false;
    };
  }, [key, revision]);

  return products;
}
