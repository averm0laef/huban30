import type { CheckoutSandboxScenario } from "@an30/contracts";

export interface CreatePaymentInput {
  amountKopeks: number;
  currency: "RUB";
  idempotencyKey: string;
  orderId: string;
  scenario: CheckoutSandboxScenario;
}

export interface PreparedPayment {
  confirmationToken: string;
  confirmationUrl: string;
  externalPaymentId: string;
  metadata: Record<string, unknown>;
}

export interface PreparedRefund {
  externalRefundId: string;
  status: "succeeded";
}

export interface RefundPaymentInput {
  amountKopeks: number;
  externalPaymentId: string;
  idempotencyKey: string;
}

export interface PaymentProvider {
  readonly name: string;
  preparePayment(input: CreatePaymentInput): PreparedPayment;
  refund(input: RefundPaymentInput): Promise<PreparedRefund>;
  verifyWebhook(payload: unknown, signature: string | undefined): boolean;
}
