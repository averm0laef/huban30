import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";

import { OrderStatusUpdateSchema, type OrderStatus } from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { CryptoService } from "../security/crypto.service.js";

const STAFF_ROLES = new Set(["manager", "director", "admin"]);
const STAFF_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  awaiting_confirmation: ["processing", "awaiting_delivery_terms", "ready", "cancelled"],
  awaiting_delivery_terms: ["processing", "ready", "cancelled"],
  cancelled: [],
  completed: [],
  processing: ["awaiting_delivery_terms", "ready", "cancelled"],
  ready: ["completed", "cancelled"],
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
  constructor(
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
  ) {}

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
      public_number: string;
      status: OrderStatus;
      total_amount_kopeks: string;
      version: number;
    }>(
      `SELECT id,public_number,status,customer_name,total_amount_kopeks::text,version,created_at
       FROM app.orders
       WHERE ($1::boolean OR user_id=$2)
       ORDER BY created_at DESC LIMIT $3`,
      [staff, auth.userId, limit],
    );
    return result.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      customerName: row.customer_name,
      id: row.id,
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
      `SELECT 1 FROM app.orders
       WHERE id=$1 AND user_id IS NULL AND guest_token_hash=$2 LIMIT 1`,
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
        status: OrderStatus;
        version: number;
      }>(
        "SELECT status,version FROM app.orders WHERE id=$1 FOR UPDATE", [orderId],
      )).rows[0];
      if (!order) throw new NotFoundException("Заказ не найден");
      if (order.version !== request.version) {
        throw new ConflictException({ error: "order_version_conflict", currentVersion: order.version });
      }
      if (!STAFF_TRANSITIONS[order.status].includes(request.status)) {
        throw new ConflictException(`Переход ${order.status} → ${request.status} запрещён`);
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

  private async readOrder(orderId: string) {
    const order = (await this.database.query<{
      contact_snapshot: unknown;
      created_at: Date;
      customer_note: string | null;
      delivery_snapshot: unknown;
      guest_token_hash: Buffer | null;
      id: string;
      public_number: string;
      status: OrderStatus;
      subtotal_kopeks: string;
      total_amount_kopeks: string;
      user_id: string | null;
      version: number;
    }>(
      `SELECT id,public_number,user_id,status,contact_snapshot,delivery_snapshot,customer_note,
              subtotal_kopeks::text,total_amount_kopeks::text,version,created_at,guest_token_hash
       FROM app.orders WHERE id=$1`,
      [orderId],
    )).rows[0];
    if (!order) throw new NotFoundException("Заказ не найден");
    const items = await this.database.query<{
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
    );
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
        publicNumber: order.public_number,
        status: order.status,
        subtotalKopeks: Number(order.subtotal_kopeks),
        totalAmountKopeks: Number(order.total_amount_kopeks),
        version: order.version,
      },
      userId: order.user_id,
    };
  }
}
