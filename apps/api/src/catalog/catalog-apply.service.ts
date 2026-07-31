import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";

import type { OneCCatalogRow } from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";

interface RequestMetadata {
  ipAddress: string;
  userAgent?: string;
}

interface ApplyRow {
  entity_type: string;
  expected_source_version: string | null;
  id: string;
  normalized_payload: OneCCatalogRow;
  row_number: number;
}

interface RevisionChange {
  after_state: Record<string, unknown> | null;
  before_state: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
  operation: "insert" | "update";
  sequence_number: number;
}

interface ApplyContext {
  batchId: string;
  client: PoolClient;
  revisionId: string;
  sequence: number;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function version(value: string | number): number {
  return Number(value);
}

function assertExpected(
  current: string | number | undefined,
  expected: string | null,
  entity: string,
): void {
  if (expected === null ? current !== undefined : Number(current) !== Number(expected)) {
    throw new ConflictException(`${entity} изменён после preview; повторите выгрузку`);
  }
}

@Injectable()
export class CatalogApplyService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  async apply(
    batchId: string,
    actor: AuthContext,
    metadata: RequestMetadata,
  ): Promise<Record<string, unknown>> {
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('an30-catalog-apply-v1', 0))");
      await client.query("SET LOCAL statement_timeout = '60s'");
      const selected = await client.query<{
        invalid_rows: number;
        status: string;
        valid_rows: number;
      }>(
        "SELECT status::text, valid_rows, invalid_rows FROM app.catalog_import_batches WHERE id = $1 FOR UPDATE",
        [batchId],
      );
      const batch = selected.rows[0];
      if (!batch) throw new NotFoundException("Выгрузка не найдена");
      if (batch.status === "applied") {
        const existing = await client.query<{ id: string; revision_number: string }>(
          "SELECT id::text, revision_number::text FROM app.catalog_revisions WHERE batch_id = $1",
          [batchId],
        );
        return {
          appliedRows: batch.valid_rows,
          batchId,
          idempotentReplay: true,
          revisionId: existing.rows[0]?.id,
          revisionNumber: Number(existing.rows[0]?.revision_number),
          status: "applied",
        };
      }
      if (batch.status !== "validated") {
        throw new ConflictException(`Выгрузка в состоянии ${batch.status} не может быть применена`);
      }
      if (batch.invalid_rows > 0) {
        throw new ConflictException("Apply заблокирован: preview содержит невалидные строки");
      }

      await client.query("UPDATE app.catalog_import_batches SET status = 'applying' WHERE id = $1", [batchId]);
      const revisionNumber = Number((await client.query<{ value: string }>(
        "SELECT (COALESCE(max(revision_number), 0) + 1)::text AS value FROM app.catalog_revisions",
      )).rows[0]?.value ?? 1);
      const revision = await client.query<{ id: string }>(
        `INSERT INTO app.catalog_revisions (batch_id, revision_number, applied_by)
         VALUES ($1, $2, $3) RETURNING id::text`,
        [batchId, revisionNumber, actor.userId],
      );
      const revisionId = revision.rows[0]?.id;
      if (!revisionId) throw new Error("Catalog revision did not return an identifier");
      const rows = (await client.query<ApplyRow>(
        `SELECT id::text, row_number, entity_type, normalized_payload, expected_source_version::text
         FROM app.catalog_import_rows
         WHERE batch_id = $1 AND status = 'valid'
         ORDER BY row_number FOR UPDATE`,
        [batchId],
      )).rows;
      const context: ApplyContext = { batchId, client, revisionId, sequence: 0 };
      for (const row of this.sortRows(rows)) {
        const entityId = await this.applyRow(row, context);
        await client.query(
          "UPDATE app.catalog_import_rows SET status = 'applied', applied_entity_id = $2 WHERE id = $1",
          [row.id, entityId],
        );
      }
      await client.query(
        `UPDATE app.catalog_import_batches
         SET status = 'applied', applied_rows = valid_rows, applied_at = clock_timestamp()
         WHERE id = $1`,
        [batchId],
      );
      await this.audit.record({
        action: "catalog.import.applied",
        actorRole: actor.role,
        actorUserId: actor.userId,
        afterState: { appliedRows: rows.length, revisionNumber },
        entityId: batchId,
        entityType: "catalog_import_batch",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return {
        appliedRows: rows.length,
        batchId,
        idempotentReplay: false,
        revisionId,
        revisionNumber,
        status: "applied",
      };
    });
  }

  async rollback(
    batchId: string,
    actor: AuthContext,
    metadata: RequestMetadata,
  ): Promise<Record<string, unknown>> {
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('an30-catalog-apply-v1', 0))");
      await client.query("SET LOCAL statement_timeout = '60s'");
      const batch = (await client.query<{ status: string }>(
        "SELECT status::text FROM app.catalog_import_batches WHERE id = $1 FOR UPDATE",
        [batchId],
      )).rows[0];
      if (!batch) throw new NotFoundException("Выгрузка не найдена");
      if (batch.status === "rolled_back") {
        return { batchId, idempotentReplay: true, status: "rolled_back" };
      }
      if (batch.status !== "applied") {
        throw new ConflictException(`Выгрузка в состоянии ${batch.status} не может быть отменена`);
      }
      const revision = (await client.query<{ id: string; revision_number: string }>(
        `SELECT id::text, revision_number::text FROM app.catalog_revisions
         WHERE batch_id = $1 FOR UPDATE`,
        [batchId],
      )).rows[0];
      if (!revision) throw new ConflictException("Ревизия выгрузки не найдена");
      const latest = (await client.query<{ id: string }>(
        `SELECT id::text FROM app.catalog_revisions
         WHERE rolled_back_at IS NULL ORDER BY revision_number DESC LIMIT 1 FOR UPDATE`,
      )).rows[0];
      if (latest?.id !== revision.id) {
        throw new ConflictException("Можно откатить только последнюю активную ревизию каталога");
      }
      const changes = (await client.query<RevisionChange>(
        `SELECT sequence_number, entity_type, entity_id::text, operation,
                before_state, after_state
         FROM app.catalog_revision_changes
         WHERE revision_id = $1 ORDER BY sequence_number DESC`,
        [revision.id],
      )).rows;
      for (const change of changes) await this.rollbackChange(change, client, batchId, actor.userId);
      await client.query(
        `UPDATE app.catalog_revisions
         SET rolled_back_at = clock_timestamp(), rolled_back_by = $2 WHERE id = $1`,
        [revision.id, actor.userId],
      );
      await client.query(
        `UPDATE app.catalog_import_batches
         SET status = 'rolled_back', rolled_back_at = clock_timestamp() WHERE id = $1`,
        [batchId],
      );
      await client.query(
        `UPDATE app.catalog_import_rows
         SET status = 'valid', applied_entity_id = NULL
         WHERE batch_id = $1 AND status = 'applied'`,
        [batchId],
      );
      await this.audit.record({
        action: "catalog.import.rolled_back",
        actorRole: actor.role,
        actorUserId: actor.userId,
        beforeState: { revisionNumber: Number(revision.revision_number) },
        entityId: batchId,
        entityType: "catalog_import_batch",
        ipAddress: metadata.ipAddress,
        metadata: { compensatedChanges: changes.length },
        userAgent: metadata.userAgent,
      }, client);
      return {
        batchId,
        compensatedChanges: changes.length,
        idempotentReplay: false,
        revisionNumber: Number(revision.revision_number),
        status: "rolled_back",
      };
    });
  }

  private sortRows(rows: ApplyRow[]): ApplyRow[] {
    const rank: Record<string, number> = {
      brand: 0, warehouse: 1, category: 2, product: 3, price: 4, stock: 5,
    };
    const categories = new Map(rows
      .filter((row) => row.normalized_payload.entityType === "category")
      .map((row) => {
        const payload = row.normalized_payload;
        return [payload.entityType === "category" ? payload.externalId : "", payload] as const;
      }));
    const depth = (row: ApplyRow): number => {
      const payload = row.normalized_payload;
      if (payload.entityType !== "category") return 0;
      let parent = payload.parentExternalId;
      let value = 0;
      const seen = new Set<string>();
      while (parent && categories.has(parent) && !seen.has(parent)) {
        seen.add(parent);
        value += 1;
        const next = categories.get(parent);
        parent = next?.entityType === "category" ? next.parentExternalId : null;
      }
      return value;
    };
    return [...rows].sort((left, right) => (
      (rank[left.entity_type] ?? 99) - (rank[right.entity_type] ?? 99)
      || depth(left) - depth(right)
      || left.row_number - right.row_number
    ));
  }

  private async applyRow(row: ApplyRow, context: ApplyContext): Promise<string> {
    switch (row.normalized_payload.entityType) {
      case "brand": return this.applyBrand(row, context);
      case "category": return this.applyCategory(row, context);
      case "warehouse": return this.applyWarehouse(row, context);
      case "product": return this.applyProduct(row, context);
      case "price": return this.applyPrice(row, context);
      case "stock": return this.applyStock(row, context);
    }
  }

  private async applyBrand(row: ApplyRow, context: ApplyContext): Promise<string> {
    const payload = row.normalized_payload;
    if (payload.entityType !== "brand") throw new Error("Unexpected brand payload");
    const current = (await context.client.query<{
      deleted_at: Date | null; external_id: string; id: string; is_active: boolean;
      name: string; slug: string; source_version: string;
    }>(`SELECT id, external_id, name, slug::text, is_active, source_version::text, deleted_at
        FROM app.brands WHERE external_id = $1 FOR UPDATE`, [payload.externalId])).rows[0];
    assertExpected(current?.source_version, row.expected_source_version, "Бренд");
    const before = current ? this.brandState(current) : null;
    const result = current
      ? await context.client.query(`UPDATE app.brands SET name=$2, slug=$3, is_active=$4,
            source_version=$5, deleted_at=NULL WHERE id=$1 RETURNING id, external_id, name,
            slug::text, is_active, source_version::text, deleted_at`,
          [current.id, payload.name, payload.slug, payload.isActive, payload.version])
      : await context.client.query(`INSERT INTO app.brands
            (external_id,name,slug,is_active,source_version) VALUES ($1,$2,$3,$4,$5)
            RETURNING id, external_id, name, slug::text, is_active, source_version::text, deleted_at`,
          [payload.externalId, payload.name, payload.slug, payload.isActive, payload.version]);
    const entity = result.rows[0] as QueryResultRow | undefined;
    if (!entity) throw new Error("Brand apply returned no row");
    await this.recordChange(context, "brand", String(entity.id), current ? "update" : "insert",
      before, this.brandState(entity));
    return String(entity.id);
  }

  private async applyCategory(row: ApplyRow, context: ApplyContext): Promise<string> {
    const payload = row.normalized_payload;
    if (payload.entityType !== "category") throw new Error("Unexpected category payload");
    const parentId = payload.parentExternalId
      ? (await context.client.query<{ id: string }>(
          "SELECT id FROM app.categories WHERE external_id=$1 AND deleted_at IS NULL",
          [payload.parentExternalId],
        )).rows[0]?.id
      : null;
    if (payload.parentExternalId && !parentId) throw new ConflictException("Родительская категория исчезла после preview");
    const current = (await context.client.query<QueryResultRow>(
      `SELECT id, external_id, parent_id, name, slug::text, description, sort_order,
              is_active, source_version::text, deleted_at
       FROM app.categories WHERE external_id=$1 FOR UPDATE`, [payload.externalId],
    )).rows[0];
    assertExpected(current?.source_version, row.expected_source_version, "Категория");
    const before = current ? this.categoryState(current) : null;
    const result = current
      ? await context.client.query(`UPDATE app.categories SET parent_id=$2,name=$3,slug=$4,
            description=$5,sort_order=$6,is_active=$7,source_version=$8,deleted_at=NULL
            WHERE id=$1 RETURNING id,external_id,parent_id,name,slug::text,description,
            sort_order,is_active,source_version::text,deleted_at`,
          [current.id, parentId, payload.name, payload.slug, payload.description,
            payload.sortOrder, payload.isActive, payload.version])
      : await context.client.query(`INSERT INTO app.categories
            (external_id,parent_id,name,slug,description,sort_order,is_active,source_version)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING id,external_id,parent_id,name,slug::text,description,sort_order,
            is_active,source_version::text,deleted_at`,
          [payload.externalId, parentId, payload.name, payload.slug, payload.description,
            payload.sortOrder, payload.isActive, payload.version]);
    const entity = result.rows[0] as QueryResultRow | undefined;
    if (!entity) throw new Error("Category apply returned no row");
    await this.recordChange(context, "category", String(entity.id), current ? "update" : "insert",
      before, this.categoryState(entity));
    return String(entity.id);
  }

  private async applyWarehouse(row: ApplyRow, context: ApplyContext): Promise<string> {
    const payload = row.normalized_payload;
    if (payload.entityType !== "warehouse") throw new Error("Unexpected warehouse payload");
    const current = (await context.client.query<QueryResultRow>(
      `SELECT id,external_id,code::text,name,is_active,source_version::text,deleted_at
       FROM app.warehouses WHERE external_id=$1 FOR UPDATE`, [payload.externalId],
    )).rows[0];
    assertExpected(current?.source_version, row.expected_source_version, "Склад");
    const before = current ? this.warehouseState(current) : null;
    const result = current
      ? await context.client.query(`UPDATE app.warehouses SET code=$2,name=$3,is_active=$4,
            source_version=$5,deleted_at=NULL WHERE id=$1
            RETURNING id,external_id,code::text,name,is_active,source_version::text,deleted_at`,
          [current.id, payload.code, payload.name, payload.isActive, payload.version])
      : await context.client.query(`INSERT INTO app.warehouses
            (external_id,code,name,is_active,source_version) VALUES ($1,$2,$3,$4,$5)
            RETURNING id,external_id,code::text,name,is_active,source_version::text,deleted_at`,
          [payload.externalId, payload.code, payload.name, payload.isActive, payload.version]);
    const entity = result.rows[0] as QueryResultRow | undefined;
    if (!entity) throw new Error("Warehouse apply returned no row");
    await this.recordChange(context, "warehouse", String(entity.id), current ? "update" : "insert",
      before, this.warehouseState(entity));
    return String(entity.id);
  }

  private async applyProduct(row: ApplyRow, context: ApplyContext): Promise<string> {
    const payload = row.normalized_payload;
    if (payload.entityType !== "product") throw new Error("Unexpected product payload");
    const brandId = payload.brandExternalId
      ? (await context.client.query<{ id: string }>(
          "SELECT id FROM app.brands WHERE external_id=$1 AND deleted_at IS NULL", [payload.brandExternalId],
        )).rows[0]?.id : null;
    const categoryId = payload.categoryExternalId
      ? (await context.client.query<{ id: string }>(
          "SELECT id FROM app.categories WHERE external_id=$1 AND deleted_at IS NULL", [payload.categoryExternalId],
        )).rows[0]?.id : null;
    if (payload.brandExternalId && !brandId) throw new ConflictException("Бренд исчез после preview");
    if (payload.categoryExternalId && !categoryId) throw new ConflictException("Категория исчезла после preview");
    const current = (await context.client.query<QueryResultRow>(
      `SELECT id,external_id,sku::text,name,slug::text,brand_id,category_id,description,
              attributes,search_text,is_active,source_version::text,deleted_at
       FROM app.products WHERE external_id=$1 FOR UPDATE`, [payload.externalId],
    )).rows[0];
    assertExpected(current?.source_version, row.expected_source_version, "Товар");
    const before = current ? this.productState(current) : null;
    const values = [payload.sku, payload.name, payload.slug, brandId, categoryId,
      payload.description, JSON.stringify(payload.attributes), payload.searchText,
      payload.isActive, payload.version];
    const result = current
      ? await context.client.query(`UPDATE app.products SET sku=$2,name=$3,slug=$4,brand_id=$5,
            category_id=$6,description=$7,attributes=$8::jsonb,search_text=$9,is_active=$10,
            source_version=$11,deleted_at=NULL WHERE id=$1
            RETURNING id,external_id,sku::text,name,slug::text,brand_id,category_id,
            description,attributes,search_text,is_active,source_version::text,deleted_at`,
          [current.id, ...values])
      : await context.client.query(`INSERT INTO app.products
            (external_id,sku,name,slug,brand_id,category_id,description,attributes,search_text,
             is_active,source_version)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
            RETURNING id,external_id,sku::text,name,slug::text,brand_id,category_id,
            description,attributes,search_text,is_active,source_version::text,deleted_at`,
          [payload.externalId, ...values]);
    const entity = result.rows[0] as QueryResultRow | undefined;
    if (!entity) throw new Error("Product apply returned no row");
    await this.recordChange(context, "product", String(entity.id), current ? "update" : "insert",
      before, this.productState(entity));
    return String(entity.id);
  }

  private async applyPrice(row: ApplyRow, context: ApplyContext): Promise<string> {
    const payload = row.normalized_payload;
    if (payload.entityType !== "price") throw new Error("Unexpected price payload");
    const productId = (await context.client.query<{ id: string }>(
      "SELECT id FROM app.products WHERE external_id=$1 AND deleted_at IS NULL", [payload.productExternalId],
    )).rows[0]?.id;
    if (!productId) throw new ConflictException("Товар цены исчез после preview");
    const current = (await context.client.query<QueryResultRow>(
      `SELECT id,product_id,amount_kopeks::text,currency,valid_from,valid_to,source,
              import_batch_id,source_version::text
       FROM app.product_prices WHERE product_id=$1 AND currency=$2 AND valid_to IS NULL FOR UPDATE`,
      [productId, payload.currency],
    )).rows[0];
    assertExpected(current?.source_version, row.expected_source_version, "Цена");
    const effectiveAt = new Date();
    if (current) {
      const before = this.priceState(current);
      const closed = (await context.client.query<QueryResultRow>(
        `UPDATE app.product_prices SET valid_to=$2 WHERE id=$1
         RETURNING id,product_id,amount_kopeks::text,currency,valid_from,valid_to,source,
                   import_batch_id,source_version::text`,
        [current.id, effectiveAt],
      )).rows[0];
      if (!closed) throw new Error("Current price closing returned no row");
      await this.recordChange(context, "product_price", String(current.id), "update",
        before, this.priceState(closed));
    }
    const inserted = (await context.client.query<QueryResultRow>(
      `INSERT INTO app.product_prices
         (product_id,amount_kopeks,currency,valid_from,source,import_batch_id,source_version)
       VALUES ($1,$2,$3,$4,'1c',$5,$6)
       RETURNING id,product_id,amount_kopeks::text,currency,valid_from,valid_to,source,
                 import_batch_id,source_version::text`,
      [productId, payload.amountKopeks, payload.currency, effectiveAt, context.batchId, payload.version],
    )).rows[0];
    if (!inserted) throw new Error("Price insert returned no row");
    await this.recordChange(context, "product_price", String(inserted.id), "insert", null,
      this.priceState(inserted));
    return String(inserted.id);
  }

  private async applyStock(row: ApplyRow, context: ApplyContext): Promise<string> {
    const payload = row.normalized_payload;
    if (payload.entityType !== "stock") throw new Error("Unexpected stock payload");
    const productId = (await context.client.query<{ id: string }>(
      "SELECT id FROM app.products WHERE external_id=$1 AND deleted_at IS NULL", [payload.productExternalId],
    )).rows[0]?.id;
    const warehouseId = (await context.client.query<{ id: string }>(
      "SELECT id FROM app.warehouses WHERE external_id=$1 AND deleted_at IS NULL", [payload.warehouseExternalId],
    )).rows[0]?.id;
    if (!productId || !warehouseId) throw new ConflictException("Товар или склад остатка исчез после preview");
    const current = (await context.client.query<QueryResultRow>(
      `SELECT product_id,warehouse_id,quantity_on_hand,quantity_reserved,source_version::text
       FROM app.inventory_balances WHERE product_id=$1 AND warehouse_id=$2 FOR UPDATE`,
      [productId, warehouseId],
    )).rows[0];
    assertExpected(current?.source_version, row.expected_source_version, "Остаток");
    if (current && payload.quantityOnHand < Number(current.quantity_reserved)) {
      throw new ConflictException("Остаток стал меньше резерва после preview");
    }
    const before = current ? this.stockState(current) : null;
    const result = current
      ? await context.client.query<QueryResultRow>(
          `UPDATE app.inventory_balances SET quantity_on_hand=$3,source_version=$4
           WHERE product_id=$1 AND warehouse_id=$2
           RETURNING product_id,warehouse_id,quantity_on_hand,quantity_reserved,source_version::text`,
          [productId, warehouseId, payload.quantityOnHand, payload.version],
        )
      : await context.client.query<QueryResultRow>(
          `INSERT INTO app.inventory_balances
             (product_id,warehouse_id,quantity_on_hand,quantity_reserved,source_version)
           VALUES ($1,$2,$3,0,$4)
           RETURNING product_id,warehouse_id,quantity_on_hand,quantity_reserved,source_version::text`,
          [productId, warehouseId, payload.quantityOnHand, payload.version],
        );
    const entity = result.rows[0];
    if (!entity) throw new Error("Stock apply returned no row");
    const after = this.stockState(entity);
    const delta = Number(after.quantityOnHand) - Number(before?.quantityOnHand ?? 0);
    if (delta !== 0) {
      await context.client.query(
        `INSERT INTO app.inventory_events (
           product_id,warehouse_id,event_type,delta_on_hand,delta_reserved,
           resulting_on_hand,resulting_reserved,reference_type,reference_id,
           import_batch_id
         ) VALUES ($1,$2,'import_set',$3,0,$4,$5,'catalog_import_batch',$6,$7)`,
        [productId, warehouseId, delta, after.quantityOnHand, after.quantityReserved,
          context.batchId, context.batchId],
      );
    }
    const entityId = await this.balanceEntityId(context.client, productId, warehouseId);
    await this.recordChange(context, "inventory_balance", entityId, current ? "update" : "insert",
      before, after);
    return productId;
  }

  private async recordChange(
    context: ApplyContext,
    entityType: string,
    entityId: string,
    operation: "insert" | "update",
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    context.sequence += 1;
    await context.client.query(
      `INSERT INTO app.catalog_revision_changes (
         revision_id,sequence_number,entity_type,entity_id,operation,before_state,after_state
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [context.revisionId, context.sequence, entityType, entityId, operation,
        before ? JSON.stringify(before) : null, JSON.stringify(after)],
    );
  }

  private async rollbackChange(
    change: RevisionChange,
    client: PoolClient,
    batchId: string,
    actorUserId: string,
  ): Promise<void> {
    const before = change.before_state;
    const after = change.after_state;
    if (!after) throw new ConflictException("Журнал ревизии повреждён: отсутствует after_state");
    switch (change.entity_type) {
      case "brand": await this.rollbackBrand(change, client); return;
      case "category": await this.rollbackCategory(change, client); return;
      case "warehouse": await this.rollbackWarehouse(change, client); return;
      case "product": await this.rollbackProduct(change, client); return;
      case "product_price": await this.rollbackPrice(change, client); return;
      case "inventory_balance": {
        const productId = String(after.productId);
        const warehouseId = String(after.warehouseId);
        const current = (await client.query<QueryResultRow>(
          `SELECT product_id,warehouse_id,quantity_on_hand,quantity_reserved,source_version::text
           FROM app.inventory_balances WHERE product_id=$1 AND warehouse_id=$2 FOR UPDATE`,
          [productId, warehouseId],
        )).rows[0];
        if (!current
          || Number(current.quantity_on_hand) !== Number(after.quantityOnHand)
          || Number(current.quantity_reserved) !== Number(after.quantityReserved)
          || version(current.source_version) !== Number(after.sourceVersion)) {
          throw new ConflictException("Остаток изменён после импорта; автоматический откат остановлен");
        }
        if (change.operation === "insert") {
          if (Number(current.quantity_reserved) !== 0) {
            throw new ConflictException("Новый остаток уже зарезервирован; откат остановлен");
          }
          await client.query("DELETE FROM app.inventory_balances WHERE product_id=$1 AND warehouse_id=$2",
            [productId, warehouseId]);
          if (Number(current.quantity_on_hand) !== 0) {
            await client.query(
              `INSERT INTO app.inventory_events (
                 product_id,warehouse_id,event_type,delta_on_hand,delta_reserved,
                 resulting_on_hand,resulting_reserved,reference_type,reference_id,
                 import_batch_id,actor_user_id
               ) VALUES ($1,$2,'import_rollback',$3,0,0,0,'catalog_import_batch',$4,$5,$6)`,
              [productId, warehouseId, -Number(current.quantity_on_hand), batchId, batchId, actorUserId],
            );
          }
        } else {
          if (!before) throw new ConflictException("Журнал остатка не содержит before_state");
          if (Number(before.quantityOnHand) < Number(current.quantity_reserved)) {
            throw new ConflictException("Резерв превышает восстанавливаемый остаток; откат остановлен");
          }
          await client.query(
            `UPDATE app.inventory_balances SET quantity_on_hand=$3,quantity_reserved=$4,source_version=$5
             WHERE product_id=$1 AND warehouse_id=$2`,
            [productId, warehouseId, before.quantityOnHand, before.quantityReserved, before.sourceVersion],
          );
          const delta = Number(before.quantityOnHand) - Number(after.quantityOnHand);
          if (delta !== 0) {
            await client.query(
              `INSERT INTO app.inventory_events (
                 product_id,warehouse_id,event_type,delta_on_hand,delta_reserved,
                 resulting_on_hand,resulting_reserved,reference_type,reference_id,
                 import_batch_id,actor_user_id
               ) VALUES ($1,$2,'import_rollback',$3,0,$4,$5,'catalog_import_batch',$6,$7,$8)`,
              [productId, warehouseId, delta, before.quantityOnHand, before.quantityReserved,
                batchId, batchId, actorUserId],
            );
          }
        }
        return;
      }
      default: throw new ConflictException(`Неизвестный тип изменения ${change.entity_type}`);
    }
  }

  private async rollbackBrand(change: RevisionChange, client: PoolClient): Promise<void> {
    const after = change.after_state!;
    if (change.operation === "insert") {
      const result = await client.query(`UPDATE app.brands
        SET is_active=false,source_version=0,deleted_at=clock_timestamp()
        WHERE id=$1 AND source_version=$2`,
        [change.entity_id, after.sourceVersion]);
      if (result.rowCount !== 1) throw new ConflictException("Бренд изменён после импорта");
      return;
    }
    const before = change.before_state!;
    const result = await client.query(`UPDATE app.brands SET external_id=$2,name=$3,slug=$4,is_active=$5,
      source_version=$6,deleted_at=$7 WHERE id=$1 AND source_version=$8`,
    [change.entity_id, before.externalId, before.name, before.slug, before.isActive,
      before.sourceVersion, before.deletedAt, after.sourceVersion]);
    if (result.rowCount !== 1) throw new ConflictException("Бренд изменён после импорта");
  }

  private async rollbackCategory(change: RevisionChange, client: PoolClient): Promise<void> {
    const after = change.after_state!;
    if (change.operation === "insert") {
      const result = await client.query(`UPDATE app.categories
        SET is_active=false,source_version=0,deleted_at=clock_timestamp()
        WHERE id=$1 AND source_version=$2`,
        [change.entity_id, after.sourceVersion]);
      if (result.rowCount !== 1) throw new ConflictException("Категория изменена после импорта");
      return;
    }
    const before = change.before_state!;
    const result = await client.query(`UPDATE app.categories SET external_id=$2,parent_id=$3,name=$4,
      slug=$5,description=$6,sort_order=$7,is_active=$8,source_version=$9,deleted_at=$10
      WHERE id=$1 AND source_version=$11`,
    [change.entity_id,before.externalId,before.parentId,before.name,before.slug,before.description,
      before.sortOrder,before.isActive,before.sourceVersion,before.deletedAt,after.sourceVersion]);
    if (result.rowCount !== 1) throw new ConflictException("Категория изменена после импорта");
  }

  private async rollbackWarehouse(change: RevisionChange, client: PoolClient): Promise<void> {
    const after = change.after_state!;
    if (change.operation === "insert") {
      const result = await client.query(`UPDATE app.warehouses
        SET is_active=false,source_version=0,deleted_at=clock_timestamp()
        WHERE id=$1 AND source_version=$2`,
        [change.entity_id, after.sourceVersion]);
      if (result.rowCount !== 1) throw new ConflictException("Склад изменён после импорта");
      return;
    }
    const before = change.before_state!;
    const result = await client.query(`UPDATE app.warehouses SET external_id=$2,code=$3,name=$4,
      is_active=$5,source_version=$6,deleted_at=$7 WHERE id=$1 AND source_version=$8`,
    [change.entity_id,before.externalId,before.code,before.name,before.isActive,
      before.sourceVersion,before.deletedAt,after.sourceVersion]);
    if (result.rowCount !== 1) throw new ConflictException("Склад изменён после импорта");
  }

  private async rollbackProduct(change: RevisionChange, client: PoolClient): Promise<void> {
    const after = change.after_state!;
    if (change.operation === "insert") {
      const result = await client.query(`UPDATE app.products
        SET is_active=false,source_version=0,deleted_at=clock_timestamp()
        WHERE id=$1 AND source_version=$2`,
        [change.entity_id, after.sourceVersion]);
      if (result.rowCount !== 1) throw new ConflictException("Товар изменён или уже используется");
      return;
    }
    const before = change.before_state!;
    const result = await client.query(`UPDATE app.products SET external_id=$2,sku=$3,name=$4,slug=$5,
      brand_id=$6,category_id=$7,description=$8,attributes=$9::jsonb,search_text=$10,
      is_active=$11,source_version=$12,deleted_at=$13 WHERE id=$1 AND source_version=$14`,
    [change.entity_id,before.externalId,before.sku,before.name,before.slug,before.brandId,
      before.categoryId,before.description,JSON.stringify(before.attributes),before.searchText,
      before.isActive,before.sourceVersion,before.deletedAt,after.sourceVersion]);
    if (result.rowCount !== 1) throw new ConflictException("Товар изменён после импорта");
  }

  private async rollbackPrice(change: RevisionChange, client: PoolClient): Promise<void> {
    const after = change.after_state!;
    if (change.operation === "insert") {
      const result = await client.query("DELETE FROM app.product_prices WHERE id=$1 AND source_version=$2",
        [change.entity_id, after.sourceVersion]);
      if (result.rowCount !== 1) throw new ConflictException("Цена изменена после импорта");
      return;
    }
    const before = change.before_state!;
    const result = await client.query(
      `UPDATE app.product_prices SET valid_to=$2 WHERE id=$1 AND source_version=$3
       AND valid_to IS NOT DISTINCT FROM $4::timestamptz`,
      [change.entity_id, before.validTo, after.sourceVersion, after.validTo],
    );
    if (result.rowCount !== 1) throw new ConflictException("История цены изменена после импорта");
  }

  private brandState(row: QueryResultRow): Record<string, unknown> {
    return { deletedAt: iso(row.deleted_at as Date | null), externalId: row.external_id,
      isActive: row.is_active, name: row.name, slug: row.slug,
      sourceVersion: version(row.source_version as string) };
  }

  private categoryState(row: QueryResultRow): Record<string, unknown> {
    return { deletedAt: iso(row.deleted_at as Date | null), description: row.description,
      externalId: row.external_id, isActive: row.is_active, name: row.name,
      parentId: row.parent_id, slug: row.slug, sortOrder: row.sort_order,
      sourceVersion: version(row.source_version as string) };
  }

  private warehouseState(row: QueryResultRow): Record<string, unknown> {
    return { code: row.code, deletedAt: iso(row.deleted_at as Date | null), externalId: row.external_id,
      isActive: row.is_active, name: row.name, sourceVersion: version(row.source_version as string) };
  }

  private productState(row: QueryResultRow): Record<string, unknown> {
    return { attributes: row.attributes, brandId: row.brand_id, categoryId: row.category_id,
      deletedAt: iso(row.deleted_at as Date | null), description: row.description,
      externalId: row.external_id, isActive: row.is_active, name: row.name,
      searchText: row.search_text, sku: row.sku, slug: row.slug,
      sourceVersion: version(row.source_version as string) };
  }

  private priceState(row: QueryResultRow): Record<string, unknown> {
    return { amountKopeks: row.amount_kopeks, currency: row.currency, id: row.id,
      importBatchId: row.import_batch_id, productId: row.product_id, source: row.source,
      sourceVersion: version(row.source_version as string), validFrom: iso(row.valid_from as Date),
      validTo: iso(row.valid_to as Date | null) };
  }

  private stockState(row: QueryResultRow): Record<string, unknown> {
    return { productId: row.product_id, quantityOnHand: Number(row.quantity_on_hand),
      quantityReserved: Number(row.quantity_reserved), sourceVersion: version(row.source_version as string),
      warehouseId: row.warehouse_id };
  }

  private async balanceEntityId(client: PoolClient, productId: string, warehouseId: string): Promise<string> {
    return (await client.query<{ id: string }>(
      "SELECT md5($1::text || ':' || $2::text)::uuid::text AS id",
      [productId, warehouseId],
    )).rows[0]!.id;
  }
}
