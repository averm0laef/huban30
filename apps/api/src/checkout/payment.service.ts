import { createHash, timingSafeEqual } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import { z } from "zod";

import { RefundRequestSchema, type PaymentStatus } from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { CryptoService } from "../security/crypto.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { SandboxPaymentProvider } from "./sandbox-payment.provider.js";

const SandboxWebhookSchema = z.object({
  amountKopeks: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  externalEventId: z.string().trim().min(1).max(200),
  externalPaymentId: z.string().trim().min(1).max(240),
  status: z.enum(["succeeded", "failed", "cancelled"]),
}).strict();
type SandboxWebhook = z.infer<typeof SandboxWebhookSchema>;

interface PaymentRow {
  amount_kopeks: string;
  external_payment_id: string;
  id: string;
  kind: "delivery" | "goods" | "manual_adjustment";
  order_id: string;
  provider_metadata: Record<string, unknown>;
  refunded_amount_kopeks: string;
  status: PaymentStatus;
}

interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

function checksum(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest();
}

function equalBuffers(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class PaymentService {
  private readonly providerName: "disabled" | "sandbox";

  constructor(
    private readonly audit: AuditService,
    config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
    private readonly rateLimit: RateLimitService,
    private readonly sandbox: SandboxPaymentProvider,
  ) {
    this.providerName = config.getOrThrow<"disabled" | "sandbox">("PAYMENTS_PROVIDER");
  }

  async completeSandbox(externalPaymentId: string, body: unknown, ipAddress?: string) {
    this.assertSandboxEnabled();
    await this.rateLimit.consume(
      "sandbox-payment-complete",
      ipAddress ?? externalPaymentId,
      60,
      10 * 60,
    );
    const token = body && typeof body === "object" && "confirmationToken" in body
      ? body.confirmationToken
      : undefined;
    if (typeof token !== "string" || token.length < 32 || token.length > 256) {
      throw new UnauthorizedException("Недействительный токен подтверждения sandbox-платежа");
    }
    const payment = (await this.database.query<PaymentRow>(
      `SELECT id,order_id,external_payment_id,status,amount_kopeks::text,
              refunded_amount_kopeks::text,provider_metadata,kind
       FROM app.payments WHERE provider='sandbox' AND external_payment_id=$1`,
      [externalPaymentId],
    )).rows[0];
    if (!payment) throw new NotFoundException("Платёж не найден");
    const tokenHash = payment.provider_metadata.sandboxTokenHash;
    if (typeof tokenHash !== "string") throw new UnauthorizedException("Sandbox-токен недоступен");
    let expected: Buffer;
    try {
      expected = Buffer.from(tokenHash, "base64url");
    } catch {
      throw new UnauthorizedException("Sandbox-токен повреждён");
    }
    if (!this.crypto.opaqueHashMatches("sandbox-payment-confirmation", token, expected)) {
      throw new UnauthorizedException("Недействительный токен подтверждения sandbox-платежа");
    }
    const scenario = payment.provider_metadata.sandboxScenario;
    if (scenario === "timeout") {
      return { idempotentReplay: false, paymentId: payment.id, status: payment.status, timedOut: true };
    }
    if (scenario !== "success" && scenario !== "decline" && scenario !== "cancel") {
      throw new ConflictException("Неизвестный sandbox-сценарий");
    }
    const event: SandboxWebhook = {
      amountKopeks: Number(payment.amount_kopeks),
      externalEventId: `sandbox-event:${payment.id}:${scenario}`,
      externalPaymentId,
      status: scenario === "success" ? "succeeded" : scenario === "decline" ? "failed" : "cancelled",
    };
    return this.processWebhook(event, true);
  }

  handleSandboxWebhook(body: unknown, signature: string | undefined) {
    this.assertSandboxEnabled();
    const parsed = SandboxWebhookSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_webhook", issues: parsed.error.issues });
    }
    if (!this.sandbox.verifyWebhook(parsed.data, signature)) {
      throw new UnauthorizedException("Подпись webhook недействительна");
    }
    return this.processWebhook(parsed.data, true);
  }

  async refund(paymentId: string, body: unknown, auth: AuthContext, metadata: RequestMetadata) {
    this.assertSandboxEnabled();
    const parsed = RefundRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_refund", issues: parsed.error.issues });
    }
    const request = parsed.data;
    return this.database.transaction(async (client) => {
      const payment = (await client.query<PaymentRow & { order_status: string; paid_amount_kopeks: string }>(
        `SELECT payment.id,payment.order_id,payment.external_payment_id,payment.status,
                payment.amount_kopeks::text,payment.refunded_amount_kopeks::text,
                payment.provider_metadata,payment.kind,checkout_order.status AS order_status,
                checkout_order.paid_amount_kopeks::text
         FROM app.payments AS payment
         JOIN app.orders AS checkout_order ON checkout_order.id=payment.order_id
         WHERE payment.id=$1 FOR UPDATE OF payment,checkout_order`,
        [paymentId],
      )).rows[0];
      if (!payment) throw new NotFoundException("Платёж не найден");

      const existing = (await client.query<{
        amount_kopeks: string;
        external_refund_id: string | null;
        id: string;
        payment_id: string;
        reason: string;
        status: string;
      }>(
        `SELECT id,payment_id,amount_kopeks::text,reason,status,external_refund_id
         FROM app.refunds WHERE provider='sandbox' AND idempotency_key=$1`,
        [request.idempotencyKey],
      )).rows[0];
      if (existing) {
        if (existing.payment_id !== payment.id
          || Number(existing.amount_kopeks) !== request.amountKopeks
          || existing.reason !== request.reason) {
          throw new ConflictException("Ключ возврата уже использован с другими данными");
        }
        return {
          amountKopeks: Number(existing.amount_kopeks),
          externalRefundId: existing.external_refund_id,
          id: existing.id,
          idempotentReplay: true,
          status: existing.status,
        };
      }
      if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
        throw new ConflictException("Возврат доступен только для успешного платежа");
      }

      const amount = Number(payment.amount_kopeks);
      const alreadyRefunded = Number(payment.refunded_amount_kopeks);
      if (request.amountKopeks > amount - alreadyRefunded) {
        throw new ConflictException("Сумма возврата превышает доступный остаток платежа");
      }
      const providerRefund = await this.sandbox.refund({
        amountKopeks: request.amountKopeks,
        externalPaymentId: payment.external_payment_id,
        idempotencyKey: request.idempotencyKey,
      });
      const refund = (await client.query<{
        external_refund_id: string;
        id: string;
        status: string;
      }>(
        `INSERT INTO app.refunds
          (payment_id,provider,external_refund_id,idempotency_key,status,amount_kopeks,
           reason,requested_by,succeeded_at)
         VALUES ($1,'sandbox',$2,$3,'succeeded',$4,$5,$6,clock_timestamp())
         RETURNING id,status,external_refund_id`,
        [payment.id, providerRefund.externalRefundId, request.idempotencyKey,
          request.amountKopeks, request.reason, auth.userId],
      )).rows[0]!;
      const refundedAmount = alreadyRefunded + request.amountKopeks;
      const paymentStatus = refundedAmount === amount ? "refunded" : "partially_refunded";
      await client.query(
        `UPDATE app.payments SET refunded_amount_kopeks=$2,status=$3 WHERE id=$1`,
        [payment.id, refundedAmount, paymentStatus],
      );
      const paidAmount = Math.max(0, Number(payment.paid_amount_kopeks) - request.amountKopeks);
      const orderStatus = paidAmount === 0 ? "refunded" : payment.order_status;
      await client.query(
        `UPDATE app.orders SET paid_amount_kopeks=$2,status=$3,version=version+1 WHERE id=$1`,
        [payment.order_id, paidAmount, orderStatus],
      );
      if (orderStatus === "refunded" && payment.order_status !== "refunded") {
        await client.query(
          `UPDATE app.payments SET status='cancelled',cancelled_at=clock_timestamp(),
             failure_code='order_refunded',failure_message='Order was fully refunded'
           WHERE order_id=$1 AND id<>$2 AND status IN ('pending','authorized')`,
          [payment.order_id, payment.id],
        );
        await client.query(
          `INSERT INTO app.order_status_history
            (order_id,from_status,to_status,reason,actor_user_id)
           VALUES ($1,$2,'refunded',$3,$4)`,
          [payment.order_id, payment.order_status, request.reason, auth.userId],
        );
      }
      await this.audit.record({
        action: "payment.refunded",
        actorRole: auth.role,
        actorUserId: auth.userId,
        entityId: payment.id,
        entityType: "payment",
        ipAddress: metadata.ipAddress,
        metadata: { amountKopeks: request.amountKopeks, refundId: refund.id },
        userAgent: metadata.userAgent,
      }, client);
      return {
        amountKopeks: request.amountKopeks,
        externalRefundId: refund.external_refund_id,
        id: refund.id,
        idempotentReplay: false,
        paymentStatus,
        status: refund.status,
      };
    });
  }

  private async processWebhook(event: SandboxWebhook, signatureValid: boolean) {
    const payloadChecksum = checksum(event);
    return this.database.transaction(async (client) => {
      await client.query("SELECT app.expire_stock_reservations(100)");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.payment_webhook_events
          (provider,external_event_id,event_type,payload_checksum,signature_valid,payload)
         VALUES ('sandbox',$1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (provider,external_event_id) DO NOTHING RETURNING id::text`,
        [event.externalEventId, event.status, payloadChecksum, signatureValid, JSON.stringify(event)],
      );
      if (inserted.rowCount === 0) {
        const existing = (await client.query<{ payload_checksum: Buffer; payment_id: string | null }>(
          `SELECT payload_checksum,payment_id FROM app.payment_webhook_events
           WHERE provider='sandbox' AND external_event_id=$1`,
          [event.externalEventId],
        )).rows[0];
        if (!existing || !equalBuffers(existing.payload_checksum, payloadChecksum)) {
          throw new ConflictException("Webhook event ID повторно использован с другим payload");
        }
        const status = existing.payment_id
          ? (await client.query<{ status: PaymentStatus }>(
            "SELECT status FROM app.payments WHERE id=$1", [existing.payment_id],
          )).rows[0]?.status
          : undefined;
        return { idempotentReplay: true, status };
      }

      const payment = (await client.query<PaymentRow & {
        order_status: string;
        paid_amount_kopeks: string;
        reservation_id: string;
        reservation_status: string;
      }>(
        `SELECT payment.id,payment.order_id,payment.external_payment_id,payment.status,
                payment.amount_kopeks::text,payment.refunded_amount_kopeks::text,
                payment.provider_metadata,payment.kind,checkout_order.status AS order_status,
                checkout_order.paid_amount_kopeks::text,checkout_order.reservation_id,
                reservation.status AS reservation_status
         FROM app.payments AS payment
         JOIN app.orders AS checkout_order ON checkout_order.id=payment.order_id
         JOIN app.stock_reservations AS reservation ON reservation.id=checkout_order.reservation_id
         WHERE payment.provider='sandbox' AND payment.external_payment_id=$1
         FOR UPDATE OF payment,checkout_order,reservation`,
        [event.externalPaymentId],
      )).rows[0];
      if (!payment) throw new NotFoundException("Платёж webhook не найден");
      if (Number(payment.amount_kopeks) !== event.amountKopeks) {
        throw new ConflictException("Сумма webhook не совпадает с серверным платежом");
      }

      let status = payment.status;
      if (event.status === "succeeded") {
        if (payment.status === "pending" || payment.status === "authorized") {
          if (payment.kind === "goods") {
            if (payment.reservation_status !== "active" || payment.order_status !== "pending_payment") {
              throw new ConflictException("Резерв заказа уже недействителен");
            }
            await this.consumeReservation(client, payment.reservation_id, payment.order_id);
          } else if (payment.order_status === "cancelled" || payment.order_status === "refunded") {
            throw new ConflictException("Заказ уже закрыт");
          }
          await client.query(
            `UPDATE app.payments SET status='succeeded',succeeded_at=clock_timestamp(),failure_code=NULL,
                    failure_message=NULL WHERE id=$1`,
            [payment.id],
          );
          const paidAmount = Number(payment.paid_amount_kopeks) + event.amountKopeks;
          if (payment.kind === "goods") {
            await client.query(
              `UPDATE app.orders SET paid_amount_kopeks=$2,status='paid',version=version+1 WHERE id=$1`,
              [payment.order_id, paidAmount],
            );
            await client.query(
              `INSERT INTO app.order_status_history (order_id,from_status,to_status,reason)
               VALUES ($1,'pending_payment','paid','payment_succeeded')`,
              [payment.order_id],
            );
          } else {
            await client.query(
              `UPDATE app.orders SET paid_amount_kopeks=$2,version=version+1 WHERE id=$1`,
              [payment.order_id, paidAmount],
            );
          }
          status = "succeeded";
        }
      } else if (payment.status === "pending" || payment.status === "authorized") {
        status = event.status;
        await client.query(
          `UPDATE app.payments SET status=$2::app.payment_status,
             cancelled_at=CASE WHEN $2::app.payment_status='cancelled' THEN clock_timestamp()
             ELSE cancelled_at END,failure_code=$3,failure_message=$4 WHERE id=$1`,
          [payment.id, status, event.status === "failed" ? "sandbox_declined" : "sandbox_cancelled",
            event.status === "failed" ? "Sandbox payment declined" : "Sandbox payment cancelled"],
        );
        if (payment.kind === "goods") {
          await this.releaseReservation(
            client,
            payment.reservation_id,
            payment.order_id,
            event.status === "failed" ? "payment_failed" : "payment_cancelled",
          );
        }
      }

      await client.query(
        `UPDATE app.payment_webhook_events
         SET payment_id=$2,processed_at=clock_timestamp() WHERE provider='sandbox' AND external_event_id=$1`,
        [event.externalEventId, payment.id],
      );
      return { idempotentReplay: false, paymentId: payment.id, status };
    });
  }

  private async consumeReservation(client: PoolClient, reservationId: string, orderId: string) {
    const items = (await client.query<{
      product_id: string;
      quantity: number;
      warehouse_id: string;
    }>(
      `SELECT product_id,warehouse_id,quantity FROM app.stock_reservation_items
       WHERE reservation_id=$1 ORDER BY product_id,warehouse_id`,
      [reservationId],
    )).rows;
    for (const item of items) {
      const balance = (await client.query<{
        quantity_on_hand: number;
        quantity_reserved: number;
      }>(
        `UPDATE app.inventory_balances
         SET quantity_on_hand=quantity_on_hand-$3,quantity_reserved=quantity_reserved-$3
         WHERE product_id=$1 AND warehouse_id=$2
           AND quantity_on_hand >= $3 AND quantity_reserved >= $3
         RETURNING quantity_on_hand,quantity_reserved`,
        [item.product_id, item.warehouse_id, item.quantity],
      )).rows[0];
      if (!balance) throw new ConflictException("Резерв товара повреждён или уже использован");
      await client.query(
        `INSERT INTO app.inventory_events
          (product_id,warehouse_id,event_type,delta_on_hand,delta_reserved,resulting_on_hand,
           resulting_reserved,reference_type,reference_id)
         VALUES ($1,$2,'order_consumed',$3,$3,$4,$5,'order',$6)`,
        [item.product_id, item.warehouse_id, -item.quantity, balance.quantity_on_hand,
          balance.quantity_reserved, orderId],
      );
    }
    await client.query(
      `UPDATE app.stock_reservations SET status='consumed',consumed_at=clock_timestamp()
       WHERE id=$1 AND status='active'`,
      [reservationId],
    );
  }

  private async releaseReservation(
    client: PoolClient,
    reservationId: string,
    orderId: string,
    reason: string,
  ) {
    const reservation = (await client.query<{ status: string }>(
      "SELECT status FROM app.stock_reservations WHERE id=$1 FOR UPDATE", [reservationId],
    )).rows[0];
    if (!reservation || reservation.status !== "active") return;
    const items = (await client.query<{
      product_id: string;
      quantity: number;
      warehouse_id: string;
    }>(
      `SELECT product_id,warehouse_id,quantity FROM app.stock_reservation_items
       WHERE reservation_id=$1 ORDER BY product_id,warehouse_id`,
      [reservationId],
    )).rows;
    for (const item of items) {
      const balance = (await client.query<{
        quantity_on_hand: number;
        quantity_reserved: number;
      }>(
        `UPDATE app.inventory_balances SET quantity_reserved=quantity_reserved-$3
         WHERE product_id=$1 AND warehouse_id=$2 AND quantity_reserved >= $3
         RETURNING quantity_on_hand,quantity_reserved`,
        [item.product_id, item.warehouse_id, item.quantity],
      )).rows[0];
      if (!balance) throw new ConflictException("Невозможно безопасно освободить резерв");
      await client.query(
        `INSERT INTO app.inventory_events
          (product_id,warehouse_id,event_type,delta_reserved,resulting_on_hand,resulting_reserved,
           reference_type,reference_id)
         VALUES ($1,$2,'reservation_released',$3,$4,$5,$6,$7)`,
        [item.product_id, item.warehouse_id, -item.quantity, balance.quantity_on_hand,
          balance.quantity_reserved, reason, reservationId],
      );
    }
    await client.query(
      `UPDATE app.stock_reservations SET status='released',released_at=clock_timestamp()
       WHERE id=$1`,
      [reservationId],
    );
    const order = (await client.query<{ status: string }>(
      `UPDATE app.orders SET status='cancelled',cancelled_at=clock_timestamp(),version=version+1
       WHERE id=$1 AND status='pending_payment' RETURNING status`,
      [orderId],
    )).rows[0];
    if (order) {
      await client.query(
        `INSERT INTO app.order_status_history (order_id,from_status,to_status,reason)
         VALUES ($1,'pending_payment','cancelled',$2)`,
        [orderId, reason],
      );
    }
  }

  private assertSandboxEnabled() {
    if (this.providerName !== "sandbox") {
      throw new ServiceUnavailableException("Sandbox-платежи отключены");
    }
  }
}
