"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "an30_cart_v1";
const MAX_ITEM_QUANTITY = 100;
const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface CartLine {
  productId: string;
  quantity: number;
}

interface CartContextValue {
  addItem: (productId: string, quantity?: number) => void;
  clear: () => void;
  itemCount: number;
  hydrated: boolean;
  items: CartLine[];
  persistenceAvailable: boolean;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
}

interface CartStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function parseStoredCart(value: string | null): CartLine[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, number>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const line = entry as Record<string, unknown>;
      if (typeof line.productId !== "string" || !PRODUCT_ID_PATTERN.test(line.productId)) continue;
      if (!Number.isInteger(line.quantity) || Number(line.quantity) < 1) continue;
      unique.set(line.productId, Math.min(MAX_ITEM_QUANTITY, Number(line.quantity)));
    }
    return Array.from(unique, ([productId, quantity]) => ({ productId, quantity }));
  } catch {
    return [];
  }
}

export function readStoredCart(storage: CartStorage): { available: boolean; items: CartLine[] } {
  try {
    return { available: true, items: parseStoredCart(storage.getItem(STORAGE_KEY)) };
  } catch {
    return { available: false, items: [] };
  }
}

export function persistStoredCart(storage: CartStorage, items: CartLine[]): boolean {
  try {
    if (items.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): CartStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceAvailable, setPersistenceAvailable] = useState(true);

  useEffect(() => {
    const storage = browserStorage();
    if (!storage) {
      setPersistenceAvailable(false);
    } else {
      const stored = readStoredCart(storage);
      setItems(stored.items);
      setPersistenceAvailable(stored.available);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const storage = browserStorage();
    setPersistenceAvailable(storage ? persistStoredCart(storage, items) : false);
  }, [hydrated, items]);

  const addItem = useCallback((productId: string, quantity = 1) => {
    if (!PRODUCT_ID_PATTERN.test(productId)) return;
    const safeQuantity = Math.max(1, Math.min(MAX_ITEM_QUANTITY, Math.trunc(quantity)));
    setItems((current) => {
      const existing = current.find((line) => line.productId === productId);
      if (!existing) return [...current, { productId, quantity: safeQuantity }];
      return current.map((line) => line.productId === productId
        ? { ...line, quantity: Math.min(MAX_ITEM_QUANTITY, line.quantity + safeQuantity) }
        : line);
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((current) => current.filter((line) => line.productId !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (!Number.isFinite(quantity) || quantity < 1) {
      removeItem(productId);
      return;
    }
    setItems((current) => current.map((line) => line.productId === productId
      ? { ...line, quantity: Math.min(MAX_ITEM_QUANTITY, Math.trunc(quantity)) }
      : line));
  }, [removeItem]);

  const clear = useCallback(() => setItems([]), []);
  const itemCount = items.reduce((total, line) => total + line.quantity, 0);
  const value = useMemo(() => ({ addItem, clear, hydrated, itemCount, items, persistenceAvailable, removeItem, updateQuantity }), [addItem, clear, hydrated, itemCount, items, persistenceAvailable, removeItem, updateQuantity]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
