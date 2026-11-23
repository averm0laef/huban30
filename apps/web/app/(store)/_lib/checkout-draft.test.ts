import { describe, expect, it } from "vitest";

import {
  EMPTY_CHECKOUT_DRAFT, clearCheckoutDraft, parseCheckoutDraft, readCheckoutDraft, saveCheckoutDraft,
} from "./checkout-draft";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
    size: () => values.size,
  };
}

const filled = {
  address: "Хабаровск, ул. Тестовая, 1", customerNote: "Позвонить после 18:00", deliveryMethod: "needs_quote" as const,
  email: "buyer@example.test", name: "Покупатель", phone: "+79990000001",
};

describe("checkout draft", () => {
  it("returns what the customer typed after a trip to the cart", () => {
    const storage = memoryStorage();
    saveCheckoutDraft(storage, filled);
    expect(readCheckoutDraft(storage)).toEqual(filled);
  });

  it("is removed once the order is sent, and is not stored while the form is empty", () => {
    const storage = memoryStorage();
    saveCheckoutDraft(storage, filled);
    clearCheckoutDraft(storage);
    expect(readCheckoutDraft(storage)).toBeNull();

    saveCheckoutDraft(storage, filled);
    saveCheckoutDraft(storage, EMPTY_CHECKOUT_DRAFT);
    expect(storage.size()).toBe(0);
  });

  it("never keeps consents and ignores anything that is not text", () => {
    const draft = parseCheckoutDraft(JSON.stringify({
      ...filled, name: 42, personalDataConsent: true, termsAccepted: true, deliveryMethod: "courier",
    }));
    expect(draft).toEqual({ ...filled, name: "", deliveryMethod: "pickup" });
    expect(parseCheckoutDraft(JSON.stringify({ name: "x".repeat(500) }))?.name).toHaveLength(160);
  });

  it("survives damaged or unavailable storage", () => {
    expect(parseCheckoutDraft("not-json")).toBeNull();
    expect(parseCheckoutDraft("[1]")).toBeNull();
    const broken = {
      getItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(readCheckoutDraft(broken)).toBeNull();
    expect(() => saveCheckoutDraft(broken, filled)).not.toThrow();
    expect(() => clearCheckoutDraft(broken)).not.toThrow();
  });
});
