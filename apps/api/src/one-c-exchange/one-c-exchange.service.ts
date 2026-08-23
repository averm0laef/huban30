// Applies a parsed CommerceML document (commerce-ml.parser.ts) to the live
// catalog. This is a *different* pipeline from CatalogApplyService
// (catalog/catalog-apply.service.ts): that one stages a JSON envelope batch
// for a human to preview and explicitly apply/rollback, with a full
// before/after revision journal. 1C driving mode=import is not a human --
// there is no preview step in the real "Обмен с сайтом" protocol, 1C simply
// expects success/progress/failure on every poll -- so this pipeline writes
// straight through, chunked and resumable via app.one_c_exchange_runs
// (migration 0016) instead of staged via app.catalog_import_batches.
//
// A row's incoming `version` from the parser is always the placeholder 1 --
// CommerceML has no version concept -- so unlike CatalogApplyService this
// never gates a write on an "expected" version. Instead every row is
// compared against the currently stored data: identical data is a no-op
// (so a re-synced, unchanged 30-40k SKU catalog does not bump every
// source_version and does not spuriously invalidate caches), and a real
// change increments source_version itself.
//
// Category assignment (AN30-013 fix): a real import against staging showed
// applyProduct trusting 1С's <Группы> group and nothing else, which left
// three of four representative products unreachable by browsing --
// "Колодки тормозные передние TRW" had no <Группы> element at all,
// "Аккумулятор Тюмень 62Ач" was filed under the junk catch-all group
// «Товары», and "Щётка стеклоочистителя Bosch 600мм" referenced a group id
// absent from <Классификатор>. Only "Масло моторное 5W-40" (a real, specific
// «Масла моторные» group) worked. applyProduct now falls back to inferring
// one of the shop's twelve known categories from the product's own name --
// see catalog-known-categories.ts for the full rule set -- whenever 1С's
// group is missing, dangling or a junk catch-all, and files anything that
// inference cannot confidently place under an explicit "Без категории"
// bucket (UNCATEGORIZED_CATEGORY_SLUG) rather than guessing. 1С's own
// grouping always wins when it names a real, specific category.
import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

import type { OneCCatalogRow } from "@an30/contracts";

import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { canonicalJson } from "../catalog/catalog-import.utils.js";
import {
  inferCategoryFromProductName,
  isJunkCategoryGroupName,
  KNOWN_CATALOG_CATEGORIES,
  UNCATEGORIZED_CATEGORY_SLUG,
} from "../catalog/catalog-known-categories.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import {
  CommerceMlParseError,
  EXCHANGE_WAREHOUSE_EXTERNAL_ID,
  parseImportXml,
  parseOffersXml,
} from "./commerce-ml.parser.js";

/** Every app.categories slug applyProduct's fallback might resolve a product to: the twelve known shop sections plus the explicit "could not tell" bucket. Fetched once per chunk (see loadKnownCategoryIds), never per row. */
const FALLBACK_CATEGORY_SLUGS: readonly string[] = [
  ...KNOWN_CATALOG_CATEGORIES.map((category) => category.slug),
  UNCATEGORIZED_CATEGORY_SLUG,
];

export type OneCExchangeFileKind = "catalog" | "offers";

export type OneCExchangeImportOutcome =
  | { kind: "failure"; reason: string }
  | { kind: "progress"; message: string }
  | { kind: "success" };

// A single poll applies at most this many rows in one transaction. 40,000
// SKUs must never be one lock (see migration 0016's comment): at 500 rows a
// full catalog takes on the order of a hundred `mode=import` polls, which
// 1C is designed to keep making for exactly this reason, and each poll's
// transaction stays well under the database's lock/statement timeouts.
const BATCH_SIZE = 500;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

type ExchangePhase = "body" | "done" | "header" | "tail";
type ExchangeStatus = "completed" | "failed" | "running";

interface ExchangeRunRow {
  batch_size: number;
  body_rows: OneCCatalogRow[];
  contains_only_changes: boolean;
  cursor_index: number;
  error_message: string | null;
  filename: string;
  header_rows: OneCCatalogRow[];
  id: string;
  kind: OneCExchangeFileKind;
  phase: ExchangePhase;
  status: ExchangeStatus;
  tail_rows: OneCCatalogRow[] | null;
}

const RUN_COLUMNS = `
  id, kind, filename, contains_only_changes, batch_size, header_rows, body_rows,
  tail_rows, phase, cursor_index, status, error_message
`;

interface RowOutcome {
  applied: boolean;
  rejected: boolean;
  /** True only for a product row whose final category assignment landed in the "Без категории" bucket -- see applyProduct. Always false for every other entity type. */
  uncategorized: boolean;
}

const NO_CHANGE: RowOutcome = { applied: false, rejected: false, uncategorized: false };

@Injectable()
export class OneCExchangeService {
  constructor(
    private readonly categoryTreeCache: CatalogCategoryTreeCache,
    private readonly database: DatabaseService,
    private readonly integration: OneCIntegrationService,
  ) {}

  /**
   * Advances the import for one uploaded file by exactly one bounded chunk
   * of work and reports what mode=import should reply. Idempotent and
   * resumable: keyed by (kind, content checksum), so calling this again for
   * a run that already reached 'completed' does no further writes at all --
   * a re-sent file (1C retries, or a re-run of the same export) replays for
   * free instead of touching the catalog twice.
   */
  async processImport(params: {
    assembled: Buffer;
    checksum: Buffer;
    filename: string;
    kind: OneCExchangeFileKind;
  }): Promise<OneCExchangeImportOutcome> {
    const existing = await this.findRun(params.kind, params.checksum);
    if (existing?.status === "completed") return { kind: "success" };
    if (existing?.status === "failed") {
      return { kind: "failure", reason: existing.error_message ?? "Импорт ранее завершился с ошибкой" };
    }

    let run: ExchangeRunRow;
    try {
      run = existing ?? await this.createRun(params);
    } catch (error) {
      return {
        kind: "failure",
        reason: error instanceof CommerceMlParseError ? error.message : "Не удалось разобрать файл 1С",
      };
    }

    try {
      return await this.advance(run);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Импорт завершился с ошибкой";
      await this.database.query(
        "UPDATE app.one_c_exchange_runs SET status = 'failed', error_message = $2 WHERE id = $1",
        [run.id, reason],
      );
      return { kind: "failure", reason };
    }
  }

  private async findRun(kind: OneCExchangeFileKind, checksum: Buffer): Promise<ExchangeRunRow | undefined> {
    return (await this.database.query<ExchangeRunRow>(
      `SELECT ${RUN_COLUMNS} FROM app.one_c_exchange_runs WHERE kind = $1 AND content_checksum = $2`,
      [kind, checksum],
    )).rows[0];
  }

  private async createRun(params: {
    assembled: Buffer;
    checksum: Buffer;
    filename: string;
    kind: OneCExchangeFileKind;
  }): Promise<ExchangeRunRow> {
    const xml = params.assembled.toString("utf8");
    const parsed = params.kind === "catalog" ? parseImportXml(xml) : parseOffersXml(xml);
    try {
      const inserted = await this.database.query<ExchangeRunRow>(
        `INSERT INTO app.one_c_exchange_runs (
           kind, filename, content_checksum, contains_only_changes, exported_at,
           batch_size, header_rows, body_rows, phase, cursor_index, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'header', 0, 'running')
         RETURNING ${RUN_COLUMNS}`,
        [
          params.kind, params.filename, params.checksum, parsed.containsOnlyChanges, parsed.exportedAt,
          BATCH_SIZE, JSON.stringify(parsed.headerRows), JSON.stringify(parsed.bodyRows),
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("1C exchange run insert returned no row");
      return row;
    } catch (error) {
      // Two overlapping uploads of the byte-identical file (a retried chunk
      // upload followed by 1C re-polling import before the first insert
      // committed) race on the unique (kind, content_checksum) key. Whoever
      // loses the race just resumes the winner's row instead of failing.
      if (isUniqueViolation(error)) {
        const raced = await this.findRun(params.kind, params.checksum);
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async advance(run: ExchangeRunRow): Promise<OneCExchangeImportOutcome> {
    if (run.phase === "header") return this.advanceHeader(run);
    if (run.phase === "body") return this.advanceBody(run);
    if (run.phase === "tail") return this.advanceTail(run);
    await this.completeRun(run);
    return { kind: "success" };
  }

  private async advanceHeader(run: ExchangeRunRow): Promise<OneCExchangeImportOutcome> {
    const slice = run.header_rows.slice(run.cursor_index, run.cursor_index + run.batch_size);
    await this.applyChunk(run, slice);
    // A category or brand may have just been inserted, renamed or
    // (de)activated -- the storefront's cached tree is stale the instant
    // this commits, whether or not the whole run is done yet.
    this.categoryTreeCache.invalidate();
    const done = run.cursor_index >= run.header_rows.length;
    if (done) await this.transitionPhase(run, "body");
    return {
      kind: "progress",
      message: done ? "Справочник применён, применяются товары" : "Применяется справочник категорий и брендов",
    };
  }

  private async advanceBody(run: ExchangeRunRow): Promise<OneCExchangeImportOutcome> {
    const slice = run.body_rows.slice(run.cursor_index, run.cursor_index + run.batch_size);
    await this.applyChunk(run, slice);
    if (run.cursor_index < run.body_rows.length) {
      return { kind: "progress", message: `Применяются товары (${run.cursor_index} из ${run.body_rows.length})` };
    }

    // Only a full offers.xml snapshot can tell us anything about products it
    // stayed silent on -- a delta (СодержитТолькоИзменения=true) or the
    // catalog/classifier file never implies "everything else is now zero".
    if (run.kind === "offers" && !run.contains_only_changes) {
      const tailRows = await this.computeTailRows(run);
      if (tailRows.length === 0) {
        await this.completeRun(run);
        return { kind: "success" };
      }
      await this.transitionPhase(run, "tail", tailRows);
      return {
        kind: "progress",
        message: `Полная выгрузка: остаток обнуляется у ${tailRows.length} товаров, отсутствующих в файле`,
      };
    }

    await this.completeRun(run);
    return { kind: "success" };
  }

  private async advanceTail(run: ExchangeRunRow): Promise<OneCExchangeImportOutcome> {
    const tailRows = run.tail_rows ?? [];
    const slice = tailRows.slice(run.cursor_index, run.cursor_index + run.batch_size);
    await this.applyChunk(run, slice);
    if (run.cursor_index < tailRows.length) {
      return { kind: "progress", message: `Обнуляются остатки отсутствующих товаров (${run.cursor_index} из ${tailRows.length})` };
    }
    await this.completeRun(run);
    return { kind: "success" };
  }

  /** Applies one slice of rows in a single transaction and advances the run's cursor/counters by that slice. Mutates `run` in place so the caller can immediately read the new cursor_index. */
  private async applyChunk(run: ExchangeRunRow, slice: OneCCatalogRow[]): Promise<void> {
    const nextCursor = run.cursor_index + slice.length;
    await this.database.transaction(async (client) => {
      // One lookup for the whole chunk (see loadKnownCategoryIds), not one
      // per row -- this is what keeps applyProduct's category fallback from
      // turning a 40,000-row import into 40,000 extra statements.
      const knownCategories = await this.loadKnownCategoryIds(client);
      let touched = 0;
      let rejected = 0;
      let uncategorized = 0;
      for (const row of slice) {
        const outcome = await this.applyRow(client, row, knownCategories);
        if (outcome.applied) touched += 1;
        if (outcome.rejected) rejected += 1;
        if (outcome.uncategorized) uncategorized += 1;
      }
      await client.query(
        `UPDATE app.one_c_exchange_runs
         SET cursor_index = $2, rows_touched = rows_touched + $3, rows_rejected = rows_rejected + $4,
             rows_uncategorized = rows_uncategorized + $5
         WHERE id = $1`,
        [run.id, nextCursor, touched, rejected, uncategorized],
      );
    });
    run.cursor_index = nextCursor;
  }

  /** Moves the run to its next phase, resetting the cursor for that phase's own array. */
  private async transitionPhase(run: ExchangeRunRow, phase: ExchangePhase, tailRows?: OneCCatalogRow[]): Promise<void> {
    if (tailRows) {
      await this.database.query(
        "UPDATE app.one_c_exchange_runs SET phase = $2, cursor_index = 0, tail_rows = $3::jsonb WHERE id = $1",
        [run.id, phase, JSON.stringify(tailRows)],
      );
      run.tail_rows = tailRows;
    } else {
      await this.database.query(
        "UPDATE app.one_c_exchange_runs SET phase = $2, cursor_index = 0 WHERE id = $1",
        [run.id, phase],
      );
    }
    run.phase = phase;
    run.cursor_index = 0;
  }

  private async completeRun(run: ExchangeRunRow): Promise<void> {
    const totals = (await this.database.query<{
      rows_rejected: number; rows_touched: number; rows_uncategorized: number;
    }>(
      `UPDATE app.one_c_exchange_runs SET phase = 'done', status = 'completed'
       WHERE id = $1 RETURNING rows_touched, rows_rejected, rows_uncategorized`,
      [run.id],
    )).rows[0];
    await this.integration.recordExchangeResult({
      containsOnlyChanges: run.contains_only_changes,
      filename: run.filename,
      kind: run.kind,
      rowsRejected: totals?.rows_rejected ?? 0,
      rowsTouched: totals?.rows_touched ?? 0,
      // How many products this run could not confidently place in a real
      // category and filed under "Без категории" instead of guessing -- see
      // this file's module doc and catalog-known-categories.ts. Surfaced
      // here (not just in the row count) so the owner sees the number on
      // the admin settings page instead of discovering the gap later.
      rowsUncategorized: totals?.rows_uncategorized ?? 0,
    });
  }

  /**
   * A full offers.xml snapshot only ever tells us what 1C still sells, never
   * what it stopped selling. Anything currently on hand at the exchange
   * warehouse whose product was not mentioned in this file's offers is
   * treated as discontinued stock -- set to zero, same as CatalogApplyService
   * would receive from 1C explicitly, rather than left stale forever.
   * Products themselves are never touched here: they stay in the catalog
   * (their listing, description, past orders) and simply show as
   * unavailable, matching "never hard-delete".
   */
  private async computeTailRows(
    run: ExchangeRunRow,
  ): Promise<Array<Extract<OneCCatalogRow, { entityType: "stock" }>>> {
    const seen = new Set(
      run.body_rows
        // Количество is optional in CommerceML. An offer that carries a
        // valid price but no stock row was still explicitly present in the
        // snapshot and must not be mistaken for an omitted/discontinued
        // product. Count both row types; an interleaved price+stock pair
        // naturally collapses to the same external id in the Set.
        .filter((row): row is Extract<OneCCatalogRow, { entityType: "price" | "stock" }> => (
          row.entityType === "price" || row.entityType === "stock"
        ))
        .map((row) => row.productExternalId),
    );
    const rows = (await this.database.query<{ external_id: string }>(
      `SELECT product.external_id
       FROM app.inventory_balances AS balance
       JOIN app.products AS product ON product.id = balance.product_id
       JOIN app.warehouses AS warehouse ON warehouse.id = balance.warehouse_id
       WHERE warehouse.external_id = $1 AND balance.quantity_on_hand <> 0 AND product.external_id IS NOT NULL`,
      [EXCHANGE_WAREHOUSE_EXTERNAL_ID],
    )).rows;
    return rows
      .filter((row) => !seen.has(row.external_id))
      .map((row) => ({
        entityType: "stock" as const,
        productExternalId: row.external_id,
        quantityOnHand: 0,
        version: 1,
        warehouseExternalId: EXCHANGE_WAREHOUSE_EXTERNAL_ID,
      }));
  }

  private async applyRow(
    client: PoolClient,
    row: OneCCatalogRow,
    knownCategories: ReadonlyMap<string, string> = new Map(),
  ): Promise<RowOutcome> {
    switch (row.entityType) {
      case "brand": return this.applyBrand(client, row);
      case "category": return this.applyCategory(client, row);
      case "warehouse": return this.applyWarehouse(client, row);
      case "product": return this.applyProduct(client, row, knownCategories);
      case "price": return this.applyPrice(client, row);
      case "stock": return this.applyStock(client, row);
    }
  }

  /**
   * The app.categories id for each of the twelve known shop sections plus
   * the "Без категории" bucket (FALLBACK_CATEGORY_SLUGS), fetched once per
   * chunk rather than once per row -- applyProduct's fallback only ever
   * needs a slug -> id lookup, and this shape never changes within a single
   * poll's transaction. For a 40,000-row import at BATCH_SIZE=500 this is
   * one extra statement per ~500 products (about 80 total for a full
   * catalog), not one per product -- see this file's module doc.
   */
  private async loadKnownCategoryIds(client: PoolClient): Promise<ReadonlyMap<string, string>> {
    const rows = (await client.query<{ id: string; slug: string }>(
      "SELECT id, slug::text AS slug FROM app.categories WHERE slug::text = ANY($1::text[])",
      [FALLBACK_CATEGORY_SLUGS],
    )).rows;
    return new Map(rows.map((row) => [row.slug, row.id]));
  }

  private async applyBrand(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "brand" }>,
  ): Promise<RowOutcome> {
    const current = (await client.query<{
      deleted_at: Date | null; id: string; is_active: boolean; name: string; slug: string;
    }>(
      "SELECT id, name, slug::text, is_active, deleted_at FROM app.brands WHERE external_id = $1 FOR UPDATE",
      [row.externalId],
    )).rows[0];
    if (!current) {
      await client.query(
        `INSERT INTO app.brands (external_id, name, slug, is_active, source_version, deleted_at)
         VALUES ($1, $2, $3, $4, 1, CASE WHEN $4 THEN NULL ELSE clock_timestamp() END)`,
        [row.externalId, row.name, row.slug, row.isActive],
      );
      return { applied: true, rejected: false, uncategorized: false };
    }
    const deletionStateMatches = row.isActive ? current.deleted_at === null : current.deleted_at !== null;
    if (current.name === row.name && current.slug === row.slug
      && current.is_active === row.isActive && deletionStateMatches) return NO_CHANGE;
    await client.query(
      `UPDATE app.brands SET name = $2, slug = $3, is_active = $4,
              deleted_at = CASE WHEN $4 THEN NULL ELSE COALESCE(deleted_at, clock_timestamp()) END,
              source_version = source_version + 1 WHERE id = $1`,
      [current.id, row.name, row.slug, row.isActive],
    );
    return { applied: true, rejected: false, uncategorized: false };
  }

  private async applyCategory(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "category" }>,
  ): Promise<RowOutcome> {
    const parentId = row.parentExternalId
      ? (await client.query<{ id: string }>(
          "SELECT id FROM app.categories WHERE external_id = $1", [row.parentExternalId],
        )).rows[0]?.id ?? null
      : null;
    // Header rows are applied in document order and CommerceML always lists
    // a parent group before its children, so a missing parent here means the
    // source file itself omitted it -- degrade to a root category rather
    // than dropping the row, and flag it so the run's counters surface it.
    const rejected = row.parentExternalId !== null && parentId === null;
    const current = (await client.query<{
      deleted_at: Date | null; description: string | null; id: string; is_active: boolean; name: string;
      parent_id: string | null; slug: string; sort_order: number;
    }>(
      `SELECT id, parent_id, name, slug::text, description, sort_order, is_active, deleted_at
       FROM app.categories WHERE external_id = $1 FOR UPDATE`,
      [row.externalId],
    )).rows[0];
    if (!current) {
      await client.query(
        `INSERT INTO app.categories (
           external_id, parent_id, name, slug, description, sort_order, is_active, source_version, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1,
           CASE WHEN $7 THEN NULL ELSE clock_timestamp() END)`,
        [row.externalId, parentId, row.name, row.slug, row.description, row.sortOrder, row.isActive],
      );
      return { applied: true, rejected, uncategorized: false };
    }
    const unchanged = current.parent_id === parentId && current.name === row.name && current.slug === row.slug
      && current.description === row.description && current.sort_order === row.sortOrder
      && current.is_active === row.isActive
      && (row.isActive ? current.deleted_at === null : current.deleted_at !== null);
    if (unchanged) return { applied: false, rejected, uncategorized: false };
    await client.query(
      `UPDATE app.categories SET parent_id = $2, name = $3, slug = $4, description = $5, sort_order = $6,
              is_active = $7,
              deleted_at = CASE WHEN $7 THEN NULL ELSE COALESCE(deleted_at, clock_timestamp()) END,
              source_version = source_version + 1 WHERE id = $1`,
      [current.id, parentId, row.name, row.slug, row.description, row.sortOrder, row.isActive],
    );
    return { applied: true, rejected, uncategorized: false };
  }

  private async applyWarehouse(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "warehouse" }>,
  ): Promise<RowOutcome> {
    const current = (await client.query<{
      code: string; deleted_at: Date | null; id: string; is_active: boolean; name: string;
    }>(
      "SELECT id, code::text, name, is_active, deleted_at FROM app.warehouses WHERE external_id = $1 FOR UPDATE",
      [row.externalId],
    )).rows[0];
    if (!current) {
      await client.query(
        `INSERT INTO app.warehouses (external_id, code, name, is_active, source_version, deleted_at)
         VALUES ($1, $2, $3, $4, 1, CASE WHEN $4 THEN NULL ELSE clock_timestamp() END)`,
        [row.externalId, row.code, row.name, row.isActive],
      );
      return { applied: true, rejected: false, uncategorized: false };
    }
    const deletionStateMatches = row.isActive ? current.deleted_at === null : current.deleted_at !== null;
    if (current.code === row.code && current.name === row.name
      && current.is_active === row.isActive && deletionStateMatches) return NO_CHANGE;
    await client.query(
      `UPDATE app.warehouses SET code = $2, name = $3, is_active = $4,
              deleted_at = CASE WHEN $4 THEN NULL ELSE COALESCE(deleted_at, clock_timestamp()) END,
              source_version = source_version + 1 WHERE id = $1`,
      [current.id, row.code, row.name, row.isActive],
    );
    return { applied: true, rejected: false, uncategorized: false };
  }

  private async applyProduct(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "product" }>,
    knownCategories: ReadonlyMap<string, string>,
  ): Promise<RowOutcome> {
    const brandId = row.brandExternalId
      ? (await client.query<{ id: string }>(
          "SELECT id FROM app.brands WHERE external_id = $1", [row.brandExternalId],
        )).rows[0]?.id ?? null
      : null;

    // 1С's own grouping always wins when it names a real, specific category
    // -- only a missing categoryExternalId, one that does not resolve (a
    // dangling reference, still surfaced via `rejected` exactly as before),
    // or one that resolves to a junk catch-all name (see
    // JUNK_CATEGORY_GROUP_NAMES) falls through to inferring a category from
    // the product's own name. See catalog-known-categories.ts for the full
    // rule set and one-c-exchange.service.ts's module doc for the measured
    // real-world cases this fixes.
    const group = row.categoryExternalId
      ? (await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM app.categories WHERE external_id = $1", [row.categoryExternalId],
        )).rows[0]
      : undefined;
    const groupDangling = row.categoryExternalId !== null && group === undefined;
    const groupUsable = group !== undefined && !isJunkCategoryGroupName(group.name);

    let categoryId: string | null;
    let uncategorized = false;
    if (groupUsable) {
      categoryId = group!.id;
    } else {
      const inferredSlug = inferCategoryFromProductName(row.name);
      const targetSlug = inferredSlug ?? UNCATEGORIZED_CATEGORY_SLUG;
      categoryId = knownCategories.get(targetSlug) ?? null;
      // The twelve known categories and the "Без категории" bucket are
      // seeded once by migration 0024 and never removed by this service, so
      // this should always resolve. If it somehow does not (e.g. a database
      // that has not run that migration yet), degrade to an unlinked
      // product exactly like any other cross-reference problem below,
      // rather than crashing the whole import over it.
      uncategorized = inferredSlug === null || categoryId === null;
    }

    // A dangling brand/category reference degrades to an unlinked product
    // rather than dropping it: 40,000 SKUs must not lose one because of a
    // single bad cross-reference elsewhere in the file. Still surfaced via
    // rows_rejected so it is visible in the run's counters, not silent.
    const rejected = (row.brandExternalId !== null && brandId === null) || groupDangling;
    const attributesJson = JSON.stringify(row.attributes);
    const current = (await client.query<{
      attributes: Record<string, unknown>; brand_id: string | null; category_id: string | null;
      deleted_at: Date | null; description: string | null; id: string; is_active: boolean; name: string;
      search_text: string | null;
      sku: string; slug: string;
    }>(
      `SELECT id, sku::text, name, slug::text, brand_id, category_id, description, attributes, search_text,
              is_active, deleted_at
       FROM app.products WHERE external_id = $1 FOR UPDATE`,
      [row.externalId],
    )).rows[0];
    if (!current) {
      await client.query(
        `INSERT INTO app.products (
           external_id, sku, name, slug, brand_id, category_id, description, attributes, search_text,
           is_active, source_version, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 1,
           CASE WHEN $10 THEN NULL ELSE clock_timestamp() END)`,
        [row.externalId, row.sku, row.name, row.slug, brandId, categoryId, row.description,
          attributesJson, row.searchText, row.isActive],
      );
      return { applied: true, rejected, uncategorized };
    }
    const unchanged = current.sku === row.sku && current.name === row.name && current.slug === row.slug
      && current.brand_id === brandId && current.category_id === categoryId
      && current.description === row.description && current.search_text === row.searchText
      && current.is_active === row.isActive
      && (row.isActive ? current.deleted_at === null : current.deleted_at !== null)
      && canonicalJson(current.attributes) === canonicalJson(row.attributes);
    if (unchanged) return { applied: false, rejected, uncategorized };
    await client.query(
      `UPDATE app.products SET sku = $2, name = $3, slug = $4, brand_id = $5, category_id = $6, description = $7,
              attributes = $8::jsonb, search_text = $9, is_active = $10,
              deleted_at = CASE WHEN $10 THEN NULL ELSE COALESCE(deleted_at, clock_timestamp()) END,
              source_version = source_version + 1
       WHERE id = $1`,
      [current.id, row.sku, row.name, row.slug, brandId, categoryId, row.description,
        attributesJson, row.searchText, row.isActive],
    );
    return { applied: true, rejected, uncategorized };
  }

  private async applyPrice(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "price" }>,
  ): Promise<RowOutcome> {
    const productId = (await client.query<{ id: string }>(
      "SELECT id FROM app.products WHERE external_id = $1", [row.productExternalId],
    )).rows[0]?.id;
    // offers.xml is expected to follow a completed import.xml run, but if a
    // price arrives for a product 1C has not (yet) described, skip it rather
    // than fail the whole chunk -- it will apply cleanly once the product
    // exists, on the next full or delta sync.
    if (!productId) return { applied: false, rejected: true, uncategorized: false };
    const current = (await client.query<{ amount_kopeks: string; id: string }>(
      `SELECT id, amount_kopeks::text FROM app.product_prices
       WHERE product_id = $1 AND currency = $2 AND valid_to IS NULL FOR UPDATE`,
      [productId, row.currency],
    )).rows[0];
    if (current && Number(current.amount_kopeks) === row.amountKopeks) return NO_CHANGE;
    const effectiveAt = new Date();
    if (current) {
      await client.query("UPDATE app.product_prices SET valid_to = $2 WHERE id = $1", [current.id, effectiveAt]);
    }
    await client.query(
      `INSERT INTO app.product_prices (product_id, amount_kopeks, currency, valid_from, source, source_version)
       VALUES ($1, $2, $3, $4, '1c', 1)`,
      [productId, row.amountKopeks, row.currency, effectiveAt],
    );
    return { applied: true, rejected: false, uncategorized: false };
  }

  private async applyStock(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "stock" }>,
  ): Promise<RowOutcome> {
    const productId = (await client.query<{ id: string }>(
      "SELECT id FROM app.products WHERE external_id = $1", [row.productExternalId],
    )).rows[0]?.id;
    const warehouseId = (await client.query<{ id: string }>(
      "SELECT id FROM app.warehouses WHERE external_id = $1", [row.warehouseExternalId],
    )).rows[0]?.id;
    if (!productId || !warehouseId) return { applied: false, rejected: true, uncategorized: false };
    const current = (await client.query<{ quantity_on_hand: number; quantity_reserved: number }>(
      `SELECT quantity_on_hand, quantity_reserved FROM app.inventory_balances
       WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE`,
      [productId, warehouseId],
    )).rows[0];
    // 1C's exported quantity can, in principle, undercut what the shop has
    // already reserved for a live order. Never let a sync shrink on-hand
    // below what is already reserved -- the floor is the current reservation,
    // not 1C's raw number -- and flag it so an operator can see 1C and the
    // shop have drifted apart on this SKU.
    const floored = current !== undefined && row.quantityOnHand < current.quantity_reserved;
    const targetQuantity = current ? Math.max(row.quantityOnHand, current.quantity_reserved) : row.quantityOnHand;
    if (current && current.quantity_on_hand === targetQuantity) {
      return { applied: false, rejected: floored, uncategorized: false };
    }
    if (current) {
      await client.query(
        "UPDATE app.inventory_balances SET quantity_on_hand = $3, source_version = source_version + 1 WHERE product_id = $1 AND warehouse_id = $2",
        [productId, warehouseId, targetQuantity],
      );
    } else {
      await client.query(
        "INSERT INTO app.inventory_balances (product_id, warehouse_id, quantity_on_hand, quantity_reserved, source_version) VALUES ($1, $2, $3, 0, 1)",
        [productId, warehouseId, targetQuantity],
      );
    }
    const delta = targetQuantity - (current?.quantity_on_hand ?? 0);
    if (delta !== 0) {
      await client.query(
        `INSERT INTO app.inventory_events (
           product_id, warehouse_id, event_type, delta_on_hand, delta_reserved,
           resulting_on_hand, resulting_reserved, reference_type
         ) VALUES ($1, $2, 'import_set', $3, 0, $4, $5, 'one_c_exchange')`,
        [productId, warehouseId, delta, targetQuantity, current?.quantity_reserved ?? 0],
      );
    }
    return { applied: true, rejected: floored, uncategorized: false };
  }
}
