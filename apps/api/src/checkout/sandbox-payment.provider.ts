import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CryptoService } from "../security/crypto.service.js";
import type {
  CreatePaymentInput,
  PaymentProvider,
  PreparedPayment,
  PreparedRefund,
  RefundPaymentInput,
} from "./payment-provider.js";

@Injectable()
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox";
  private readonly webhookSecret?: string;

  constructor(config: ConfigService, private readonly crypto: CryptoService) {
    this.webhookSecret = config.get<string>("SANDBOX_PAYMENT_WEBHOOK_SECRET");
  }

  confirmationToken(idempotencyKey: string): string {
    return this.crypto.deriveOpaqueToken("sandbox-payment-confirmation", idempotencyKey);
  }

  preparePayment(input: CreatePaymentInput): PreparedPayment {
    const externalPaymentId = `sandbox-payment-${randomUUID()}`;
    const confirmationToken = this.confirmationToken(input.idempotencyKey);
    return {
      confirmationToken,
      confirmationUrl: `/api/v1/payments/sandbox/${externalPaymentId}/complete`,
      externalPaymentId,
      metadata: {
        sandboxScenario: input.scenario,
        sandboxTokenHash: this.crypto
          .opaqueHash("sandbox-payment-confirmation", confirmationToken)
          .toString("base64url"),
      },
    };
  }

  async refund(_input: RefundPaymentInput): Promise<PreparedRefund> {
    return {
      externalRefundId: `sandbox-refund-${randomUUID()}`,
      status: "succeeded",
    };
  }

  verifyWebhook(payload: unknown, signature: string | undefined): boolean {
    if (!signature || !this.webhookSecret) return false;
    const expected = createHmac("sha256", this.webhookSecret)
      .update(JSON.stringify(payload), "utf8")
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      return false;
    }
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
