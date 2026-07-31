import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  CATALOG_IMPORT_ENTITY_TYPES,
  OneCCatalogRowSchema,
  type CatalogImportEntityType,
  type OneCCatalogRow,
} from "@an30/contracts";

import { DatabaseService } from "../infrastructure/database.service.js";
import { canonicalJson, rowExternalId, rowIdentity, sha256 } from "./catalog-import.utils.js";

const EnvelopeShellSchema = z.object({
  exportedAt: z.iso.datetime({ offset: true }),
  externalBatchId: z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001F\u007F]+$/u),
  rows: z.array(z.unknown()).min(1).max(5_000),
  schemaVersion: z.literal(1),
}).strict();

const ImportListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum([
    "uploaded", "validating", "validated", "applying", "applied", "failed", "rolled_back",
  ]).optional(),
});

const PreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "valid", "invalid", "applied", "skipped"]).optional(),
});

interface ValidationIssue {
  code: string;
  message: string;
}

interface Decision {
  changeKind?: "insert" | "noop" | "update";
  entityType: CatalogImportEntityType | "unknown";
  errors: ValidationIssue[];
  expectedSourceVersion?: number;
  externalId?: string;
  normalized?: OneCCatalogRow;
  raw: unknown;
  rowNumber: number;
}

interface CurrentEntity {
  data: Record<string, unknown>;
  deleted: boolean;
  id: string;
  version: number;
}

interface CurrentStock extends CurrentEntity {
  reserved: number;
}

interface CurrentCatalog {
  brands: Map<string, CurrentEntity>;
  categories: Map<string, CurrentEntity>;
  categoryParents: Map<string, string | null>;
  prices: Map<string, CurrentEntity>;
  products: Map<string, CurrentEntity>;
  stocks: Map<string, CurrentStock>;
  uniqueOwners: Map<string, string>;
  warehouses: Map<string, CurrentEntity>;
}

interface BatchRow {
  applied_at: Date | null;
  applied_rows: number;
  error_summary: Record<string, unknown> | null;
  external_batch_id: string;
  id: string;
  invalid_rows: number;
  payload_checksum: Buffer;
  rolled_back_at: Date | null;
  skipped_rows: number;
  status: string;
  total_rows: number;
  uploaded_at: Date;
  valid_rows: number;
  validated_at: Date | null;
  validation_report: Record<string, unknown>;
}

function numberVersion(value: string | number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.MAX_SAFE_INTEGER;
}

function currentDataMatches(row: OneCCatalogRow, current: CurrentEntity): boolean {
  return !current.deleted && canonicalJson(row) === canonicalJson(current.data);
}

function duplicateValues(values: Array<{ key: string; row: Decision }>): void {
  const grouped = new Map<string, Decision[]>();
  for (const { key, row } of values) {
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  for (const rows of grouped.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      row.errors.push({ code: "duplicate_unique_value", message: "Значение повторяется внутри выгрузки" });
    }
  }
}

@Injectable()
export class CatalogImportService {
  constructor(private readonly database: DatabaseService) {}

  async upload(rawInput: unknown): Promise<Record<string, unknown>> {
    const parsedEnvelope = EnvelopeShellSchema.safeParse(rawInput);
    if (!parsedEnvelope.success) {
      throw new BadRequestException({
        code: "invalid_import_envelope",
        errors: parsedEnvelope.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join("."),
        })),
      });
    }
    const envelope = parsedEnvelope.data;
    const checksum = sha256(envelope);

    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('an30-1c-upload-v1', 0))");
      const byExternalId = (await client.query<BatchRow>(
        `SELECT * FROM app.catalog_import_batches
         WHERE source = '1c' AND external_batch_id = $1 FOR UPDATE`,
        [envelope.externalBatchId],
      )).rows[0];
      if (byExternalId) {
        if (!byExternalId.payload_checksum.equals(checksum)) {
          throw new ConflictException("externalBatchId уже использован для другой выгрузки");
        }
        return { ...this.batchSummary(byExternalId), idempotentReplay: true };
      }
      const byChecksum = (await client.query<BatchRow>(
        `SELECT * FROM app.catalog_import_batches
         WHERE source = '1c' AND payload_checksum = $1 FOR UPDATE`,
        [checksum],
      )).rows[0];
      if (byChecksum) {
        return { ...this.batchSummary(byChecksum), idempotentReplay: true };
      }

      const created = await client.query<{ id: string }>(
        `INSERT INTO app.catalog_import_batches (
           source, external_batch_id, payload_checksum, status
         ) VALUES ('1c', $1, $2, 'validating') RETURNING id`,
        [envelope.externalBatchId, checksum],
      );
      const batchId = created.rows[0]?.id;
      if (!batchId) throw new Error("Import batch did not return an identifier");

      const decisions = envelope.rows.map((raw, index) => this.parseRow(raw, index + 1));
      await this.validateRows(client, decisions);
      for (const decision of decisions) {
        const status = decision.errors.length > 0
          ? "invalid"
          : decision.changeKind === "noop" ? "skipped" : "valid";
        await client.query(
          `INSERT INTO app.catalog_import_rows (
             batch_id, row_number, entity_type, external_id, payload, payload_checksum,
             status, validation_errors, normalized_payload, change_kind, expected_source_version
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
          [
            batchId,
            decision.rowNumber,
            decision.entityType,
            decision.externalId ?? null,
            JSON.stringify(decision.raw && typeof decision.raw === "object" ? decision.raw : { value: decision.raw }),
            sha256(decision.raw),
            status,
            decision.errors.length > 0 ? JSON.stringify(decision.errors) : null,
            decision.normalized ? JSON.stringify(decision.normalized) : null,
            decision.changeKind ?? null,
            decision.expectedSourceVersion ?? null,
          ],
        );
        for (const issue of decision.errors) {
          await client.query(
            `INSERT INTO app.catalog_import_conflicts (
               batch_id, entity_type, external_id, conflict_code, incoming_value
             ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [batchId, decision.entityType, decision.externalId ?? null, issue.code,
              JSON.stringify(decision.raw && typeof decision.raw === "object" ? decision.raw : { value: decision.raw })],
          );
        }
      }

      const counts = decisions.reduce(
        (value, decision) => {
          if (decision.errors.length > 0) value.invalid += 1;
          else if (decision.changeKind === "noop") value.skipped += 1;
          else value.valid += 1;
          value.entities[decision.entityType] = (value.entities[decision.entityType] ?? 0) + 1;
          for (const error of decision.errors) {
            value.conflicts[error.code] = (value.conflicts[error.code] ?? 0) + 1;
          }
          return value;
        },
        {
          conflicts: {} as Record<string, number>,
          entities: {} as Record<string, number>,
          invalid: 0,
          skipped: 0,
          valid: 0,
        },
      );
      const report = {
        conflicts: counts.conflicts,
        entities: counts.entities,
        exportedAt: envelope.exportedAt,
        schemaVersion: envelope.schemaVersion,
      };
      const updated = await client.query<BatchRow>(
        `UPDATE app.catalog_import_batches
         SET status = 'validated', total_rows = $2, valid_rows = $3,
             invalid_rows = $4, skipped_rows = $5, validation_report = $6::jsonb,
             error_summary = CASE WHEN $4::integer > 0 THEN $7::jsonb ELSE NULL END,
             validated_at = clock_timestamp()
         WHERE id = $1 RETURNING *`,
        [batchId, decisions.length, counts.valid, counts.invalid, counts.skipped,
          JSON.stringify(report), JSON.stringify({ conflicts: counts.conflicts })],
      );
      const batch = updated.rows[0];
      if (!batch) throw new Error("Validated import batch was not found");
      return { ...this.batchSummary(batch), idempotentReplay: false };
    });
  }

  async list(rawQuery: unknown): Promise<Record<string, unknown>> {
    const parsedQuery = ImportListQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) throw new BadRequestException("Некорректные параметры списка");
    const query = parsedQuery.data;
    const result = await this.database.query<BatchRow>(
      `SELECT * FROM app.catalog_import_batches
       WHERE ($1::app.import_status IS NULL OR status = $1)
       ORDER BY uploaded_at DESC LIMIT $2 OFFSET $3`,
      [query.status ?? null, query.limit, query.offset],
    );
    const count = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.catalog_import_batches
       WHERE ($1::app.import_status IS NULL OR status = $1)`,
      [query.status ?? null],
    );
    return {
      items: result.rows.map((batch) => this.batchSummary(batch)),
      limit: query.limit,
      offset: query.offset,
      total: Number(count.rows[0]?.count ?? 0),
    };
  }

  async preview(batchId: string, rawQuery: unknown): Promise<Record<string, unknown>> {
    const parsedQuery = PreviewQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) throw new BadRequestException("Некорректные параметры preview");
    const query = parsedQuery.data;
    const batch = (await this.database.query<BatchRow>(
      "SELECT * FROM app.catalog_import_batches WHERE id = $1",
      [batchId],
    )).rows[0];
    if (!batch) throw new NotFoundException("Выгрузка не найдена");
    const rows = await this.database.query<{
      change_kind: string | null;
      entity_type: string;
      external_id: string | null;
      normalized_payload: Record<string, unknown> | null;
      row_number: number;
      status: string;
      validation_errors: ValidationIssue[] | null;
    }>(
      `SELECT row_number, entity_type, external_id, status, change_kind,
              normalized_payload, validation_errors
       FROM app.catalog_import_rows
       WHERE batch_id = $1 AND ($2::app.import_row_status IS NULL OR status = $2)
       ORDER BY row_number LIMIT $3 OFFSET $4`,
      [batchId, query.status ?? null, query.limit, query.offset],
    );
    const conflicts = await this.database.query<{
      conflict_code: string;
      count: string;
    }>(
      `SELECT conflict_code, count(*)::text AS count
       FROM app.catalog_import_conflicts WHERE batch_id = $1
       GROUP BY conflict_code ORDER BY conflict_code`,
      [batchId],
    );
    return {
      ...this.batchSummary(batch),
      conflicts: Object.fromEntries(conflicts.rows.map((row) => [row.conflict_code, Number(row.count)])),
      page: { limit: query.limit, offset: query.offset, rows: rows.rows },
    };
  }

  private parseRow(raw: unknown, rowNumber: number): Decision {
    const parsed = OneCCatalogRowSchema.safeParse(raw);
    if (parsed.success) {
      return {
        entityType: parsed.data.entityType,
        errors: [],
        externalId: rowExternalId(parsed.data),
        normalized: parsed.data,
        raw,
        rowNumber,
      };
    }
    const candidate = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const candidateType = typeof candidate.entityType === "string"
      && CATALOG_IMPORT_ENTITY_TYPES.includes(candidate.entityType as CatalogImportEntityType)
      ? candidate.entityType as CatalogImportEntityType
      : "unknown";
    return {
      entityType: candidateType,
      errors: parsed.error.issues.map((issue) => ({
        code: `schema.${issue.code}`,
        message: `${issue.path.join(".") || "row"}: ${issue.message}`,
      })),
      externalId: typeof candidate.externalId === "string" ? candidate.externalId.slice(0, 128) : undefined,
      raw,
      rowNumber,
    };
  }

  private async validateRows(client: PoolClient, decisions: Decision[]): Promise<void> {
    const validRows = decisions.filter((decision): decision is Decision & { normalized: OneCCatalogRow } => (
      Boolean(decision.normalized)
    ));
    const current = await this.loadCurrentCatalog(client, validRows.map(({ normalized }) => normalized));
    const duplicateIdentities = new Map<string, Decision[]>();
    for (const decision of validRows) {
      const identity = rowIdentity(decision.normalized);
      const group = duplicateIdentities.get(identity) ?? [];
      group.push(decision);
      duplicateIdentities.set(identity, group);
    }
    for (const group of duplicateIdentities.values()) {
      if (group.length < 2) continue;
      for (const decision of group) {
        decision.errors.push({ code: "duplicate_entity", message: "Сущность повторяется внутри выгрузки" });
      }
    }

    duplicateValues(validRows.flatMap((decision) => {
      const row = decision.normalized;
      switch (row.entityType) {
        case "brand": return [{ key: `brand:slug:${row.slug}`, row: decision }];
        case "category": return [{ key: `category:slug:${row.slug}`, row: decision }];
        case "warehouse": return [{ key: `warehouse:code:${row.code.toLowerCase()}`, row: decision }];
        case "product": return [
          { key: `product:slug:${row.slug}`, row: decision },
          { key: `product:sku:${row.sku.toLowerCase()}`, row: decision },
        ];
        default: return [];
      }
    }));

    for (const decision of validRows) {
      const row = decision.normalized;
      const uniqueKeys = this.uniqueKeys(row);
      for (const key of uniqueKeys) {
        const owner = current.uniqueOwners.get(key);
        const externalId = "externalId" in row ? row.externalId : undefined;
        if (owner && owner !== externalId) {
          decision.errors.push({ code: "unique_value_owned", message: "Slug, SKU или код уже занят другой сущностью" });
        }
      }
      const existing = this.currentFor(row, current);
      if (!existing) {
        decision.changeKind = "insert";
      } else if (row.version < existing.version) {
        decision.errors.push({ code: "stale_version", message: "Версия выгрузки старее текущей" });
      } else if (row.version === existing.version) {
        if (currentDataMatches(row, existing)) decision.changeKind = "noop";
        else decision.errors.push({
          code: "version_reused_with_different_payload",
          message: "Та же версия содержит другие данные",
        });
      } else {
        decision.changeKind = "update";
        decision.expectedSourceVersion = existing.version;
      }
      if (row.entityType === "stock" && existing && row.quantityOnHand < (existing as CurrentStock).reserved) {
        decision.errors.push({
          code: "stock_below_reserved",
          message: "Остаток меньше уже зарезервированного количества",
        });
      }
    }

    this.validateDependencies(validRows, current);
  }

  private validateDependencies(
    decisions: Array<Decision & { normalized: OneCCatalogRow }>,
    current: CurrentCatalog,
  ): void {
    const usable = (type: CatalogImportEntityType) => new Set(
      decisions
        .filter((decision) => decision.normalized.entityType === type && decision.errors.length === 0)
        .map((decision) => "externalId" in decision.normalized
          ? decision.normalized.externalId
          : "productExternalId" in decision.normalized ? decision.normalized.productExternalId : ""),
    );
    const brands = new Set([
      ...[...current.brands.entries()].filter(([, value]) => !value.deleted).map(([key]) => key),
      ...usable("brand"),
    ]);
    const warehouses = new Set([
      ...[...current.warehouses.entries()].filter(([, value]) => !value.deleted).map(([key]) => key),
      ...usable("warehouse"),
    ]);

    const categoryDecisions = decisions.filter((decision) => decision.normalized.entityType === "category");
    const incomingParents = new Map(current.categoryParents);
    for (const decision of categoryDecisions) {
      if (decision.errors.length === 0 && decision.normalized.entityType === "category") {
        incomingParents.set(decision.normalized.externalId, decision.normalized.parentExternalId);
      }
    }
    for (const decision of categoryDecisions) {
      const row = decision.normalized;
      if (row.entityType !== "category" || decision.errors.length > 0) continue;
      if (row.parentExternalId && !incomingParents.has(row.parentExternalId)) {
        decision.errors.push({ code: "missing_parent_category", message: "Родительская категория не найдена" });
        continue;
      }
      const seen = new Set<string>();
      let cursor: string | null = row.externalId;
      while (cursor) {
        if (seen.has(cursor)) {
          decision.errors.push({ code: "category_cycle", message: "Обнаружен цикл категорий" });
          break;
        }
        seen.add(cursor);
        cursor = incomingParents.get(cursor) ?? null;
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      const invalidCategories = new Set(categoryDecisions
        .filter((decision) => decision.errors.length > 0 && decision.normalized.entityType === "category")
        .map((decision) => decision.normalized.entityType === "category" ? decision.normalized.externalId : ""));
      for (const decision of categoryDecisions) {
        const row = decision.normalized;
        if (
          row.entityType === "category"
          && decision.errors.length === 0
          && row.parentExternalId
          && invalidCategories.has(row.parentExternalId)
          && !current.categories.has(row.parentExternalId)
        ) {
          decision.errors.push({ code: "invalid_parent_category", message: "Родительская категория не прошла валидацию" });
          changed = true;
        }
      }
    }
    const categories = new Set([
      ...[...current.categories.entries()].filter(([, value]) => !value.deleted).map(([key]) => key),
      ...categoryDecisions
        .filter((decision) => decision.errors.length === 0 && decision.normalized.entityType === "category")
        .map((decision) => decision.normalized.entityType === "category" ? decision.normalized.externalId : ""),
    ]);

    for (const decision of decisions) {
      const row = decision.normalized;
      if (row.entityType !== "product" || decision.errors.length > 0) continue;
      if (row.brandExternalId && !brands.has(row.brandExternalId)) {
        decision.errors.push({ code: "missing_brand", message: "Бренд товара не найден" });
      }
      if (row.categoryExternalId && !categories.has(row.categoryExternalId)) {
        decision.errors.push({ code: "missing_category", message: "Категория товара не найдена" });
      }
    }
    const products = new Set([
      ...[...current.products.entries()].filter(([, value]) => !value.deleted).map(([key]) => key),
      ...decisions
        .filter((decision) => decision.errors.length === 0 && decision.normalized.entityType === "product")
        .map((decision) => decision.normalized.entityType === "product" ? decision.normalized.externalId : ""),
    ]);
    for (const decision of decisions) {
      const row = decision.normalized;
      if (decision.errors.length > 0) continue;
      if ((row.entityType === "price" || row.entityType === "stock") && !products.has(row.productExternalId)) {
        decision.errors.push({ code: "missing_product", message: "Товар не найден" });
      }
      if (row.entityType === "stock" && !warehouses.has(row.warehouseExternalId)) {
        decision.errors.push({ code: "missing_warehouse", message: "Склад не найден" });
      }
    }
  }

  private async loadCurrentCatalog(client: PoolClient, rows: OneCCatalogRow[]): Promise<CurrentCatalog> {
    const ids = {
      brands: new Set<string>(), categories: new Set<string>(), products: new Set<string>(),
      warehouses: new Set<string>(),
    };
    const slugs = { brands: new Set<string>(), categories: new Set<string>(), products: new Set<string>() };
    const productSkus = new Set<string>();
    const warehouseCodes = new Set<string>();
    for (const row of rows) {
      if (row.entityType === "brand") { ids.brands.add(row.externalId); slugs.brands.add(row.slug); }
      if (row.entityType === "category") {
        ids.categories.add(row.externalId); slugs.categories.add(row.slug);
        if (row.parentExternalId) ids.categories.add(row.parentExternalId);
      }
      if (row.entityType === "warehouse") {
        ids.warehouses.add(row.externalId); warehouseCodes.add(row.code);
      }
      if (row.entityType === "product") {
        ids.products.add(row.externalId); slugs.products.add(row.slug); productSkus.add(row.sku);
        if (row.brandExternalId) ids.brands.add(row.brandExternalId);
        if (row.categoryExternalId) ids.categories.add(row.categoryExternalId);
      }
      if (row.entityType === "price" || row.entityType === "stock") ids.products.add(row.productExternalId);
      if (row.entityType === "stock") ids.warehouses.add(row.warehouseExternalId);
    }

    const brands = new Map<string, CurrentEntity>();
    for (const row of (await client.query<{
      deleted_at: Date | null; external_id: string; id: string; is_active: boolean;
      name: string; slug: string; source_version: string;
    }>(`SELECT id, external_id, name, slug::text, is_active, source_version::text, deleted_at
        FROM app.brands WHERE external_id = ANY($1::text[])`, [[...ids.brands]])).rows) {
      brands.set(row.external_id, {
        data: { entityType: "brand", externalId: row.external_id, isActive: row.is_active,
          name: row.name, slug: row.slug, version: numberVersion(row.source_version) },
        deleted: Boolean(row.deleted_at), id: row.id, version: numberVersion(row.source_version),
      });
    }

    const categoryParents = new Map<string, string | null>();
    const categories = new Map<string, CurrentEntity>();
    for (const row of (await client.query<{
      deleted_at: Date | null; description: string | null; external_id: string; id: string;
      is_active: boolean; name: string; parent_external_id: string | null; slug: string;
      sort_order: number; source_version: string;
    }>(`SELECT category.id, category.external_id, category.name, category.slug::text,
               category.description, category.sort_order, category.is_active,
               category.source_version::text, category.deleted_at,
               parent.external_id AS parent_external_id
        FROM app.categories AS category
        LEFT JOIN app.categories AS parent ON parent.id = category.parent_id`, [])).rows) {
      if (!row.deleted_at) categoryParents.set(row.external_id, row.parent_external_id);
      if (!ids.categories.has(row.external_id)) continue;
      categories.set(row.external_id, {
        data: { description: row.description, entityType: "category", externalId: row.external_id,
          isActive: row.is_active, name: row.name, parentExternalId: row.parent_external_id,
          slug: row.slug, sortOrder: row.sort_order, version: numberVersion(row.source_version) },
        deleted: Boolean(row.deleted_at), id: row.id, version: numberVersion(row.source_version),
      });
    }

    const warehouses = new Map<string, CurrentEntity>();
    for (const row of (await client.query<{
      code: string; deleted_at: Date | null; external_id: string; id: string; is_active: boolean;
      name: string; source_version: string;
    }>(`SELECT id, external_id, code::text, name, is_active, source_version::text, deleted_at
        FROM app.warehouses WHERE external_id = ANY($1::text[])`, [[...ids.warehouses]])).rows) {
      warehouses.set(row.external_id, {
        data: { code: row.code, entityType: "warehouse", externalId: row.external_id,
          isActive: row.is_active, name: row.name, version: numberVersion(row.source_version) },
        deleted: Boolean(row.deleted_at), id: row.id, version: numberVersion(row.source_version),
      });
    }

    const products = new Map<string, CurrentEntity>();
    for (const row of (await client.query<{
      attributes: Record<string, unknown>; brand_external_id: string | null;
      category_external_id: string | null; deleted_at: Date | null; description: string | null;
      external_id: string; id: string; is_active: boolean; name: string; search_text: string | null;
      sku: string; slug: string; source_version: string;
    }>(`SELECT product.id, product.external_id, product.sku::text, product.name,
               product.slug::text, product.description, product.attributes, product.search_text,
               product.is_active, product.source_version::text, product.deleted_at,
               brand.external_id AS brand_external_id,
               category.external_id AS category_external_id
        FROM app.products AS product
        LEFT JOIN app.brands AS brand ON brand.id = product.brand_id
        LEFT JOIN app.categories AS category ON category.id = product.category_id
        WHERE product.external_id = ANY($1::text[])`, [[...ids.products]])).rows) {
      products.set(row.external_id, {
        data: { attributes: row.attributes, brandExternalId: row.brand_external_id,
          categoryExternalId: row.category_external_id, description: row.description,
          entityType: "product", externalId: row.external_id, isActive: row.is_active,
          name: row.name, searchText: row.search_text, sku: row.sku, slug: row.slug,
          version: numberVersion(row.source_version) },
        deleted: Boolean(row.deleted_at), id: row.id, version: numberVersion(row.source_version),
      });
    }

    const prices = new Map<string, CurrentEntity>();
    for (const row of (await client.query<{
      amount_kopeks: string; currency: string; id: string; product_external_id: string;
      source_version: string;
    }>(`SELECT price.id, product.external_id AS product_external_id,
               price.amount_kopeks::text, price.currency, price.source_version::text
        FROM app.product_prices AS price
        JOIN app.products AS product ON product.id = price.product_id
        WHERE product.external_id = ANY($1::text[]) AND price.valid_to IS NULL`, [[...ids.products]])).rows) {
      prices.set(`${row.product_external_id}:${row.currency}`, {
        data: { amountKopeks: Number(row.amount_kopeks), currency: row.currency,
          entityType: "price", productExternalId: row.product_external_id,
          version: numberVersion(row.source_version) },
        deleted: false, id: row.id, version: numberVersion(row.source_version),
      });
    }

    const stocks = new Map<string, CurrentStock>();
    for (const row of (await client.query<{
      product_external_id: string; product_id: string; quantity_on_hand: number;
      quantity_reserved: number; source_version: string; warehouse_external_id: string;
      warehouse_id: string;
    }>(`SELECT balance.product_id, balance.warehouse_id, balance.quantity_on_hand,
               balance.quantity_reserved, balance.source_version::text,
               product.external_id AS product_external_id,
               warehouse.external_id AS warehouse_external_id
        FROM app.inventory_balances AS balance
        JOIN app.products AS product ON product.id = balance.product_id
        JOIN app.warehouses AS warehouse ON warehouse.id = balance.warehouse_id
        WHERE product.external_id = ANY($1::text[])
          AND warehouse.external_id = ANY($2::text[])`, [[...ids.products], [...ids.warehouses]])).rows) {
      stocks.set(`${row.product_external_id}:${row.warehouse_external_id}`, {
        data: { entityType: "stock", productExternalId: row.product_external_id,
          quantityOnHand: row.quantity_on_hand, version: numberVersion(row.source_version),
          warehouseExternalId: row.warehouse_external_id },
        deleted: false, id: `${row.product_id}:${row.warehouse_id}`,
        reserved: row.quantity_reserved, version: numberVersion(row.source_version),
      });
    }

    const uniqueOwners = new Map<string, string>();
    const uniqueQueries: Array<Promise<{ rows: Array<{ external_id: string; value: string }> }>> = [
      client.query(`SELECT external_id, slug::text AS value FROM app.brands
                    WHERE slug = ANY($1::citext[])`, [[...slugs.brands]]),
      client.query(`SELECT external_id, slug::text AS value FROM app.categories
                    WHERE slug = ANY($1::citext[])`, [[...slugs.categories]]),
      client.query(`SELECT external_id, slug::text AS value FROM app.products
                    WHERE slug = ANY($1::citext[])`, [[...slugs.products]]),
      client.query(`SELECT external_id, sku::text AS value FROM app.products
                    WHERE sku = ANY($1::citext[])`, [[...productSkus]]),
      client.query(`SELECT external_id, code::text AS value FROM app.warehouses
                    WHERE code = ANY($1::citext[])`, [[...warehouseCodes]]),
    ];
    const [brandSlugs, categorySlugs, productSlugs, productSkuRows, warehouseCodeRows] = await Promise.all(uniqueQueries);
    if (!brandSlugs || !categorySlugs || !productSlugs || !productSkuRows || !warehouseCodeRows) {
      throw new Error("Unique catalog validation queries returned an incomplete result");
    }
    for (const row of brandSlugs.rows) uniqueOwners.set(`brand:slug:${row.value}`, row.external_id);
    for (const row of categorySlugs.rows) uniqueOwners.set(`category:slug:${row.value}`, row.external_id);
    for (const row of productSlugs.rows) uniqueOwners.set(`product:slug:${row.value}`, row.external_id);
    for (const row of productSkuRows.rows) uniqueOwners.set(`product:sku:${row.value.toLowerCase()}`, row.external_id);
    for (const row of warehouseCodeRows.rows) uniqueOwners.set(`warehouse:code:${row.value.toLowerCase()}`, row.external_id);

    return { brands, categories, categoryParents, prices, products, stocks, uniqueOwners, warehouses };
  }

  private currentFor(row: OneCCatalogRow, current: CurrentCatalog): CurrentEntity | undefined {
    switch (row.entityType) {
      case "brand": return current.brands.get(row.externalId);
      case "category": return current.categories.get(row.externalId);
      case "warehouse": return current.warehouses.get(row.externalId);
      case "product": return current.products.get(row.externalId);
      case "price": return current.prices.get(`${row.productExternalId}:${row.currency}`);
      case "stock": return current.stocks.get(`${row.productExternalId}:${row.warehouseExternalId}`);
    }
  }

  private uniqueKeys(row: OneCCatalogRow): string[] {
    switch (row.entityType) {
      case "brand": return [`brand:slug:${row.slug}`];
      case "category": return [`category:slug:${row.slug}`];
      case "warehouse": return [`warehouse:code:${row.code.toLowerCase()}`];
      case "product": return [`product:slug:${row.slug}`, `product:sku:${row.sku.toLowerCase()}`];
      default: return [];
    }
  }

  private batchSummary(batch: BatchRow): Record<string, unknown> {
    return {
      appliedAt: batch.applied_at?.toISOString() ?? null,
      appliedRows: batch.applied_rows,
      errorSummary: batch.error_summary,
      externalBatchId: batch.external_batch_id,
      id: batch.id,
      invalidRows: batch.invalid_rows,
      rolledBackAt: batch.rolled_back_at?.toISOString() ?? null,
      skippedRows: batch.skipped_rows,
      status: batch.status,
      totalRows: batch.total_rows,
      uploadedAt: batch.uploaded_at.toISOString(),
      validRows: batch.valid_rows,
      validatedAt: batch.validated_at?.toISOString() ?? null,
      validationReport: batch.validation_report,
    };
  }
}
