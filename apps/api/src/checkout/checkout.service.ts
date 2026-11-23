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
  publicProductName,
} from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { normalizeConsentUserAgent } from "../security/consent-evidence.js";
import { CryptoService } from "../security/crypto.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";

interface CheckoutOwner {
  userId?: string;
}

interface ReservedLine {
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

/**
 * Checkout creates a заявка (manager request), not a payment. The owner's
 * direction has been explicit and repeated: "Пока без оплаты! просто
 * создания заявок для менеджеров!" -- no payment gateway, and no reservation
 * held by a silently-expiring timer either. Price and stock are still
 * re-read and confirmed server-side at submission (see reserveLines), but
 * nothing is charged and nothing is held pending a timer; a manager calls
 * the customer back to confirm the order.
 */
@Injectable()
export class CheckoutService {
  private readonly enabled: boolean;

  constructor(
    private readonly audit: AuditService,
    config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
    private readonly rateLimit: RateLimitService,
  ) {
    this.enabled = config.getOrThrow<boolean>("ENABLE_PUBLIC_CHECKOUT");
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
    if (!this.enabled) {
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
        return this.readCheckout(client, idempotency.resource_id, true, guestAccessToken);
      }

      const lines = await this.reserveLines(client, request);
      const subtotalKopeks = lines.reduce(
        (total, line) => total + line.amountKopeks * line.quantity,
        0,
      );
      if (!Number.isSafeInteger(subtotalKopeks) || subtotalKopeks <= 0) {
        throw new ConflictException("Сумма заказа должна быть положительной и безопасной");
      }

      const orderId = randomUUID();
      const scopedKey = `${scope}:${request.idempotencyKey}`;

      await client.query(
        `INSERT INTO app.orders
          (id,public_number,user_id,guest_token_hash,idempotency_key,status,customer_email,
           customer_phone,customer_name,contact_snapshot,delivery_snapshot,currency,
           subtotal_kopeks,total_amount_kopeks,customer_note,terms_accepted_at,legal_policy_version,
           personal_data_consent_at,personal_data_consent_policy_version,
           personal_data_consent_document_path,personal_data_consent_text,
           personal_data_consent_ip_address,personal_data_consent_user_agent)
         VALUES ($1,$2,$3,$4,$5,'awaiting_confirmation',$6,$7,$8,$9::jsonb,$10::jsonb,
           'RUB',$11,$11,$12,clock_timestamp(),$13,clock_timestamp(),$14,$15,$16,$17,$18)`,
        [orderId, publicOrderNumber(orderId), owner.userId ?? null, guestTokenHash ?? null,
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
         VALUES ($1,'awaiting_confirmation','checkout_created',$2)`,
        [orderId, owner.userId ?? null],
      );
      await client.query(
        `UPDATE app.idempotency_keys
         SET response_status=201,response_body=$3::jsonb,resource_type='order',resource_id=$4,
             completed_at=clock_timestamp(),locked_until=NULL
         WHERE scope=$1 AND key=$2`,
        [scope, request.idempotencyKey, JSON.stringify({ orderId }), orderId],
      );
      await this.audit.record({
        action: "checkout.created",
        actorRole: auth?.role,
        actorUserId: owner.userId,
        entityId: orderId,
        entityType: "order",
        ipAddress: metadata.ipAddress,
        metadata: { itemCount: lines.length },
        userAgent: metadata.userAgent,
      }, client);

      return {
        guestAccessToken: guestAccessToken ?? null,
        idempotentReplay: false,
        order: {
          id: orderId,
          publicNumber: publicOrderNumber(orderId),
          status: "awaiting_confirmation",
          subtotalKopeks,
          totalAmountKopeks: subtotalKopeks,
        },
      };
    });
  }

  /**
   * Re-reads the current price and confirms enough stock exists for every
   * line -- the browser only ever supplies a product ID and a quantity.
   * Unlike the old reservation flow this does not hold the stock: the
   * owner rejected a reservation "по таймеру", and with no payment step to
   * wait out there is nothing left for a hold to protect. Two заявки can
   * race for the last unit; the manager resolves that on the confirmation
   * call, the same way they resolve every other detail of a заявка by phone.
   */
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
      const inventory = (await client.query<{ available_quantity: number }>(
        `SELECT balance.quantity_on_hand-balance.quantity_reserved AS available_quantity
         FROM app.inventory_balances AS balance
         JOIN app.warehouses AS warehouse ON warehouse.id=balance.warehouse_id
         WHERE balance.product_id=$1
           AND balance.quantity_on_hand-balance.quantity_reserved > 0
           AND warehouse.is_active AND warehouse.deleted_at IS NULL
         FOR UPDATE OF balance
        `,
        [item.productId],
      )).rows;
      const totalAvailable = inventory.reduce((total, row) => total + row.available_quantity, 0);
      if (totalAvailable < item.quantity) {
        // The customer reads this: name the part, not its identifier.
        const title = `«${publicProductName(product.name, product.sku)}» (${product.sku})`;
        throw new ConflictException(totalAvailable > 0
          ? `Недостаточно остатка: ${title}, в наличии ${totalAvailable} шт. Уменьшите количество в корзине.`
          : `Товара ${title} сейчас нет в наличии. Удалите его из корзины.`);
      }
      lines.push({
        amountKopeks,
        // The order is a document the customer reads: without the staff's notes typed into the name in 1С.
        name: publicProductName(product.name, product.sku),
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
    guestAccessToken?: string,
  ) {
    const row = (await client.query<{
      order_id: string;
      public_number: string;
      status: string;
      subtotal_kopeks: string;
      total_amount_kopeks: string;
    }>(
      `SELECT id AS order_id,public_number,status,subtotal_kopeks::text,total_amount_kopeks::text
       FROM app.orders WHERE id=$1`,
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
    };
  }
}
