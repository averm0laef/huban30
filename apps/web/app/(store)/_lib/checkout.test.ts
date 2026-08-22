import { describe, expect, it } from "vitest";

import { checkoutItems, checkoutPayload } from "./checkout";

const productA = "550e8400-e29b-41d4-a716-446655440000";
const productB = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("checkout boundary", () => {
  it("keeps only UUID and quantity in canonical order", () => {
    expect(checkoutItems([
      { productId: productB, quantity: 2 },
      { productId: "not-an-id", quantity: 1 },
      { productId: productA, quantity: 3 },
    ])).toEqual([
      { productId: productA, quantity: 3 },
      { productId: productB, quantity: 2 },
    ]);
  });

  it("never adds a user-controlled sandbox scenario", () => {
    const payload = checkoutPayload({
      customerNote: "Позвонить заранее",
      deliveryMethod: "pickup",
      email: " Client@Example.RU ",
      name: " Антон ",
      phone: "+79240000000",
    }, [{ productId: productA, quantity: 1 }], productB, {
      personalDataConsent: true,
      termsAccepted: true,
    });
    expect(payload).not.toHaveProperty("sandboxScenario");
    expect(payload.contact).toEqual({ email: "client@example.ru", name: "Антон", phone: "+79240000000" });
  });

  it("never fabricates either legal action when building the request", () => {
    const payload = checkoutPayload({
      deliveryMethod: "pickup",
      email: "client@example.ru",
      name: "Антон",
      phone: "+79240000000",
    }, [{ productId: productA, quantity: 1 }], productB, {
      personalDataConsent: false,
      termsAccepted: true,
    });

    expect(payload.termsAccepted).toBe(true);
    expect(payload.personalDataConsent).toBe(false);
    expect(payload.personalDataConsentVersion).toBe("checkout-personal-data-2026-08-15-v1");
  });
});
