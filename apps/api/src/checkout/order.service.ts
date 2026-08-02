import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  DeliveryPaymentRequestSchema,
  OrderStatusUpdateSchema,
  type OrderStatus,
  type PaymentStatus,
} from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { CryptoService } from "../security/crypto.service.js";
import { SandboxPaymentProvider } from "./sandbox-payment.provider.js";

const STAFF_ROLES = new Set(["manager", "director", "admin"]);
const STAFF_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  awaiting_delivery_terms: ["processing", "ready", "cancelled"],
  cancelled: [],
  completed: [],
  paid: ["processing", "awaiting_delivery_terms", "ready"],
  pending_payment: ["cancelled"],
  processing: ["awaiting_delivery_terms", "ready", "cancelled"],
  ready: ["completed", "cancelled"],
  refunded: [],
};

interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

const OrderIdSchema = z.uuid();
const OrderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const GuestOrderTokenSchema = z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/u);

@Injectable()
export class OrderService {
  private readonly providerName: "disabled" | "sandbox";

  constructor(
    private readonly audit: AuditService,
    config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
    private readonly sandbox: SandboxPaymentProvider,
  ) {
    this.providerName = config.getOrThrow<"disabled" | "sandbox">("PAYMENTS_PROVIDER");
  }

  async list(auth: AuthContext, rawQuery: unknown) {
    const parsed = OrderListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_order_query", issues: parsed.error.issues });
    }
    const { limit } = parsed.data;
    const staff = STAFF_ROLES.has(auth.role);
    const result = await this.database.query<{
      created_at: Date;
      customer_name: string;
      id: string;
      paid_amount_kopeks: string;
      public_number: string;
      status: OrderStatus;
      total_amount_kopeks: string;
      version: number;
    }>(
      `SELECT id,public_number,status,customer_name,total_amount_kopeks::text,
              paid_amount_kopeks::text,version,created_at
       FROM app.orders
       WHERE ($1::boolean OR user_id=$2)
       ORDER BY created_at DESC LIMIT $3`,
      [staff, auth.userId, limit],
    );
    return result.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      customerName: row.customer_name,
      id: row.id,
      paidAmountKopeks: Number(row.paid_amount_kopeks),
      publicNumber: row.public_number,
      status: row.status,
      totalAmountKopeks: Number(row.total_amount_kopeks),
      version: row.version,
    }));
  }

  async readForUser(orderId: string, auth: AuthContext) {
    const parsedOrderId = OrderIdSchema.safeParse(orderId);
    if (!parsedOrderId.success) throw new NotFoundException("Заказ не найден");
    const order = await this.readOrder(parsedOrderId.data);
    if (!STAFF_ROLES.has(auth.role) && order.userId !== auth.userId) {
      throw new NotFoundException("Заказ не найден");
    }
    return order.response;
  }

  async readForGuest(orderId: string, token: string | undefined) {
    const parsedOrderId = OrderIdSchema.safeParse(orderId);
    const parsedToken = GuestOrderTokenSchema.safeParse(token);
    if (!parsedOrderId.success || !parsedToken.success) {
      throw new ForbiddenException("Недействительный гостевой токен заказа");
    }
    const actual = this.crypto.opaqueHash("guest-order-access", parsedToken.data);
    const owned = await this.database.query(
      `SELECT 1 FROM app.orders AS checkout_order
       JOIN app.stock_reservations AS reservation ON reservation.id=checkout_order.reservation_id
       WHERE checkout_order.id=$1 AND checkout_order.user_id IS NULL
         AND reservation.guest_token_hash=$2 LIMIT 1`,
      [parsedOrderId.data, actual],
    );
    if (!owned.rowCount) {
      throw new NotFoundException("Заказ не найден");
    }
    const order = await this.readOrder(parsedOrderId.data);
    return order.response;
  }

  async updateStatus(orderId: string, body: unknown, auth: AuthContext, metadata: RequestMetadata) {
    const parsed = OrderStatusUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_order_status", issues: parsed.error.issues });
    }
    const request = parsed.data;
    return this.database.transaction(async (client) => {
      const order = (await client.query<{
        reservation_id: string;
        status: OrderStatus;
        version: number;
      }>(
        "SELECT status,version,reservation_id FROM app.orders WHERE id=$1 FOR UPDATE", [orderId],
      )).rows[0];
      if (!order) throw new NotFoundException("Заказ не найден");
      if (order.version !== request.version) {
        throw new ConflictException({ error: "order_version_conflict", currentVersion: order.version });
      }
      if (!STAFF_TRANSITIONS[order.status].includes(request.status)) {
        throw new ConflictException(`Переход ${order.status} → ${request.status} запрещён`);
      }
      if (request.status === "cancelled" && order.status !== "pending_payment") {
        const unrefunded = (await client.query<{ amount: string }>(
          `SELECT COALESCE(sum(amount_kopeks-refunded_amount_kopeks),0)::text AS amount
           FROM app.payments WHERE order_id=$1 AND status IN ('succeeded','partially_refunded')`,
          [orderId],
        )).rows[0];
        if (Number(unrefunded?.amount ?? 0) > 0) {
          throw new ConflictException("Сначала выполните возврат успешных платежей");
        }
      }
      if (request.status === "cancelled" && order.status === "pending_payment") {
        await this.cancelPendingReservation(client, order.reservation_id, orderId, auth.userId);
      }
      const updated = (await client.query<{ status: OrderStatus; version: number }>(
        `UPDATE app.orders SET status=$2::app.order_status,version=version+1,
           completed_at=CASE WHEN $2::app.order_status='completed' THEN clock_timestamp()
             ELSE completed_at END,
           cancelled_at=CASE WHEN $2::app.order_status='cancelled' THEN clock_timestamp()
             ELSE cancelled_at END
         WHERE id=$1 RETURNING status,version`,
        [orderId, request.status],
      )).rows[0]!;
      await client.query(
        `INSERT INTO app.order_status_history
          (order_id,from_status,to_status,reason,actor_user_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, order.status, request.status, request.reason, auth.userId],
      );
      await this.audit.record({
        action: "order.status_changed",
        actorRole: auth.role,
        actorUserId: auth.userId,
        afterState: updated,
        beforeState: order,
        entityId: orderId,
        entityType: "order",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return updated;
    });
  }

  async createDeliveryPayment(
    orderId: string,
    body: unknown,
    auth: AuthContext,
    metadata: RequestMetadata,
  ) {
    if (this.providerName !== "sandbox") {
      throw new ServiceUnavailableException("Платёжный провайдер доставки не настроен");
    }
    const parsed = DeliveryPaymentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_delivery_payment", issues: parsed.error.issues });
    }
    const request = parsed.data;
    return this.database.transaction(async (client) => {
      const order = (await client.query<{
        currency: string;
        status: OrderStatus;
        total_amount_kopeks: string;
      }>(
        "SELECT status,currency,total_amount_kopeks::text FROM app.orders WHERE id=$1 FOR UPDATE",
        [orderId],
      )).rows[0];
      if (!order) throw new NotFoundException("Заказ не найден");
      if (["pending_payment", "cancelled", "refunded", "completed"].includes(order.status)) {
        throw new ConflictException("Для текущего состояния заказа нельзя создать платёж доставки");
      }
      const currentTotal = Number(order.total_amount_kopeks);
      if (!Number.isSafeInteger(currentTotal) || currentTotal < 0
        || request.amountKopeks > Number.MAX_SAFE_INTEGER - currentTotal) {
        throw new ConflictException("Сумма заказа превышает допустимый предел");
      }
      const existing = (await client.query<{
        amount_kopeks: string;
        external_payment_id: string;
        id: string;
        order_id: string;
        sandbox_scenario: string | null;
        status: PaymentStatus;
      }>(
        `SELECT id,order_id,status,external_payment_id,amount_kopeks::text,
                provider_metadata->>'sandboxScenario' AS sandbox_scenario
         FROM app.payments
         WHERE provider='sandbox' AND idempotency_key=$1`,
        [request.idempotencyKey],
      )).rows[0];
      if (existing) {
        if (existing.order_id !== orderId
          || Number(existing.amount_kopeks) !== request.amountKopeks
          || existing.sandbox_scenario !== request.sandboxScenario) {
          throw new ConflictException("Ключ платежа доставки уже использован с другими данными");
        }
        return {
          externalPaymentId: existing.external_payment_id,
          id: existing.id,
          idempotentReplay: true,
          status: existing.status,
        };
      }

      const paymentId = randomUUID();
      const prepared = this.sandbox.preparePayment({
        amountKopeks: request.amountKopeks,
        currency: "RUB",
        idempotencyKey: request.idempotencyKey,
        orderId,
        scenario: request.sandboxScenario,
      });
      const updated = await client.query(
        `UPDATE app.orders
         SET delivery_amount_kopeks=delivery_amount_kopeks+$2,
             total_amount_kopeks=total_amount_kopeks+$2,version=version+1
         WHERE id=$1
           AND delivery_amount_kopeks<=$3::bigint-$2
           AND total_amount_kopeks<=$3::bigint-$2
         RETURNING id`,
        [orderId, request.amountKopeks, Number.MAX_SAFE_INTEGER],
      );
      if (!updated.rowCount) throw new ConflictException("Сумма заказа превышает допустимый предел");
      await client.query(
        `INSERT INTO app.payments
          (id,order_id,kind,provider,external_payment_id,idempotency_key,status,
           amount_kopeks,currency,provider_metadata)
         VALUES ($1,$2,'delivery','sandbox',$3,$4,'pending',$5,'RUB',$6::jsonb)`,
        [paymentId, orderId, prepared.externalPaymentId, request.idempotencyKey,
          request.amountKopeks, JSON.stringify(prepared.metadata)],
      );
      await this.audit.record({
        action: "payment.delivery_created",
        actorRole: auth.role,
        actorUserId: auth.userId,
        entityId: paymentId,
        entityType: "payment",
        ipAddress: metadata.ipAddress,
        metadata: { amountKopeks: request.amountKopeks, orderId },
        userAgent: metadata.userAgent,
      }, client);
      return {
        amountKopeks: request.amountKopeks,
        confirmationToken: prepared.confirmationToken,
        confirmationUrl: prepared.confirmationUrl,
        externalPaymentId: prepared.externalPaymentId,
        id: paymentId,
        idempotentReplay: false,
        status: "pending",
      };
    });
  }

  private async readOrder(orderId: string) {
    const order = (await this.database.query<{
      contact_snapshot: unknown;
      created_at: Date;
      customer_note: string | null;
      delivery_snapshot: unknown;
      guest_token_hash: Buffer | null;
      id: string;
      paid_amount_kopeks: string;
      public_number: string;
      status: OrderStatus;
      subtotal_kopeks: string;
      total_amount_kopeks: string;
      user_id: string | null;
      version: number;
    }>(
      `SELECT checkout_order.id,checkout_order.public_number,checkout_order.user_id,
              checkout_order.status,checkout_order.contact_snapshot,
              checkout_order.delivery_snapshot,checkout_order.customer_note,
              checkout_order.subtotal_kopeks::text,checkout_order.total_amount_kopeks::text,
              checkout_order.paid_amount_kopeks::text,checkout_order.version,
              checkout_order.created_at,reservation.guest_token_hash
       FROM app.orders AS checkout_order
       JOIN app.stock_reservations AS reservation ON reservation.id=checkout_order.reservation_id
       WHERE checkout_order.id=$1`,
      [orderId],
    )).rows[0];
    if (!order) throw new NotFoundException("Заказ не найден");
    const [items, payments] = await Promise.all([
      this.database.query<{
        id: string;
        line_total_kopeks: string;
        name_snapshot: string;
        quantity: number;
        sku_snapshot: string;
        unit_price_kopeks: string;
      }>(
        `SELECT id,sku_snapshot,name_snapshot,quantity,unit_price_kopeks::text,
                line_total_kopeks::text FROM app.order_items WHERE order_id=$1 ORDER BY created_at,id`,
        [orderId],
      ),
      this.database.query<{
        amount_kopeks: string;
        id: string;
        kind: string;
        provider: string;
        refunded_amount_kopeks: string;
        status: PaymentStatus;
      }>(
        `SELECT id,kind,provider,status,amount_kopeks::text,refunded_amount_kopeks::text
         FROM app.payments WHERE order_id=$1 ORDER BY created_at,id`,
        [orderId],
      ),
    ]);
    return {
      guestTokenHash: order.guest_token_hash,
      response: {
        contact: order.contact_snapshot,
        createdAt: order.created_at.toISOString(),
        customerNote: order.customer_note,
        delivery: order.delivery_snapshot,
        id: order.id,
        items: items.rows.map((item) => ({
          id: item.id,
          lineTotalKopeks: Number(item.line_total_kopeks),
          name: item.name_snapshot,
          quantity: item.quantity,
          sku: item.sku_snapshot,
          unitPriceKopeks: Number(item.unit_price_kopeks),
        })),
        paidAmountKopeks: Number(order.paid_amount_kopeks),
        payments: payments.rows.map((payment) => ({
          amountKopeks: Number(payment.amount_kopeks),
          id: payment.id,
          kind: payment.kind,
          provider: payment.provider,
          refundedAmountKopeks: Number(payment.refunded_amount_kopeks),
          status: payment.status,
        })),
        publicNumber: order.public_number,
        status: order.status,
        subtotalKopeks: Number(order.subtotal_kopeks),
        totalAmountKopeks: Number(order.total_amount_kopeks),
        version: order.version,
      },
      userId: order.user_id,
    };
  }

  private async cancelPendingReservation(
    client: PoolClient,
    reservationId: string,
    orderId: string,
    actorUserId: string,
  ) {
    const reservation = (await client.query<{ status: string }>(
      "SELECT status FROM app.stock_reservations WHERE id=$1 FOR UPDATE", [reservationId],
    )).rows[0];
    if (!reservation || reservation.status !== "active") {
      throw new ConflictException("Активный резерв заказа уже недоступен");
    }
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
      if (!balance) throw new ConflictException("Невозможно безопасно отменить резерв");
      await client.query(
        `INSERT INTO app.inventory_events
          (product_id,warehouse_id,event_type,delta_reserved,resulting_on_hand,resulting_reserved,
           reference_type,reference_id,actor_user_id)
         VALUES ($1,$2,'reservation_released',$3,$4,$5,'order_cancelled',$6,$7)`,
        [item.product_id, item.warehouse_id, -item.quantity, balance.quantity_on_hand,
          balance.quantity_reserved, reservationId, actorUserId],
      );
    }
    await client.query(
      `UPDATE app.stock_reservations SET status='cancelled',released_at=clock_timestamp() WHERE id=$1`,
      [reservationId],
    );
    await client.query(
      `UPDATE app.payments SET status='cancelled',cancelled_at=clock_timestamp(),
         failure_code='order_cancelled',failure_message='Order cancelled before payment'
       WHERE order_id=$1 AND status IN ('pending','authorized')`,
      [orderId],
    );
  }
}
