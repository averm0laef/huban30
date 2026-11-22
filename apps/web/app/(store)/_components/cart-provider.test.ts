import { describe, expect, it } from "vitest";

import { parseStoredCart, subscribeToStoredCart } from "./cart-provider";

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

describe("subscribeToStoredCart", () => {
  const other = "650e8400-e29b-41d4-a716-446655440000";

  function fakeTab(initial: string | null) {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    let value = initial;
    return {
      emit(type: string, event: object = {}) {
        for (const listener of listeners.get(type) ?? []) listener(event as Event);
      },
      listenerCount: () => Array.from(listeners.values()).reduce((total, set) => total + set.size, 0),
      storage: {
        getItem: () => value,
        removeItem: () => { value = null; },
        setItem: (_key: string, next: string) => { value = next; },
      },
      target: {
        addEventListener(type: string, listener: (event: Event) => void) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(listener);
        },
        removeEventListener(type: string, listener: (event: Event) => void) {
          listeners.get(type)?.delete(listener);
        },
      },
      write(next: string | null) { value = next; },
    };
  }

  it("takes over the cart another tab stored", () => {
    const tab = fakeTab(null);
    const seen: unknown[] = [];
    subscribeToStoredCart(tab.target, tab.storage, (items) => seen.push(items));

    tab.write(JSON.stringify([{ productId, quantity: 1 }, { productId: other, quantity: 3 }]));
    tab.emit("storage", { key: "an30_cart_v1" });
    expect(seen).toEqual([[{ productId, quantity: 1 }, { productId: other, quantity: 3 }]]);

    // The order was sent from the other tab: this one must stop offering it.
    tab.write(null);
    tab.emit("storage", { key: null });
    expect(seen.at(-1)).toEqual([]);
  });

  it("keeps a cart this tab could not save instead of the older stored one", () => {
    const tab = fakeTab(null);
    const seen: unknown[] = [];
    let saved = false;
    subscribeToStoredCart(tab.target, tab.storage, (items) => seen.push(items), () => saved);

    // Reading works, writing does not: storage is empty while the tab holds a cart.
    tab.emit("focus");
    tab.emit("pageshow");
    tab.emit("storage", { key: "an30_cart_v1" });
    expect(seen).toEqual([]);

    saved = true;
    tab.emit("focus");
    expect(seen).toEqual([[]]);
  });

  it("ignores other keys and re-reads when the tab comes back", () => {
    const tab = fakeTab(null);
    const seen: unknown[] = [];
    const unsubscribe = subscribeToStoredCart(tab.target, tab.storage, (items) => seen.push(items));

    tab.write(JSON.stringify([{ productId, quantity: 2 }]));
    tab.emit("storage", { key: "an30_guest_chat" });
    expect(seen).toEqual([]);
    tab.emit("pageshow");
    tab.emit("focus");
    expect(seen).toEqual([[{ productId, quantity: 2 }], [{ productId, quantity: 2 }]]);

    unsubscribe();
    expect(tab.listenerCount()).toBe(0);
  });

  it("keeps the cart on the page when storage cannot be read", () => {
    const tab = fakeTab(null);
    const seen: unknown[] = [];
    const storage = { ...tab.storage, getItem: () => { throw new Error("blocked"); } };
    subscribeToStoredCart(tab.target, storage, (items) => seen.push(items));
    tab.emit("storage", { key: "an30_cart_v1" });
    expect(seen).toEqual([]);
  });
});
