import { CHECKOUT_LEGAL_POLICY_VERSION } from "@an30/contracts";

import type { CartLine } from "../_components/cart-provider";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface CheckoutFormValue {
  address?: string;
  customerNote?: string;
  deliveryMethod: "needs_quote" | "pickup";
  email: string;
  name: string;
  phone: string;
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

export function checkoutPayload(value: CheckoutFormValue, lines: CartLine[], idempotencyKey: string) {
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
    termsAccepted: true as const,
  };
}
