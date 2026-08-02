import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  ROLE_PERMISSIONS,
  StaffAuditQuerySchema,
  StaffCatalogQuerySchema,
  StaffChatsQuerySchema,
  StaffChatUpdateSchema,
  StaffInvoiceCreateSchema,
  StaffInvoicesQuerySchema,
  StaffInvoiceUpdateSchema,
  StaffOrdersQuerySchema,
  StaffTeamQuerySchema,
  type ChatThreadStatus,
  type OrderStatus,
  type Permission,
  type Role,
} from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";

interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

interface PageQuery {
  limit: number;
  offset: number;
}

const UUID = z.uuid();

const CHAT_TRANSITIONS: Readonly<Record<ChatThreadStatus, readonly ChatThreadStatus[]>> = {
  closed: ["open"],
  open: ["waiting_customer", "waiting_staff", "closed"],
  waiting_customer: ["open", "waiting_staff", "closed"],
  waiting_staff: ["open", "waiting_customer", "closed"],
};

function searchPattern(value: string | undefined): string | null {
  if (!value) return null;
  return `%${value.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

function paged<T>(items: T[], total: string | undefined, query: PageQuery) {
  return {
    items,
    limit: query.limit,
    offset: query.offset,
    total: Number(total ?? 0),
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function canReopenChat(role: Role): boolean {
  return role === "director" || role === "admin";
}

export function canManagerChangeAssignment(
  currentAssignment: string | null,
  requestedAssignment: string | null,
  managerUserId: string,
): boolean {
  if (requestedAssignment === managerUserId) {
    return currentAssignment === null || currentAssignment === managerUserId;
  }
  return requestedAssignment === null && currentAssignment === managerUserId;
}

export function canIssueInvoiceForOrder(status: OrderStatus | null): boolean {
  return status === null || !["pending_payment", "cancelled", "refunded"].includes(status);
}

@Injectable()
export class StaffService {
  constructor(
    private readonly auditLog: AuditService,
    private readonly database: DatabaseService,
  ) {}

  async summary(auth: AuthContext) {
    const permissions: readonly Permission[] = ROLE_PERMISSIONS[auth.role];
    const canReadReports = permissions.includes("reports:read");
    const result = await this.database.query<{
      chats_unassigned: string;
      chats_waiting_staff: string;
      low_stock: string;
      orders_active: string;
      orders_ready: string;
      orders_waiting_payment: string;
      out_of_stock: string;
      cashflow_today_kopeks: string | null;
    }>(
      `SELECT
        (SELECT count(*)::text FROM app.orders
          WHERE status IN ('paid','processing','awaiting_delivery_terms')) AS orders_active,
        (SELECT count(*)::text FROM app.orders WHERE status='pending_payment') AS orders_waiting_payment,
        (SELECT count(*)::text FROM app.orders WHERE status='ready') AS orders_ready,
        (SELECT count(*)::text FROM app.chat_threads
          WHERE deleted_at IS NULL AND status='waiting_staff') AS chats_waiting_staff,
        (SELECT count(*)::text FROM app.chat_threads
          WHERE deleted_at IS NULL AND status<>'closed' AND assigned_staff_id IS NULL) AS chats_unassigned,
        (SELECT count(*)::text FROM (
          SELECT product.id
          FROM app.products AS product
          LEFT JOIN app.available_inventory AS balance ON balance.product_id=product.id
          WHERE product.deleted_at IS NULL AND product.is_active
          GROUP BY product.id
          HAVING COALESCE(sum(balance.quantity_available),0)=0
        ) AS unavailable) AS out_of_stock,
        (SELECT count(*)::text FROM (
          SELECT product.id
          FROM app.products AS product
          LEFT JOIN app.available_inventory AS balance ON balance.product_id=product.id
          WHERE product.deleted_at IS NULL AND product.is_active
          GROUP BY product.id
          HAVING COALESCE(sum(balance.quantity_available),0) BETWEEN 1 AND 3
        ) AS low) AS low_stock,
        CASE WHEN $1::boolean THEN (
          (SELECT COALESCE(sum(amount_kopeks),0) FROM app.payments
           WHERE succeeded_at >= (
             date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Chita')
             AT TIME ZONE 'Asia/Chita'
           ) AND status IN ('succeeded','partially_refunded','refunded'))
          -
          (SELECT COALESCE(sum(amount_kopeks),0) FROM app.refunds
           WHERE succeeded_at >= (
             date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Chita')
             AT TIME ZONE 'Asia/Chita'
           ) AND status='succeeded')
        )::text ELSE NULL END AS cashflow_today_kopeks`,
      [canReadReports],
    );
    const row = result.rows[0];
    return {
      catalog: {
        lowStock: Number(row?.low_stock ?? 0),
        outOfStock: Number(row?.out_of_stock ?? 0),
      },
      chats: {
        unassigned: Number(row?.chats_unassigned ?? 0),
        waitingStaff: Number(row?.chats_waiting_staff ?? 0),
      },
      generatedAt: new Date().toISOString(),
      orders: {
        active: Number(row?.orders_active ?? 0),
        ready: Number(row?.orders_ready ?? 0),
        waitingPayment: Number(row?.orders_waiting_payment ?? 0),
      },
      cashflowTodayKopeks: row?.cashflow_today_kopeks === null
        ? null
        : Number(row?.cashflow_today_kopeks ?? 0),
    };
  }

  async orders(rawQuery: unknown) {
    const query = this.parse(StaffOrdersQuerySchema, rawQuery, "Некорректные параметры заказов");
    const sort = {
      createdAt: "checkout_order.created_at",
      publicNumber: "checkout_order.public_number",
      status: "checkout_order.status",
      totalAmountKopeks: "checkout_order.total_amount_kopeks",
    }[query.sort];
    const pattern = searchPattern(query.q);
    const [rows, count] = await Promise.all([
      this.database.query<{
        created_at: Date;
        customer_email: string;
        customer_name: string;
        customer_phone: string;
        id: string;
        item_count: string;
        paid_amount_kopeks: string;
        public_number: string;
        status: OrderStatus;
        total_amount_kopeks: string;
        version: number;
      }>(
        `SELECT checkout_order.id,checkout_order.public_number,checkout_order.status,
                checkout_order.customer_name,checkout_order.customer_email::text,
                checkout_order.customer_phone,checkout_order.total_amount_kopeks::text,
                checkout_order.paid_amount_kopeks::text,checkout_order.version,
                checkout_order.created_at,count(order_item.id)::text AS item_count
         FROM app.orders AS checkout_order
         LEFT JOIN app.order_items AS order_item ON order_item.order_id=checkout_order.id
         WHERE ($1::app.order_status IS NULL OR checkout_order.status=$1)
           AND ($2::text IS NULL OR checkout_order.public_number ILIKE $2 ESCAPE '\\'
             OR checkout_order.customer_name ILIKE $2 ESCAPE '\\'
             OR checkout_order.customer_email::text ILIKE $2 ESCAPE '\\'
             OR checkout_order.customer_phone ILIKE $2 ESCAPE '\\')
         GROUP BY checkout_order.id
         ORDER BY ${sort} ${query.direction === "asc" ? "ASC" : "DESC"},checkout_order.id
         LIMIT $3 OFFSET $4`,
        [query.status ?? null, pattern, query.limit, query.offset],
      ),
      this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.orders AS checkout_order
         WHERE ($1::app.order_status IS NULL OR checkout_order.status=$1)
           AND ($2::text IS NULL OR checkout_order.public_number ILIKE $2 ESCAPE '\\'
             OR checkout_order.customer_name ILIKE $2 ESCAPE '\\'
             OR checkout_order.customer_email::text ILIKE $2 ESCAPE '\\'
             OR checkout_order.customer_phone ILIKE $2 ESCAPE '\\')`,
        [query.status ?? null, pattern],
      ),
    ]);
    return paged(rows.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      customerEmail: row.customer_email,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      id: row.id,
      itemCount: Number(row.item_count),
      paidAmountKopeks: Number(row.paid_amount_kopeks),
      publicNumber: row.public_number,
      status: row.status,
      totalAmountKopeks: Number(row.total_amount_kopeks),
      version: row.version,
    })), count.rows[0]?.count, query);
  }

  async chats(rawQuery: unknown, auth: AuthContext) {
    const query = this.parse(StaffChatsQuerySchema, rawQuery, "Некорректные параметры чатов");
    const sort = {
      createdAt: "thread.created_at",
      lastMessageAt: "thread.last_message_at",
      status: "thread.status",
    }[query.sort];
    const pattern = searchPattern(query.q);
    const assignedStaffId = query.assigned === "mine" ? auth.userId : null;
    const onlyUnassigned = query.assigned === "unassigned";
    const filters = `thread.deleted_at IS NULL
      AND ($1::app.chat_thread_status IS NULL OR thread.status=$1)
      AND ($2::uuid IS NULL OR thread.assigned_staff_id=$2)
      AND (NOT $3::boolean OR thread.assigned_staff_id IS NULL)
      AND ($4::text IS NULL OR thread.subject ILIKE $4 ESCAPE '\\'
        OR customer.display_name ILIKE $4 ESCAPE '\\'
        OR customer.email::text ILIKE $4 ESCAPE '\\'
        OR checkout_order.public_number ILIKE $4 ESCAPE '\\')`;
    const [rows, count] = await Promise.all([
      this.database.query<{
        assigned_name: string | null;
        assigned_staff_id: string | null;
        created_at: Date;
        customer_email: string | null;
        customer_name: string | null;
        id: string;
        last_message_at: Date | null;
        last_message_body: string | null;
        order_id: string | null;
        order_number: string | null;
        status: ChatThreadStatus;
        subject: string | null;
        unread_count: string;
        version: number;
      }>(
        `SELECT thread.id,thread.order_id,thread.assigned_staff_id,thread.status,
                thread.subject,thread.last_message_at,thread.created_at,thread.version,
                customer.display_name AS customer_name,customer.email::text AS customer_email,
                assigned.display_name AS assigned_name,checkout_order.public_number AS order_number,
                last_message.body AS last_message_body,
                (SELECT count(*)::text FROM app.chat_messages AS unread
                 LEFT JOIN app.chat_message_receipts AS receipt
                   ON receipt.message_id=unread.id AND receipt.user_id=$5
                 WHERE unread.thread_id=thread.id AND unread.deleted_at IS NULL
                   AND unread.sender_kind IN ('customer','guest') AND receipt.read_at IS NULL
                ) AS unread_count
         FROM app.chat_threads AS thread
         LEFT JOIN app.users AS customer ON customer.id=thread.customer_user_id
         LEFT JOIN app.users AS assigned ON assigned.id=thread.assigned_staff_id
         LEFT JOIN app.orders AS checkout_order ON checkout_order.id=thread.order_id
         LEFT JOIN LATERAL (
           SELECT body FROM app.chat_messages
           WHERE thread_id=thread.id AND deleted_at IS NULL
           ORDER BY sequence_number DESC LIMIT 1
         ) AS last_message ON true
         WHERE ${filters}
         ORDER BY ${sort} ${query.direction === "asc" ? "ASC" : "DESC"} NULLS LAST,thread.id
         LIMIT $6 OFFSET $7`,
        [query.status ?? null, assignedStaffId, onlyUnassigned, pattern,
          auth.userId, query.limit, query.offset],
      ),
      this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM app.chat_threads AS thread
         LEFT JOIN app.users AS customer ON customer.id=thread.customer_user_id
         LEFT JOIN app.orders AS checkout_order ON checkout_order.id=thread.order_id
         WHERE ${filters}`,
        [query.status ?? null, assignedStaffId, onlyUnassigned, pattern],
      ),
    ]);
    return paged(rows.rows.map((row) => ({
      assignedName: row.assigned_name,
      assignedStaffId: row.assigned_staff_id,
      createdAt: row.created_at.toISOString(),
      customerEmail: row.customer_email,
      customerName: row.customer_name ?? (row.customer_email ? null : "Гость"),
      id: row.id,
      lastMessageAt: iso(row.last_message_at),
      lastMessageBody: row.last_message_body,
      orderId: row.order_id,
      orderNumber: row.order_number,
      status: row.status,
      subject: row.subject,
      unreadCount: Number(row.unread_count),
      version: row.version,
    })), count.rows[0]?.count, query);
  }

  async updateChat(
    threadId: string,
    rawInput: unknown,
    auth: AuthContext,
    metadata: RequestMetadata,
  ) {
    this.uuid(threadId, "Некорректный идентификатор чата");
    const input = this.parse(StaffChatUpdateSchema, rawInput, "Некорректное изменение чата");
    return this.database.transaction(async (client) => {
      const current = (await client.query<{
        assigned_staff_id: string | null;
        status: ChatThreadStatus;
        version: number;
      }>(
        `SELECT assigned_staff_id,status,version FROM app.chat_threads
         WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [threadId],
      )).rows[0];
      if (!current) throw new NotFoundException("Чат не найден");
      if (current.version !== input.version) {
        throw new ConflictException({ error: "chat_version_conflict", currentVersion: current.version });
      }
      const targetAssignment = input.assignedStaffId === undefined
        ? current.assigned_staff_id : input.assignedStaffId;
      const targetStatus = input.status ?? current.status;
      this.assertChatAssignment(auth, current.assigned_staff_id, input.assignedStaffId);
      this.assertChatTransition(auth.role, current.status, targetStatus);
      if (targetAssignment) await this.assertActiveStaff(targetAssignment, client);
      if (targetAssignment === current.assigned_staff_id && targetStatus === current.status) {
        throw new ConflictException("В чате нет изменений для сохранения");
      }
      const updated = (await client.query<{
        assigned_staff_id: string | null;
        closed_at: Date | null;
        status: ChatThreadStatus;
        version: number;
      }>(
        `UPDATE app.chat_threads SET assigned_staff_id=$2,status=$3,
           closed_at=CASE WHEN $3='closed' THEN COALESCE(closed_at,clock_timestamp()) ELSE NULL END,
           version=version+1
         WHERE id=$1 AND version=$4
         RETURNING assigned_staff_id,status,closed_at,version`,
        [threadId, targetAssignment, targetStatus, input.version],
      )).rows[0];
      if (!updated) throw new ConflictException({ error: "chat_version_conflict" });
      await this.auditLog.record({
        action: "chat.thread_updated",
        actorRole: auth.role,
        actorUserId: auth.userId,
        afterState: updated,
        beforeState: current,
        entityId: threadId,
        entityType: "chat_thread",
        ipAddress: metadata.ipAddress,
        metadata: { reason: input.reason },
        userAgent: metadata.userAgent,
      }, client);
      return {
        assignedStaffId: updated.assigned_staff_id,
        closedAt: iso(updated.closed_at),
        id: threadId,
        status: updated.status,
        version: updated.version,
      };
    });
  }

  async catalog(rawQuery: unknown) {
    const query = this.parse(StaffCatalogQuerySchema, rawQuery, "Некорректные параметры каталога");
    const sort = {
      available: "available_quantity",
      name: "product.name",
      price: "price.amount_kopeks",
      sku: "product.sku",
      updatedAt: "product.updated_at",
    }[query.sort];
    const pattern = searchPattern(query.q);
    const filters = `product.deleted_at IS NULL
      AND ($1='all' OR ($1='active' AND product.is_active) OR ($1='inactive' AND NOT product.is_active))
      AND ($2::text IS NULL OR product.name ILIKE $2 ESCAPE '\\'
        OR product.sku::text ILIKE $2 ESCAPE '\\'
        OR product.external_id ILIKE $2 ESCAPE '\\')
      AND ($3='all' OR ($3='available' AND inventory.available_quantity>0)
        OR ($3='out_of_stock' AND inventory.available_quantity=0)
        OR ($3='low_stock' AND inventory.available_quantity BETWEEN 1 AND 3))`;
    const from = `FROM app.products AS product
      LEFT JOIN app.current_product_prices AS price ON price.product_id=product.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(balance.quantity_available),0)::bigint AS available_quantity,
               max(balance.updated_at) AS updated_at
        FROM app.available_inventory AS balance WHERE balance.product_id=product.id
      ) AS inventory ON true`;
    const [rows, count] = await Promise.all([
      this.database.query<{
        amount_kopeks: string | null;
        available_quantity: string;
        category_name: string | null;
        currency: string | null;
        external_id: string | null;
        id: string;
        is_active: boolean;
        is_demo: boolean;
        name: string;
        sku: string;
        source_version: string;
        updated_at: Date;
      }>(
        `SELECT product.id,product.external_id,product.sku::text,product.name,product.is_active,
                product.is_demo,product.source_version::text,product.updated_at,
                price.amount_kopeks::text,price.currency,
                inventory.available_quantity::text,category.name AS category_name
         ${from}
         LEFT JOIN app.categories AS category ON category.id=product.category_id
         WHERE ${filters}
         ORDER BY ${sort} ${query.direction === "asc" ? "ASC" : "DESC"} NULLS LAST,product.id
         LIMIT $4 OFFSET $5`,
        [query.state, pattern, query.availability, query.limit, query.offset],
      ),
      this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count ${from} WHERE ${filters}`,
        [query.state, pattern, query.availability],
      ),
    ]);
    return paged(rows.rows.map((row) => ({
      availableQuantity: Number(row.available_quantity),
      categoryName: row.category_name,
      currency: row.currency,
      externalId: row.external_id,
      id: row.id,
      isActive: row.is_active,
      isDemo: row.is_demo,
      name: row.name,
      priceKopeks: row.amount_kopeks === null ? null : Number(row.amount_kopeks),
      sku: row.sku,
      sourceVersion: Number(row.source_version),
      updatedAt: row.updated_at.toISOString(),
    })), count.rows[0]?.count, query);
  }

  async invoices(rawQuery: unknown) {
    const query = this.parse(StaffInvoicesQuerySchema, rawQuery, "Некорректные параметры накладных");
    const sort = {
      amountKopeks: "invoice.amount_kopeks",
      createdAt: "invoice.created_at",
      invoiceNumber: "invoice.invoice_number",
      status: "invoice.status",
    }[query.sort];
    const pattern = searchPattern(query.q);
    const filters = `($1::app.invoice_status IS NULL OR invoice.status=$1)
      AND ($2::text IS NULL OR invoice.invoice_number ILIKE $2 ESCAPE '\\'
        OR checkout_order.public_number ILIKE $2 ESCAPE '\\'
        OR checkout_order.customer_name ILIKE $2 ESCAPE '\\')`;
    const [rows, count] = await Promise.all([
      this.database.query<{
        amount_kopeks: string;
        created_at: Date;
        customer_name: string | null;
        id: string;
        invoice_number: string;
        issued_at: Date | null;
        order_id: string | null;
        order_number: string | null;
        status: "cancelled" | "draft" | "issued";
        version: number;
      }>(
        `SELECT invoice.id,invoice.order_id,invoice.invoice_number,invoice.status,
                invoice.amount_kopeks::text,invoice.issued_at,invoice.created_at,invoice.version,
                checkout_order.public_number AS order_number,
                checkout_order.customer_name
         FROM app.invoices AS invoice
         LEFT JOIN app.orders AS checkout_order ON checkout_order.id=invoice.order_id
         WHERE ${filters}
         ORDER BY ${sort} ${query.direction === "asc" ? "ASC" : "DESC"},invoice.id
         LIMIT $3 OFFSET $4`,
        [query.status ?? null, pattern, query.limit, query.offset],
      ),
      this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.invoices AS invoice
         LEFT JOIN app.orders AS checkout_order ON checkout_order.id=invoice.order_id
         WHERE ${filters}`,
        [query.status ?? null, pattern],
      ),
    ]);
    return paged(rows.rows.map((row) => ({
      amountKopeks: Number(row.amount_kopeks),
      createdAt: row.created_at.toISOString(),
      customerName: row.customer_name,
      id: row.id,
      invoiceNumber: row.invoice_number,
      issuedAt: iso(row.issued_at),
      orderId: row.order_id,
      orderNumber: row.order_number,
      status: row.status,
      version: row.version,
    })), count.rows[0]?.count, query);
  }

  async createInvoice(rawInput: unknown, auth: AuthContext, metadata: RequestMetadata) {
    const input = this.parse(StaffInvoiceCreateSchema, rawInput, "Некорректные данные накладной");
    return this.database.transaction(async (client) => {
      const order = (await client.query<{
        currency: string;
        status: OrderStatus;
        total_amount_kopeks: string;
      }>(
        "SELECT status,currency,total_amount_kopeks::text FROM app.orders WHERE id=$1 FOR UPDATE",
        [input.orderId],
      )).rows[0];
      if (!order) throw new NotFoundException("Заказ не найден");
      if (["pending_payment", "cancelled", "refunded"].includes(order.status)) {
        throw new ConflictException("Для текущего состояния заказа нельзя создать накладную");
      }
      const numberParts = (await client.query<{ business_year: number; value: string }>(
        `SELECT nextval('app.invoice_number_seq')::text AS value,
                extract(year FROM clock_timestamp() AT TIME ZONE 'Asia/Chita')::integer
                  AS business_year`,
      )).rows[0];
      if (!numberParts) throw new Error("Invoice sequence did not return a value");
      const invoiceNumber = `AN30-${numberParts.business_year}-${numberParts.value.padStart(6, "0")}`;
      try {
        const created = (await client.query<{
          amount_kopeks: string;
          created_at: Date;
          id: string;
          status: "draft";
          version: number;
        }>(
          `INSERT INTO app.invoices
             (order_id,invoice_number,amount_kopeks,currency,created_by)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id,status,amount_kopeks::text,created_at,version`,
          [input.orderId, invoiceNumber, order.total_amount_kopeks, order.currency, auth.userId],
        )).rows[0]!;
        await this.auditLog.record({
          action: "invoice.created",
          actorRole: auth.role,
          actorUserId: auth.userId,
          afterState: { amountKopeks: Number(created.amount_kopeks), status: created.status },
          entityId: created.id,
          entityType: "invoice",
          ipAddress: metadata.ipAddress,
          metadata: { orderId: input.orderId },
          userAgent: metadata.userAgent,
        }, client);
        return {
          amountKopeks: Number(created.amount_kopeks),
          createdAt: created.created_at.toISOString(),
          id: created.id,
          invoiceNumber,
          orderId: input.orderId,
          status: created.status,
          version: created.version,
        };
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          throw new ConflictException("У заказа уже есть действующая накладная");
        }
        throw error;
      }
    });
  }

  async updateInvoice(
    invoiceId: string,
    rawInput: unknown,
    auth: AuthContext,
    metadata: RequestMetadata,
  ) {
    this.uuid(invoiceId, "Некорректный идентификатор накладной");
    const input = this.parse(StaffInvoiceUpdateSchema, rawInput, "Некорректное изменение накладной");
    return this.database.transaction(async (client) => {
      const current = (await client.query<{
        order_id: string | null;
        status: "cancelled" | "draft" | "issued";
        version: number;
      }>("SELECT order_id,status,version FROM app.invoices WHERE id=$1 FOR UPDATE", [invoiceId])).rows[0];
      if (!current) throw new NotFoundException("Накладная не найдена");
      if (current.version !== input.version) {
        throw new ConflictException({ error: "invoice_version_conflict", currentVersion: current.version });
      }
      const allowed = current.status === "draft"
        ? ["issued", "cancelled"] : current.status === "issued" ? ["cancelled"] : [];
      if (!allowed.includes(input.status)) {
        throw new ConflictException("Такое изменение состояния накладной запрещено");
      }
      if (input.status === "issued" && current.order_id) {
        const order = (await client.query<{ status: OrderStatus }>(
          "SELECT status FROM app.orders WHERE id=$1 FOR UPDATE",
          [current.order_id],
        )).rows[0];
        if (!order || !canIssueInvoiceForOrder(order.status)) {
          throw new ConflictException("Нельзя выдать накладную для отменённого или неоплаченного заказа");
        }
      }
      const updated = (await client.query<{
        issued_at: Date | null;
        status: "cancelled" | "issued";
        version: number;
      }>(
        `UPDATE app.invoices SET status=$2,
           issued_at=CASE WHEN $2='issued' THEN clock_timestamp() ELSE issued_at END,
           version=version+1
         WHERE id=$1 AND version=$3 RETURNING status,issued_at,version`,
        [invoiceId, input.status, input.version],
      )).rows[0];
      if (!updated) throw new ConflictException({ error: "invoice_version_conflict" });
      await this.auditLog.record({
        action: "invoice.status_changed",
        actorRole: auth.role,
        actorUserId: auth.userId,
        afterState: updated,
        beforeState: current,
        entityId: invoiceId,
        entityType: "invoice",
        ipAddress: metadata.ipAddress,
        metadata: { reason: input.reason },
        userAgent: metadata.userAgent,
      }, client);
      return { id: invoiceId, issuedAt: iso(updated.issued_at), ...updated };
    });
  }

  async team(rawQuery: unknown) {
    const query = this.parse(StaffTeamQuerySchema, rawQuery, "Некорректные параметры персонала");
    const pattern = searchPattern(query.q);
    const filters = `($1::app.app_role IS NULL OR staff.role=$1)
      AND ($2::app.staff_status IS NULL OR staff.status=$2)
      AND ($3::text IS NULL OR account.display_name ILIKE $3 ESCAPE '\\'
        OR account.email::text ILIKE $3 ESCAPE '\\'
        OR staff.employee_code ILIKE $3 ESCAPE '\\')`;
    const [rows, count] = await Promise.all([
      this.database.query<{
        created_at: Date;
        display_name: string | null;
        email: string;
        employee_code: string | null;
        position_title: string | null;
        role: Exclude<Role, "customer">;
        status: string;
        totp_enabled: boolean;
        user_id: string;
      }>(
        `SELECT staff.user_id,staff.role,staff.status,staff.employee_code,staff.position_title,
                staff.created_at,account.email::text,account.display_name,
                (staff.totp_confirmed_at IS NOT NULL) AS totp_enabled
         FROM app.staff_members AS staff JOIN app.users AS account ON account.id=staff.user_id
         WHERE ${filters}
         ORDER BY account.display_name NULLS LAST,account.email
         LIMIT $4 OFFSET $5`,
        [query.role ?? null, query.status ?? null, pattern, query.limit, query.offset],
      ),
      this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM app.staff_members AS staff JOIN app.users AS account ON account.id=staff.user_id
         WHERE ${filters}`,
        [query.role ?? null, query.status ?? null, pattern],
      ),
    ]);
    return paged(rows.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      displayName: row.display_name,
      email: row.email,
      employeeCode: row.employee_code,
      id: row.user_id,
      positionTitle: row.position_title,
      role: row.role,
      status: row.status,
      totpEnabled: row.totp_enabled,
      userId: row.user_id,
    })), count.rows[0]?.count, query);
  }

  async reports() {
    const [days, statuses] = await Promise.all([
      this.database.query<{
        day: string;
        orders: string;
        net_cashflow_kopeks: string;
      }>(
        `WITH days AS (
           SELECT generate_series(
             (clock_timestamp() AT TIME ZONE 'Asia/Chita')::date-13,
             (clock_timestamp() AT TIME ZONE 'Asia/Chita')::date,
             interval '1 day'
           )::date AS day
         )
         SELECT days.day::text AS day,
                (SELECT count(*)::text FROM app.orders AS checkout_order
                 WHERE checkout_order.created_at>=(days.day::timestamp AT TIME ZONE 'Asia/Chita')
                   AND checkout_order.created_at<((days.day+1)::timestamp AT TIME ZONE 'Asia/Chita')) AS orders,
                ((SELECT COALESCE(sum(payment.amount_kopeks),0)
                  FROM app.payments AS payment
                  WHERE payment.succeeded_at>=(days.day::timestamp AT TIME ZONE 'Asia/Chita')
                    AND payment.succeeded_at<((days.day+1)::timestamp AT TIME ZONE 'Asia/Chita')
                    AND payment.status IN ('succeeded','partially_refunded','refunded'))
                 -
                 (SELECT COALESCE(sum(refund.amount_kopeks),0)
                  FROM app.refunds AS refund
                  WHERE refund.succeeded_at>=(days.day::timestamp AT TIME ZONE 'Asia/Chita')
                    AND refund.succeeded_at<((days.day+1)::timestamp AT TIME ZONE 'Asia/Chita')
                    AND refund.status='succeeded'))::text AS net_cashflow_kopeks
         FROM days ORDER BY days.day`,
      ),
      this.database.query<{ count: string; status: OrderStatus }>(
        "SELECT status,count(*)::text AS count FROM app.orders GROUP BY status ORDER BY status",
      ),
    ]);
    return {
      days: days.rows.map((row) => ({
        date: row.day,
        orders: Number(row.orders),
        netCashflowKopeks: Number(row.net_cashflow_kopeks),
      })),
      generatedAt: new Date().toISOString(),
      orderStatuses: statuses.rows.map((row) => ({ count: Number(row.count), status: row.status })),
    };
  }

  async audit(rawQuery: unknown) {
    const query = this.parse(StaffAuditQuerySchema, rawQuery, "Некорректные параметры аудита");
    const [rows, count] = await Promise.all([
      this.database.query<{
        action: string;
        actor_email: string | null;
        actor_role: Role | null;
        actor_user_id: string | null;
        created_at: Date;
        entity_id: string | null;
        entity_type: string;
        id: string;
      }>(
        `SELECT audit.id::text,audit.actor_user_id,audit.actor_role,audit.action,
                audit.entity_type,audit.entity_id,audit.created_at,account.email::text AS actor_email
         FROM app.audit_log AS audit
         LEFT JOIN app.users AS account ON account.id=audit.actor_user_id
         WHERE ($1::text IS NULL OR audit.action=$1)
           AND ($2::text IS NULL OR audit.entity_type=$2)
         ORDER BY audit.created_at DESC,audit.id DESC LIMIT $3 OFFSET $4`,
        [query.action ?? null, query.entityType ?? null, query.limit, query.offset],
      ),
      this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.audit_log AS audit
         WHERE ($1::text IS NULL OR audit.action=$1)
           AND ($2::text IS NULL OR audit.entity_type=$2)`,
        [query.action ?? null, query.entityType ?? null],
      ),
    ]);
    return paged(rows.rows.map((row) => ({
      action: row.action,
      actorEmail: row.actor_email,
      actorRole: row.actor_role,
      actorUserId: row.actor_user_id,
      createdAt: row.created_at.toISOString(),
      entityId: row.entity_id,
      entityType: row.entity_type,
      id: row.id,
    })), count.rows[0]?.count, query);
  }

  private assertChatAssignment(
    auth: AuthContext,
    currentAssignment: string | null,
    requested: string | null | undefined,
  ): void {
    if (requested === undefined || auth.role !== "manager") return;
    if (canManagerChangeAssignment(currentAssignment, requested, auth.userId)) return;
    throw new ForbiddenException("Менеджер может назначить чат только на себя или снять своё назначение");
  }

  private assertChatTransition(
    role: Role,
    current: ChatThreadStatus,
    requested: ChatThreadStatus,
  ): void {
    if (current === requested) return;
    if (current === "closed" && requested === "open" && !canReopenChat(role)) {
      throw new ForbiddenException("Повторно открыть чат может директор или администратор");
    }
    if (!CHAT_TRANSITIONS[current].includes(requested)) {
      throw new ConflictException("Такое изменение состояния чата запрещено");
    }
  }

  private async assertActiveStaff(userId: string, client: PoolClient): Promise<void> {
    const staff = await client.query(
      "SELECT 1 FROM app.staff_members WHERE user_id=$1 AND status='active'",
      [userId],
    );
    if (staff.rowCount === 0) throw new BadRequestException("Сотрудник недоступен для назначения");
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_staff_request", issues: parsed.error.issues, message });
    }
    return parsed.data;
  }

  private uuid(value: string, message: string): void {
    if (!UUID.safeParse(value).success) throw new BadRequestException(message);
  }
}
