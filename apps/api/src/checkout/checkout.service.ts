import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";

import {
  CHECKOUT_PERSONAL_DATA_CONSENT_DOCUMENT_PATH,
  CHECKOUT_PERSONAL_DATA_CONSENT_TEXT,
  CheckoutRequestSchema,
  type CheckoutRequest,
} from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { normalizeConsentUserAgent } from "../security/consent-evidence.js";
import { CryptoService } from "../security/crypto.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";
import { SandboxPaymentProvider } from "./sandbox-payment.provider.js";

interface CheckoutOwner {
  userId?: string;
}

interface ReservedLine {
  allocations: Array<{ quantity: number; warehouseId: string }>;
  amountKopeks: number;
  name: string;
  productId: string;
  quantity: number;
  sku: string;
}

interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

function requestChecksum(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest();
}

function sameBuffer(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicOrderNumber(id: string): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AN-${date}-${id.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

@Injectable()
export class CheckoutService {
  private readonly enabled: boolean;
  private readonly providerName: "disabled" | "sandbox";
  private readonly reservationTtlMinutes: number;

  constructor(
    private readonly audit: AuditService,
    config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
    private readonly rateLimit: RateLimitService,
    private readonly sandbox: SandboxPaymentProvider,
  ) {
    this.enabled = config.getOrThrow<boolean>("ENABLE_PUBLIC_CHECKOUT");
    this.providerName = config.getOrThrow<"disabled" | "sandbox">("PAYMENTS_PROVIDER");
    this.reservationTtlMinutes = config.getOrThrow<number>("RESERVATION_TTL_MINUTES");
  }

  createForCustomer(body: unknown, auth: AuthContext, metadata: RequestMetadata) {
    if (auth.role !== "customer") {
      throw new BadRequestException("Checkout клиента недоступен для учётной записи персонала");
    }
    return this.create(body, { userId: auth.userId }, metadata, auth);
  }

  createForGuest(body: unknown, metadata: RequestMetadata) {
    return this.create(body, {}, metadata);
  }

  private async create(
    body: unknown,
    owner: CheckoutOwner,
    metadata: RequestMetadata,
    auth?: AuthContext,
  ) {
    if (!this.enabled || this.providerName === "disabled") {
      throw new ServiceUnavailableException("Публичный checkout временно закрыт");
    }
    await this.rateLimit.consume(
      "checkout",
      owner.userId ?? metadata.ipAddress ?? "unknown",
      owner.userId ? 30 : 20,
      15 * 60,
    );
    const parsed = CheckoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_checkout", issues: parsed.error.issues });
    }
    if (this.providerName !== "sandbox") {
      throw new ServiceUnavailableException("Платёжный провайдер не настроен");
    }

    const request = parsed.data;
    const scope = owner.userId ? `checkout:user:${owner.userId}` : "checkout:guest";
    const checksum = requestChecksum(request);
    // A lost response must not lock a guest out of an idempotently-created
    // order. Only the purpose-separated HMAC of this reproducible token is stored.
    const guestAccessToken = owner.userId ? undefined : this.crypto.deriveOpaqueToken(
      "guest-order-access",
      `${scope}\0${request.idempotencyKey}`,
    );
    const guestTokenHash = guestAccessToken
      ? this.crypto.opaqueHash("guest-order-access", guestAccessToken)
      : undefined;

    return this.database.transaction(async (client) => {
      await client.query("SELECT app.expire_stock_reservations(100)");
      await client.query(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended('an30-catalog-apply-v1', 0))",
      );

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.idempotency_keys (scope,key,request_hash,locked_until,expires_at)
         VALUES ($1,$2,$3,clock_timestamp() + interval '30 seconds',clock_timestamp() + interval '24 hours')
         ON CONFLICT (scope,key) DO NOTHING RETURNING id`,
        [scope, request.idempotencyKey, checksum],
      );
      const idempotency = (await client.query<{
        completed_at: Date | null;
        request_hash: Buffer;
        resource_id: string | null;
      }>(
        `SELECT request_hash,resource_id,completed_at FROM app.idempotency_keys
         WHERE scope=$1 AND key=$2 FOR UPDATE`,
        [scope, request.idempotencyKey],
      )).rows[0];
      if (!idempotency) throw new ConflictException("Не удалось зафиксировать ключ идемпотентности");
      if (!sameBuffer(checksum, idempotency.request_hash)) {
        throw new ConflictException("Ключ идемпотентности уже использован с другими данными");
      }
      if (inserted.rowCount === 0 && idempotency.completed_at && idempotency.resource_id) {
        return this.readCheckout(
          client,
          idempotency.resource_id,
          true,
          this.sandbox.confirmationToken(`payment:${scope}:${request.idempotencyKey}`),
          guestAccessToken,
        );
      }

      const lines = await this.reserveLines(client, request);
      const subtotalKopeks = lines.reduce(
        (total, line) => total + line.amountKopeks * line.quantity,
        0,
      );
      if (!Number.isSafeInteger(subtotalKopeks) || subtotalKopeks <= 0) {
        throw new ConflictException("Сумма заказа должна быть положительной и безопасной");
      }

      const reservationId = randomUUID();
      const orderId = randomUUID();
      const paymentId = randomUUID();
      const scopedKey = `${scope}:${request.idempotencyKey}`;
      const scenario = request.sandboxScenario ?? "success";
      const prepared = this.sandbox.preparePayment({
        amountKopeks: subtotalKopeks,
        currency: "RUB",
        idempotencyKey: `payment:${scopedKey}`,
        orderId,
        scenario,
      });

      const reservation = (await client.query<{ expires_at: Date }>(
        `INSERT INTO app.stock_reservations
          (id,user_id,guest_token_hash,idempotency_key,status,expires_at)
         VALUES ($1,$2,$3,$4,'active',clock_timestamp() + $5::integer * interval '1 minute')
         RETURNING expires_at`,
        [reservationId, owner.userId ?? null, guestTokenHash ?? null, `reservation:${scopedKey}`,
          this.reservationTtlMinutes],
      )).rows[0];
      if (!reservation) throw new ConflictException("Не удалось создать резерв");

      for (const line of lines) {
        for (const allocation of line.allocations) {
          await client.query(
            `INSERT INTO app.stock_reservation_items
              (reservation_id,product_id,warehouse_id,quantity,unit_price_kopeks,currency)
             VALUES ($1,$2,$3,$4,$5,'RUB')`,
            [reservationId, line.productId, allocation.warehouseId, allocation.quantity,
              line.amountKopeks],
          );
          const balance = (await client.query<{
            quantity_on_hand: number;
            quantity_reserved: number;
          }>(
            `UPDATE app.inventory_balances
             SET quantity_reserved=quantity_reserved+$3
             WHERE product_id=$1 AND warehouse_id=$2
               AND quantity_on_hand-quantity_reserved >= $3
             RETURNING quantity_on_hand,quantity_reserved`,
            [line.productId, allocation.warehouseId, allocation.quantity],
          )).rows[0];
          if (!balance) throw new ConflictException(`Недостаточно остатка товара ${line.productId}`);
          await client.query(
            `INSERT INTO app.inventory_events
              (product_id,warehouse_id,event_type,delta_reserved,resulting_on_hand,
               resulting_reserved,reference_type,reference_id,actor_user_id)
             VALUES ($1,$2,'reservation_created',$3,$4,$5,'stock_reservation',$6,$7)`,
            [line.productId, allocation.warehouseId, allocation.quantity, balance.quantity_on_hand,
              balance.quantity_reserved, reservationId, owner.userId ?? null],
          );
        }
      }

      await client.query(
        `INSERT INTO app.orders
          (id,public_number,user_id,reservation_id,idempotency_key,status,customer_email,
           customer_phone,customer_name,contact_snapshot,delivery_snapshot,currency,
           subtotal_kopeks,total_amount_kopeks,customer_note,terms_accepted_at,legal_policy_version,
           personal_data_consent_at,personal_data_consent_policy_version,
           personal_data_consent_document_path,personal_data_consent_text,
           personal_data_consent_ip_address,personal_data_consent_user_agent)
         VALUES ($1,$2,$3,$4,$5,'pending_payment',$6,$7,$8,$9::jsonb,$10::jsonb,
           'RUB',$11,$11,$12,clock_timestamp(),$13,clock_timestamp(),$14,$15,$16,$17,$18)`,
        [orderId, publicOrderNumber(orderId), owner.userId ?? null, reservationId,
          `order:${scopedKey}`, request.contact.email, request.contact.phone, request.contact.name,
          JSON.stringify(request.contact), JSON.stringify(request.delivery), subtotalKopeks,
          request.customerNote, request.legalPolicyVersion, request.personalDataConsentVersion,
          CHECKOUT_PERSONAL_DATA_CONSENT_DOCUMENT_PATH, CHECKOUT_PERSONAL_DATA_CONSENT_TEXT,
          metadata.ipAddress || null, normalizeConsentUserAgent(metadata.userAgent)],
      );
      for (const line of lines) {
        await client.query(
          `INSERT INTO app.order_items
            (order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_kopeks,currency)
           VALUES ($1,$2,$3,$4,$5,$6,'RUB')`,
          [orderId, line.productId, line.sku, line.name, line.quantity, line.amountKopeks],
        );
      }
      await client.query(
        `INSERT INTO app.order_status_history (order_id,to_status,reason,actor_user_id)
         VALUES ($1,'pending_payment','checkout_created',$2)`,
        [orderId, owner.userId ?? null],
      );
      await client.query(
        `INSERT INTO app.payments
          (id,order_id,kind,provider,external_payment_id,idempotency_key,status,
           amount_kopeks,currency,provider_metadata)
         VALUES ($1,$2,'goods',$3,$4,$5,'pending',$6,'RUB',$7::jsonb)`,
        [paymentId, orderId, this.sandbox.name, prepared.externalPaymentId,
          `payment:${scopedKey}`, subtotalKopeks, JSON.stringify(prepared.metadata)],
      );
      await client.query(
        `UPDATE app.idempotency_keys
         SET response_status=201,response_body=$3::jsonb,resource_type='order',resource_id=$4,
             completed_at=clock_timestamp(),locked_until=NULL
         WHERE scope=$1 AND key=$2`,
        [scope, request.idempotencyKey, JSON.stringify({ orderId, paymentId, reservationId }), orderId],
      );
      await this.audit.record({
        action: "checkout.created",
        actorRole: auth?.role,
        actorUserId: owner.userId,
        entityId: orderId,
        entityType: "order",
        ipAddress: metadata.ipAddress,
        metadata: { itemCount: lines.length, provider: this.sandbox.name },
        userAgent: metadata.userAgent,
      }, client);

      return {
        guestAccessToken: guestAccessToken ?? null,
        idempotentReplay: false,
        order: {
          id: orderId,
          publicNumber: publicOrderNumber(orderId),
          status: "pending_payment",
          subtotalKopeks,
          totalAmountKopeks: subtotalKopeks,
        },
        payment: {
          amountKopeks: subtotalKopeks,
          confirmationToken: prepared.confirmationToken,
          confirmationUrl: prepared.confirmationUrl,
          externalPaymentId: prepared.externalPaymentId,
          id: paymentId,
          provider: this.sandbox.name,
          status: "pending",
        },
        reservation: { expiresAt: reservation.expires_at.toISOString(), id: reservationId },
      };
    });
  }

  private async reserveLines(client: PoolClient, request: CheckoutRequest): Promise<ReservedLine[]> {
    const lines: ReservedLine[] = [];
    for (const item of [...request.items].sort((left, right) => (
      left.productId < right.productId ? -1 : left.productId > right.productId ? 1 : 0
    ))) {
      const product = (await client.query<{
        amount_kopeks: string;
        name: string;
        sku: string;
      }>(
        `${VISIBLE_CATEGORIES_CTE}
         SELECT price.amount_kopeks::text,product.name,product.sku::text
         FROM app.products AS product
         JOIN app.product_prices AS price ON price.product_id=product.id AND price.valid_to IS NULL
           AND price.currency='RUB'
         LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
         LEFT JOIN app.categories AS category ON category.id=product.category_id
         WHERE product.id=$1 AND product.is_active AND product.deleted_at IS NULL
           AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
           AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         FOR SHARE OF product,price`,
        [item.productId],
      )).rows[0];
      if (!product) throw new ConflictException(`Товар ${item.productId} недоступен или не имеет цены`);
      const amountKopeks = Number(product.amount_kopeks);
      if (!Number.isSafeInteger(amountKopeks) || amountKopeks < 0) {
        throw new ConflictException(`Цена товара ${item.productId} повреждена`);
      }
      const inventory = (await client.query<{ available_quantity: number; warehouse_id: string }>(
        `SELECT balance.warehouse_id,
                balance.quantity_on_hand-balance.quantity_reserved AS available_quantity
         FROM app.inventory_balances AS balance
         JOIN app.warehouses AS warehouse ON warehouse.id=balance.warehouse_id
         WHERE balance.product_id=$1
           AND balance.quantity_on_hand-balance.quantity_reserved > 0
           AND warehouse.is_active AND warehouse.deleted_at IS NULL
         ORDER BY balance.quantity_on_hand-balance.quantity_reserved DESC,balance.warehouse_id
         FOR UPDATE OF balance
        `,
        [item.productId],
      )).rows;
      let remaining = item.quantity;
      const allocations: ReservedLine["allocations"] = [];
      for (const row of inventory) {
        if (remaining === 0) break;
        const quantity = Math.min(remaining, row.available_quantity);
        if (quantity > 0) allocations.push({ quantity, warehouseId: row.warehouse_id });
        remaining -= quantity;
      }
      if (remaining > 0) throw new ConflictException(`Недостаточно остатка товара ${item.productId}`);
      lines.push({
        allocations,
        amountKopeks,
        name: product.name,
        productId: item.productId,
        quantity: item.quantity,
        sku: product.sku,
      });
    }
    return lines;
  }

  private async readCheckout(
    client: PoolClient,
    orderId: string,
    idempotentReplay: boolean,
    confirmationToken?: string,
    guestAccessToken?: string,
  ) {
    const row = (await client.query<{
      amount_kopeks: string;
      expires_at: Date;
      external_payment_id: string;
      order_id: string;
      payment_id: string;
      payment_status: string;
      provider: string;
      public_number: string;
      reservation_id: string;
      status: string;
      subtotal_kopeks: string;
      total_amount_kopeks: string;
    }>(
      `SELECT checkout_order.id AS order_id,checkout_order.public_number,
              checkout_order.status,checkout_order.subtotal_kopeks::text,
              checkout_order.total_amount_kopeks::text,reservation.id AS reservation_id,
              reservation.expires_at,payment.id AS payment_id,payment.provider,
              payment.external_payment_id,payment.status AS payment_status,
              payment.amount_kopeks::text
       FROM app.orders AS checkout_order
       JOIN app.stock_reservations AS reservation ON reservation.id=checkout_order.reservation_id
       JOIN app.payments AS payment ON payment.order_id=checkout_order.id AND payment.kind='goods'
       WHERE checkout_order.id=$1`,
      [orderId],
    )).rows[0];
    if (!row) throw new ConflictException("Идемпотентный заказ не найден");
    return {
      guestAccessToken: guestAccessToken ?? null,
      idempotentReplay,
      order: {
        id: row.order_id,
        publicNumber: row.public_number,
        status: row.status,
        subtotalKopeks: Number(row.subtotal_kopeks),
        totalAmountKopeks: Number(row.total_amount_kopeks),
      },
      payment: {
        amountKopeks: Number(row.amount_kopeks),
        confirmationToken: confirmationToken ?? null,
        confirmationUrl: `/api/v1/payments/sandbox/${row.external_payment_id}/complete`,
        externalPaymentId: row.external_payment_id,
        id: row.payment_id,
        provider: row.provider,
        status: row.payment_status,
      },
      reservation: { expiresAt: row.expires_at.toISOString(), id: row.reservation_id },
    };
  }
}
