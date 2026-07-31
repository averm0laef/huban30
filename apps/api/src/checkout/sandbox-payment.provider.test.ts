import { createHmac } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import type { CryptoService } from "../security/crypto.service.js";
import { SandboxPaymentProvider } from "./sandbox-payment.provider.js";

const webhookSecret = "sandbox-provider-test-secret-with-more-than-32-characters";
const config = {
  get: () => webhookSecret,
} as unknown as ConfigService;
const crypto = {
  opaqueHash: () => Buffer.alloc(32, 7),
  randomToken: () => "sandbox-confirmation-token-with-sufficient-entropy",
} as unknown as CryptoService;

describe("sandbox payment provider", () => {
  it("keeps only a hash of the confirmation token", () => {
    const provider = new SandboxPaymentProvider(config, crypto);
    const payment = provider.preparePayment({
      amountKopeks: 10_000,
      currency: "RUB",
      idempotencyKey: "checkout:test",
      orderId: "019bf9ea-0d3e-7def-9c9a-000000000001",
      scenario: "success",
    });
    expect(payment.confirmationToken).toContain("confirmation-token");
    expect(JSON.stringify(payment.metadata)).not.toContain(payment.confirmationToken);
    expect(payment.metadata.sandboxTokenHash).toBe(Buffer.alloc(32, 7).toString("base64url"));
  });

  it("verifies the canonical sandbox webhook signature", () => {
    const provider = new SandboxPaymentProvider(config, crypto);
    const payload = { amountKopeks: 10_000, externalEventId: "event-1" };
    const signature = createHmac("sha256", webhookSecret)
      .update(JSON.stringify(payload), "utf8")
      .digest("base64url");
    expect(provider.verifyWebhook(payload, signature)).toBe(true);
    expect(provider.verifyWebhook(payload, "invalid")).toBe(false);
  });
});
