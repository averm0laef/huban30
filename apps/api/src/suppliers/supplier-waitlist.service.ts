import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  StaffSupplierWaitlistQuerySchema,
  StaffSupplierWaitlistUpdateSchema,
  SupplierWaitlistCreateSchema,
  type SupplierWaitlistCreate,
  type SupplierWaitlistStatus,
} from "@an30/contracts";

import {
  SUPPLIER_PROVIDER,
  type SupplierPart,
  type SupplierProvider,
} from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { canManagerChangeAssignment, canReopenRequest } from "../staff/staff.service.js";
import { applySupplierMarkup } from "./supplier-pricing.js";

interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

interface PageQuery {
  limit: number;
  offset: number;
}

const UUID = z.uuid();

// new -> in_progress -> fulfilled/cancelled, mirroring the contact-request
// state machine (new/in_progress/resolved/closed) one-for-one.
const WAITLIST_TRANSITIONS: Readonly<Record<SupplierWaitlistStatus, readonly SupplierWaitlistStatus[]>> = {
  cancelled: ["new"],
  fulfilled: ["in_progress", "cancelled"],
  in_progress: ["new", "fulfilled", "cancelled"],
  new: ["in_progress", "cancelled"],
};

function paged<T>(items: T[], total: string | undefined, query: PageQuery) {
  return { items, limit: query.limit, offset: query.offset, total: Number(total ?? 0) };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function searchPattern(value: string | undefined): string | null {
  if (!value) return null;
  return `%${value.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

function parse<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({ error: "invalid_supplier_waitlist_request", issues: result.error.issues, message });
  }
  return result.data;
}

// Exported for tests to build a matching hash fixture; not part of the
// module's external HTTP surface.
export function requestHash(body: SupplierWaitlistCreate): Buffer {
  return createHash("sha256").update(JSON.stringify({
    contact: body.contact,
    partGuid: body.partGuid,
    policyVersion: body.policyVersion,
    quantity: body.quantity,
    query: body.query,
    source: body.source,
    stockId: body.stockId,
  })).digest();
}

// Crosses are analogues offered alongside a part, one level deep — a
// customer may pick either the searched-for part or one of its analogues.
function findSupplierPart(parts: readonly SupplierPart[], guid: string): SupplierPart | undefined {
  for (const part of parts) {
    if (part.guid === guid) return part;
    const cross = part.crosses.find((candidate) => candidate.guid === guid);
    if (cross) return cross;
  }
  return undefined;
}

interface WaitlistRow {
  assigned_name: string | null;
  assigned_staff_id: string | null;
  created_at: Date;
  customer_email: string | null;
  customer_name: string;
  customer_phone: string | null;
  delivery_time: string | null;
  id: string;
  part_brand: string;
  part_name: string;
  part_number: string;
  price_kopeks: string;
  quantity: number;
  resolved_at: Date | null;
  status: SupplierWaitlistStatus;
  supplier: string;
  updated_at: Date;
  version: number;
}

const WAITLIST_ROW_COLUMNS = `
  waitlist.id,waitlist.supplier,waitlist.part_brand,waitlist.part_number,waitlist.part_name,
  waitlist.price_kopeks::text,waitlist.delivery_time,waitlist.quantity,
  waitlist.customer_name,waitlist.customer_email::text,waitlist.customer_phone,
  waitlist.status,waitlist.assigned_staff_id,assigned.display_name AS assigned_name,
  waitlist.version,waitlist.resolved_at,waitlist.created_at,waitlist.updated_at
`;
const WAITLIST_FROM = `
  FROM app.supplier_waitlist_requests AS waitlist
  LEFT JOIN app.users AS assigned ON assigned.id=waitlist.assigned_staff_id
`;

@Injectable()
export class SupplierWaitlistService {
  private readonly legalDocumentsApproved: boolean;
  private readonly markupPercent: number;

  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
    @Inject(SUPPLIER_PROVIDER) private readonly supplier: SupplierProvider,
    config: ConfigService,
  ) {
    this.legalDocumentsApproved = config.get<boolean>("LEGAL_DOCUMENTS_APPROVED") ?? false;
    this.markupPercent = config.get<number>("SUPPLIER_MARKUP_PERCENT") ?? 30;
  }

  async create(input: unknown, metadata: RequestMetadata) {
    if (!this.legalDocumentsApproved) {
      throw new ServiceUnavailableException(
        "Приём персональных данных откроется после публикации утверждённых документов",
      );
    }
    const body = parse(SupplierWaitlistCreateSchema, input, "Некорректная заявка на ожидание");

    // Re-resolve the part/stock from the server's own trusted supplier
    // lookup (cache-first — see RosskoSupplierProvider). The client only
    // points at which line it means; price and delivery time always come
    // from here, never from the request body.
    const searchResult = await this.supplier.search(body.query);
    if (!searchResult.success) {
      throw new ServiceUnavailableException("Поставщик временно недоступен. Повторите заявку позже.");
    }
    const part = findSupplierPart(searchResult.parts, body.partGuid);
    if (!part) throw new NotFoundException("Деталь у поставщика больше не найдена. Повторите поиск.");
    const stock = part.stocks.find((candidate) => candidate.id === body.stockId);
    if (!stock) throw new NotFoundException("Эта позиция больше не доступна у поставщика. Повторите поиск.");
    const retailPriceKopeks = applySupplierMarkup(stock.priceKopeks, this.markupPercent);

    const hash = requestHash(body);
    return this.database.transaction(async (client) => {
      const inserted = (await client.query<{ created_at: Date; id: string; status: SupplierWaitlistStatus }>(
        `INSERT INTO app.supplier_waitlist_requests (
           idempotency_key,request_hash,supplier,part_guid,part_brand,part_number,part_name,stock_id,
           price_kopeks,delivery_time,quantity,customer_name,customer_email,customer_phone,
           consent_at,consent_policy_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,clock_timestamp(),$15)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id,status,created_at`,
        [
          body.idempotencyKey, hash, body.source, part.guid, part.brand, part.partNumber, part.name,
          stock.id, retailPriceKopeks, stock.deliveryTime, body.quantity, body.contact.name,
          body.contact.email ?? null, body.contact.phone ?? null, body.policyVersion,
        ],
      )).rows[0];

      if (!inserted) {
        const existing = (await client.query<{
          created_at: Date; id: string; request_hash: Buffer; status: SupplierWaitlistStatus;
        }>(
          `SELECT id,status,request_hash,created_at FROM app.supplier_waitlist_requests
           WHERE idempotency_key=$1`,
          [body.idempotencyKey],
        )).rows[0];
        if (!existing) throw new ConflictException("Не удалось проверить повтор заявки");
        if (!existing.request_hash.equals(hash)) {
          throw new ConflictException("Этот ключ уже использован для другой заявки");
        }
        return this.createdView(existing, true);
      }

      await client.query(
        `INSERT INTO app.outbox_events (topic,aggregate_type,aggregate_id,payload)
         VALUES ('supplier_waitlist.staff.notify','supplier_waitlist_request',$1,$2::jsonb)`,
        [inserted.id, JSON.stringify({ partNumber: part.partNumber, requestId: inserted.id })],
      );
      await this.audit.record({
        action: "supplier_waitlist.request.created",
        entityId: inserted.id,
        entityType: "supplier_waitlist_request",
        ipAddress: metadata.ipAddress,
        metadata: { partNumber: part.partNumber, quantity: body.quantity, supplier: body.source },
        userAgent: metadata.userAgent,
      }, client);
      return this.createdView(inserted, false);
    });
  }

  async list(rawQuery: unknown, auth: AuthContext) {
    const query = parse(StaffSupplierWaitlistQuerySchema, rawQuery, "Некорректные параметры очереди ожидания");
    const sort = { createdAt: "waitlist.created_at", status: "waitlist.status" }[query.sort];
    const assignedStaffId = query.assigned === "mine" ? auth.userId : null;
    const onlyUnassigned = query.assigned === "unassigned";
    const pattern = searchPattern(query.q);
    const filters = `($1::text IS NULL OR waitlist.status=$1)
      AND ($2::uuid IS NULL OR waitlist.assigned_staff_id=$2)
      AND (NOT $3::boolean OR waitlist.assigned_staff_id IS NULL)
      AND ($4::text IS NULL OR waitlist.customer_name ILIKE $4 ESCAPE '\\'
        OR waitlist.customer_email::text ILIKE $4 ESCAPE '\\'
        OR waitlist.customer_phone ILIKE $4 ESCAPE '\\'
        OR waitlist.part_number ILIKE $4 ESCAPE '\\'
        OR waitlist.part_brand ILIKE $4 ESCAPE '\\')`;
    const [rows, count] = await Promise.all([
      this.database.query<WaitlistRow>(
        `SELECT ${WAITLIST_ROW_COLUMNS} ${WAITLIST_FROM}
         WHERE ${filters}
         ORDER BY ${sort} ${query.direction === "asc" ? "ASC" : "DESC"},waitlist.id
         LIMIT $5 OFFSET $6`,
        [query.status ?? null, assignedStaffId, onlyUnassigned, pattern, query.limit, query.offset],
      ),
      this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count ${WAITLIST_FROM} WHERE ${filters}`,
        [query.status ?? null, assignedStaffId, onlyUnassigned, pattern],
      ),
    ]);
    return paged(rows.rows.map((row) => this.view(row)), count.rows[0]?.count, query);
  }

  async detail(requestId: string) {
    this.uuid(requestId, "Некорректный идентификатор заявки");
    const row = (await this.database.query<WaitlistRow>(
      `SELECT ${WAITLIST_ROW_COLUMNS} ${WAITLIST_FROM} WHERE waitlist.id=$1`,
      [requestId],
    )).rows[0];
    if (!row) throw new NotFoundException("Заявка не найдена");
    return this.view(row);
  }

  async update(requestId: string, rawInput: unknown, auth: AuthContext, metadata: RequestMetadata) {
    this.uuid(requestId, "Некорректный идентификатор заявки");
    const input = parse(StaffSupplierWaitlistUpdateSchema, rawInput, "Некорректное изменение заявки");
    return this.database.transaction(async (client) => {
      const current = (await client.query<{
        assigned_staff_id: string | null; status: SupplierWaitlistStatus; version: number;
      }>(
        `SELECT assigned_staff_id,status,version FROM app.supplier_waitlist_requests WHERE id=$1 FOR UPDATE`,
        [requestId],
      )).rows[0];
      if (!current) throw new NotFoundException("Заявка не найдена");
      if (current.version !== input.version) {
        throw new ConflictException({ currentVersion: current.version, error: "supplier_waitlist_version_conflict" });
      }
      const targetAssignment = input.assignedStaffId === undefined
        ? current.assigned_staff_id : input.assignedStaffId;
      const targetStatus = input.status ?? current.status;
      this.assertAssignment(auth, current.assigned_staff_id, input.assignedStaffId);
      this.assertTransition(auth.role, current.status, targetStatus);
      if (targetAssignment) await this.assertActiveStaff(targetAssignment, client);
      if (targetAssignment === current.assigned_staff_id && targetStatus === current.status) {
        throw new ConflictException("В заявке нет изменений для сохранения");
      }
      const updated = (await client.query<{
        assigned_staff_id: string | null; resolved_at: Date | null; status: SupplierWaitlistStatus;
        updated_at: Date; version: number;
      }>(
        `UPDATE app.supplier_waitlist_requests SET assigned_staff_id=$2,status=$3,
           resolved_at=CASE
             WHEN $3='fulfilled' THEN COALESCE(resolved_at,clock_timestamp())
             WHEN $3 IN ('new','in_progress') THEN NULL
             ELSE resolved_at
           END,
           version=version+1
         WHERE id=$1 AND version=$4
         RETURNING assigned_staff_id,status,resolved_at,updated_at,version`,
        [requestId, targetAssignment, targetStatus, input.version],
      )).rows[0];
      if (!updated) throw new ConflictException({ error: "supplier_waitlist_version_conflict" });
      await this.audit.record({
        action: "supplier_waitlist.request.updated",
        actorRole: auth.role,
        actorUserId: auth.userId,
        afterState: updated,
        beforeState: current,
        entityId: requestId,
        entityType: "supplier_waitlist_request",
        ipAddress: metadata.ipAddress,
        metadata: { reason: input.reason },
        userAgent: metadata.userAgent,
      }, client);
      return {
        assignedStaffId: updated.assigned_staff_id,
        id: requestId,
        resolvedAt: iso(updated.resolved_at),
        status: updated.status,
        updatedAt: updated.updated_at.toISOString(),
        version: updated.version,
      };
    });
  }

  private createdView(row: { created_at: Date; id: string; status: SupplierWaitlistStatus }, replayed: boolean) {
    return {
      createdAt: row.created_at.toISOString(),
      id: row.id,
      message: "Заявка на ожидание принята. Мы свяжемся с вами, когда деталь будет готова.",
      replayed,
      status: row.status,
    };
  }

  private view(row: WaitlistRow) {
    return {
      assignedName: row.assigned_name,
      assignedStaffId: row.assigned_staff_id,
      createdAt: row.created_at.toISOString(),
      customerEmail: row.customer_email,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      deliveryTime: row.delivery_time,
      id: row.id,
      partBrand: row.part_brand,
      partName: row.part_name,
      partNumber: row.part_number,
      priceKopeks: Number(row.price_kopeks),
      quantity: row.quantity,
      resolvedAt: iso(row.resolved_at),
      status: row.status,
      supplier: row.supplier,
      updatedAt: row.updated_at.toISOString(),
      version: row.version,
    };
  }

  private assertAssignment(
    auth: AuthContext,
    currentAssignment: string | null,
    requested: string | null | undefined,
  ): void {
    if (requested === undefined || auth.role !== "manager") return;
    if (canManagerChangeAssignment(currentAssignment, requested, auth.userId)) return;
    throw new ForbiddenException("Менеджер может назначить заявку только на себя или снять своё назначение");
  }

  private assertTransition(role: AuthContext["role"], current: SupplierWaitlistStatus, requested: SupplierWaitlistStatus): void {
    if (current === requested) return;
    if ((current === "fulfilled" || current === "cancelled") && !canReopenRequest(role)) {
      throw new ForbiddenException("Вернуть завершённую заявку в работу может директор или администратор");
    }
    if (!WAITLIST_TRANSITIONS[current].includes(requested)) {
      throw new ConflictException("Такое изменение состояния заявки запрещено");
    }
  }

  private async assertActiveStaff(userId: string, client: PoolClient): Promise<void> {
    const staff = await client.query(
      "SELECT 1 FROM app.staff_members WHERE user_id=$1 AND status='active'",
      [userId],
    );
    if (staff.rowCount === 0) throw new BadRequestException("Сотрудник недоступен для назначения");
  }

  private uuid(value: string, message: string): void {
    if (!UUID.safeParse(value).success) throw new BadRequestException(message);
  }
}
