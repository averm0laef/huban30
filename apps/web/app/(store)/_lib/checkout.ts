import {
  CHECKOUT_LEGAL_POLICY_VERSION,
  CHECKOUT_PERSONAL_DATA_CONSENT_VERSION,
} from "@an30/contracts";

import type { CartLine } from "../_components/cart-provider";
import type { ShopStatus } from "../_components/shop-status";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface CheckoutFormValue {
  address?: string;
  customerNote?: string;
  deliveryMethod: "needs_quote" | "pickup";
  email: string;
  name: string;
  phone: string;
}

export interface CheckoutLegalAcceptance {
  personalDataConsent: boolean;
  termsAccepted: boolean;
}

export function checkoutItems(lines: CartLine[]) {
  const unique = new Map<string, number>();
  for (const line of lines) {
    if (!UUID_PATTERN.test(line.productId)) continue;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) continue;
    unique.set(line.productId, line.quantity);
  }
  return Array.from(unique, ([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
}

export function checkoutPayload(
  value: CheckoutFormValue,
  lines: CartLine[],
  idempotencyKey: string,
  legalAcceptance: CheckoutLegalAcceptance,
) {
  const delivery = value.deliveryMethod === "pickup"
    ? { method: "pickup" as const }
    : { address: value.address?.trim() ?? "", method: "needs_quote" as const };
  return {
    contact: { email: value.email.trim().toLowerCase(), name: value.name.trim(), phone: value.phone.trim() },
    customerNote: value.customerNote?.trim() || null,
    delivery,
    idempotencyKey,
    items: checkoutItems(lines),
    legalPolicyVersion: CHECKOUT_LEGAL_POLICY_VERSION,
    personalDataConsent: legalAcceptance.personalDataConsent,
    personalDataConsentVersion: CHECKOUT_PERSONAL_DATA_CONSENT_VERSION,
    termsAccepted: legalAcceptance.termsAccepted,
  };
}

/**
 * There is no payment step left to confirm and no reservation timer left to
 * count down (see checkout.service.ts) -- the only thing left to promise the
 * customer honestly is when a manager will call. The shop's own promise
 * (see MANAGER_WAITING_TEXT in chat-state.ts) is "about 10 minutes", but
 * only while someone is actually on shift to keep it -- `shop` comes from
 * `computeShopStatusNow` so this never claims a 10-minute callback at 2am.
 */
export function checkoutConfirmationMessage(shop: ShopStatus): string {
  return shop.open
    ? "Заявка принята. Менеджер перезвонит вам в течение 10 минут, чтобы подтвердить заказ."
    : `Заявка принята. Магазин ${shop.detail} — мы позвоним вам, как только начнём работать, чтобы подтвердить заказ.`;
}
