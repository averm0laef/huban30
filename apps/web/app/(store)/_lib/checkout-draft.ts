/**
 * What the customer typed on the checkout page, kept for the tab.
 *
 * Checkout sends the customer back to the cart to fix a quantity («Изменить
 * корзину»), and a refused order does the same. Without the draft the form
 * came back empty and everything had to be typed again. It lives in
 * sessionStorage: this tab only, gone when the tab closes, removed once the
 * order is sent. Consents are not kept: they are given anew every time.
 */
export interface CheckoutDraft {
  address: string;
  customerNote: string;
  deliveryMethod: "needs_quote" | "pickup";
  email: string;
  name: string;
  phone: string;
}

interface DraftStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

const STORAGE_KEY = "an30_checkout_draft_v1";
// The same limits as the form fields.
const LIMITS = { address: 1000, customerNote: 2000, email: 254, name: 160, phone: 16 } as const;

export const EMPTY_CHECKOUT_DRAFT: CheckoutDraft = {
  address: "", customerNote: "", deliveryMethod: "pickup", email: "", name: "", phone: "",
};

/**
 * The tab's storage, or null where the browser blocks it: there reading
 * `sessionStorage` itself throws, before any call on it.
 */
export function checkoutDraftStorage(source: { sessionStorage: DraftStorage }): DraftStorage | null {
  try {
    return source.sessionStorage;
  } catch {
    return null;
  }
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

export function parseCheckoutDraft(raw: string | null): CheckoutDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const draft = value as Record<string, unknown>;
    return {
      address: text(draft.address, LIMITS.address),
      customerNote: text(draft.customerNote, LIMITS.customerNote),
      deliveryMethod: draft.deliveryMethod === "needs_quote" ? "needs_quote" : "pickup",
      email: text(draft.email, LIMITS.email),
      name: text(draft.name, LIMITS.name),
      phone: text(draft.phone, LIMITS.phone),
    };
  } catch {
    return null;
  }
}

export function readCheckoutDraft(storage: DraftStorage | null): CheckoutDraft | null {
  if (!storage) return null;
  try {
    return parseCheckoutDraft(storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function isEmpty(draft: CheckoutDraft): boolean {
  return !draft.address && !draft.customerNote && !draft.email && !draft.name && !draft.phone
    && draft.deliveryMethod === "pickup";
}

export function saveCheckoutDraft(storage: DraftStorage | null, draft: CheckoutDraft): void {
  if (!storage) return;
  try {
    if (isEmpty(draft)) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The form still works without the draft.
  }
}

export function clearCheckoutDraft(storage: DraftStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
