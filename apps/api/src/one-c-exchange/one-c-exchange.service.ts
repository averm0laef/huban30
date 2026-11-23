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
// Category assignment: the storefront owns ONE section tree
// (STOREFRONT_TAXONOMY in @an30/contracts, seeded by migrations 0024/0036).
// 1С groups are stored per base in app.one_c_group_mappings and mapped into
// that tree -- staff override, then group names, then the product name, then
// «Без категории» (catalog-recategorize.service.ts, catalog-known-categories.ts).
// Two bases therefore never produce parallel public category trees.
import { Injectable } from "@nestjs/common";
import { readOneCExchangeOptions } from "./one-c-exchange-options.js";
import { namespaceOneCRow, sourceExternalId, sourceSql, type OneCSource } from "./one-c-source.js";
import type { PoolClient } from "pg";

import type { OneCCatalogRow } from "@an30/contracts";

import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { canonicalJson } from "../catalog/catalog-import.utils.js";
import { loadPlacementContext, placeProduct, type PlacementContext } from "../catalog/catalog-recategorize.service.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { decodeCommerceMl } from "./commerce-ml-encoding.js";
import {
  CommerceMlParseError,
  parseImportXml,
  parseOffersXml,
  type CommerceMlPropertyDictionary,
  type ExchangeProductRow,
  type ExchangeWarehouseRow,
} from "./commerce-ml.parser.js";
import { OneCExchangeImagesService, type ImageTask } from "./one-c-exchange-images.service.js";

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
// Each image is read, scanned by ClamAV and probed before it is attached, so
// far fewer fit into one poll than plain rows do.
const IMAGE_BATCH_SIZE = 20;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

type ExchangePhase = "body" | "done" | "header" | "images" | "tail";
type ExchangeStatus = "completed" | "failed" | "running";

interface ExchangeRunRow {
  source_key?: OneCSource;
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
  id, kind, filename, contains_only_changes, batch_size, header_rows, body_rows, source_key,
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
    private readonly images?: OneCExchangeImagesService,
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
    source?: OneCSource;
  }): Promise<OneCExchangeImportOutcome> {
    const existing = await this.findRun(params.kind, params.checksum,params.source ?? "one_c");
    if (existing?.status === "completed") return { kind: "success" };
    if (existing?.status === "failed" && existing.header_rows.length === 0 && existing.body_rows.length === 0) {
      // The same bytes could not be parsed before and cannot be now.
      return { kind: "failure", reason: existing.error_message ?? "Файл 1С не удалось разобрать" };
    }
    if (existing?.status === "failed") {
      // 1C retries the same file after an error. Resume from the stored
      // cursor instead of replaying the old failure forever: every row is
      // compared with current data, so re-applying a chunk is a no-op.
      await this.database.query(
        "UPDATE app.one_c_exchange_runs SET status = 'running', error_message = NULL WHERE id = $1",
        [existing.id],
      );
      existing.status = "running";
      existing.error_message = null;
    }

    let run: ExchangeRunRow;
    try {
      run = existing ?? await this.createRun(params);
    } catch (error) {
      const reason = error instanceof CommerceMlParseError
        ? `Файл ${params.filename} повреждён или передан не полностью (${error.message})`
        : "Не удалось разобрать файл 1С";
      await this.recordUnparsedFile(params, reason);
      return { kind: "failure", reason };
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

  /** Keeps a broken file visible in the admin exchange journal; a parse failure otherwise leaves no trace. */
  private async recordUnparsedFile(params: {
    checksum: Buffer; filename: string; kind: OneCExchangeFileKind; source?: OneCSource;
  }, reason: string): Promise<void> {
    await this.database.query(
      `INSERT INTO app.one_c_exchange_runs (
         kind, filename, content_checksum, contains_only_changes, exported_at,
         batch_size, header_rows, body_rows, phase, cursor_index, status, error_message, source_key
       ) VALUES ($1, $2, $3, true, clock_timestamp(), $4, '[]'::jsonb, '[]'::jsonb, 'header', 0, 'failed', $5,
         ${sourceSql(params.source ?? "one_c")})
       ON CONFLICT DO NOTHING`,
      [params.kind, params.filename, params.checksum, BATCH_SIZE, reason.slice(0, 1_000)],
    ).catch(() => undefined);
  }

  private async findRun(kind: OneCExchangeFileKind, checksum: Buffer,source:OneCSource="one_c"): Promise<ExchangeRunRow | undefined> {
    return (await this.database.query<ExchangeRunRow>(
      `SELECT ${RUN_COLUMNS} FROM app.one_c_exchange_runs WHERE kind = $1 AND content_checksum = $2 AND source_key=${sourceSql(source)}`,
      [kind, checksum],
    )).rows[0];
  }

  private async createRun(params: {
    assembled: Buffer;
    checksum: Buffer;
    filename: string;
    kind: OneCExchangeFileKind;
    source?: OneCSource;
  }): Promise<ExchangeRunRow> {
    const source=params.source ?? "one_c";
    const xml = decodeCommerceMl(params.assembled);
    // ONE_C_PRICE_TYPE names the 1C price type shown on the site; without it
    // the parser picks a selling type and never a cost one (selectPriceType).
    const parsed = params.kind === "catalog"
      ? await this.parseCatalogWithDictionary(xml, source)
      : parseOffersXml(xml, { priceTypeName: source === "one_c" ? process.env.ONE_C_PRICE_TYPE : process.env.ONE_C_PRICE_TYPE_SECONDARY });
    try {
      const inserted = await this.database.query<ExchangeRunRow>(
        `INSERT INTO app.one_c_exchange_runs (
           kind, filename, content_checksum, contains_only_changes, exported_at,
           batch_size, header_rows, body_rows, phase, cursor_index, status,source_key, price_type_name
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'header', 0, 'running',$9, $10)
         RETURNING ${RUN_COLUMNS}`,
        [
          params.kind, params.filename, params.checksum, parsed.containsOnlyChanges, parsed.exportedAt,
          BATCH_SIZE, JSON.stringify(parsed.headerRows.map(row=>namespaceOneCRow(source,row))), JSON.stringify(parsed.bodyRows.map(row=>namespaceOneCRow(source,row))),source,
          "priceTypeName" in parsed ? parsed.priceTypeName?.slice(0, 200) ?? null : null,
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
        const raced = await this.findRun(params.kind, params.checksum,source);
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Parses import.xml with the base's stored property definitions and keeps
   * the merged set for the next file: a split export may send <Свойства>
   * once and the goods in later files.
   */
  private async parseCatalogWithDictionary(xml: string, source: OneCSource) {
    const endpoint = (await this.database.query<{ one_c_property_dictionary: CommerceMlPropertyDictionary; settings: unknown }>(
      `SELECT one_c_property_dictionary, settings FROM app.integration_endpoints WHERE integration_key = ${sourceSql(source)}`,
    )).rows[0];
    const stored = endpoint?.one_c_property_dictionary ?? {};
    const options = readOneCExchangeOptions(endpoint?.settings);
    const parsed = parseImportXml(xml, { knownProperties: stored, publishDescriptions: options.publishDescriptions });
    if (canonicalJson(parsed.properties) !== canonicalJson(stored)) {
      await this.database.query(
        `UPDATE app.integration_endpoints SET one_c_property_dictionary = $1::jsonb
         WHERE integration_key = ${sourceSql(source)}`,
        [JSON.stringify(parsed.properties)],
      );
    }
    return parsed;
  }

  private async advance(run: ExchangeRunRow): Promise<OneCExchangeImportOutcome> {
    if (run.phase === "header") return this.advanceHeader(run);
    if (run.phase === "body") return this.advanceBody(run);
    if (run.phase === "tail") return this.advanceTail(run);
    if (run.phase === "images") return this.advanceImages(run);
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
        message: `Полная выгрузка: обнуляются остатки, которых нет в файле (${tailRows.length} поз.)`,
      };
    }

    // A full import.xml (СодержитТолькоИзменения=false) is the whole
    // catalogue: 1C items it no longer lists are hidden from the shop. A file
    // listing less than half of what is live now is treated as a mistake
    // (e.g. an export filtered by group) and hides nothing.
    if (run.kind === "catalog" && !run.contains_only_changes) {
      await this.deactivateMissingProducts(run);
    }

    if (run.kind === "catalog" && this.images && imageTasks(run).length > 0) {
      await this.transitionPhase(run, "images");
      return { kind: "progress", message: `Товары применены, загружаются изображения (0 из ${imageTasks(run).length})` };
    }

    await this.completeRun(run);
    return { kind: "success" };
  }

  private async advanceImages(run: ExchangeRunRow): Promise<OneCExchangeImportOutcome> {
    const tasks = imageTasks(run);
    const slice = tasks.slice(run.cursor_index, run.cursor_index + IMAGE_BATCH_SIZE);
    let attached = 0;
    let skipped = 0;
    for (const task of slice) {
      const outcome = this.images ? await this.images.attach(task, run.source_key ?? "one_c") : "skipped";
      if (outcome === "attached") attached += 1;
      if (outcome === "skipped") skipped += 1;
    }
    const nextCursor = run.cursor_index + slice.length;
    await this.database.query(
      `UPDATE app.one_c_exchange_runs SET cursor_index = $2, images_attached = images_attached + $3,
              images_skipped = images_skipped + $4 WHERE id = $1`,
      [run.id, nextCursor, attached, skipped],
    );
    run.cursor_index = nextCursor;
    if (nextCursor < tasks.length) {
      return { kind: "progress", message: `Загружаются изображения (${nextCursor} из ${tasks.length})` };
    }
    await this.completeRun(run);
    return { kind: "success" };
  }

  /**
   * Hides the products of this base a full catalogue no longer lists and
   * writes down what happened: how many were hidden, or that none were
   * because the file named less than half of the live products.
   */
  private async deactivateMissingProducts(run: ExchangeRunRow): Promise<void> {
    const listed = run.body_rows
      .filter((row): row is Extract<OneCCatalogRow, { entityType: "product" }> => row.entityType === "product")
      .map((row) => row.externalId);
    if (listed.length === 0) return;
    const outcome = (await this.database.query<{ hidden: number; live_total: number }>(
      `WITH live AS (
         SELECT count(*) AS total FROM app.products
         WHERE external_id IS NOT NULL AND is_active AND deleted_at IS NULL AND NOT is_demo AND one_c_source=${sourceSql(run.source_key ?? 'one_c')}
       ), hidden AS (
         UPDATE app.products SET is_active = false, updated_at = clock_timestamp()
         WHERE external_id IS NOT NULL AND is_active AND deleted_at IS NULL AND NOT is_demo AND one_c_source=${sourceSql(run.source_key ?? 'one_c')}
           AND NOT (external_id = ANY($1::text[]))
           AND cardinality($1::text[]) * 2 >= (SELECT total FROM live)
         RETURNING 1
       )
       SELECT (SELECT total FROM live)::int AS live_total, (SELECT count(*) FROM hidden)::int AS hidden`,
      [listed],
    )).rows[0];
    await this.database.query(
      "UPDATE app.one_c_exchange_runs SET products_hidden = $2, hiding_skipped = $3 WHERE id = $1",
      [run.id, outcome?.hidden ?? 0, listed.length * 2 < (outcome?.live_total ?? 0)],
    );
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
      const placement = await loadPlacementContext(client, [run.source_key ?? "one_c"]);
      let touched = 0;
      let rejected = 0;
      let uncategorized = 0;
      for (const row of slice) {
        // A savepoint per row: one row that a unique index refuses (two brand
        // names that transliterate to one slug, two warehouses with one code)
        // is counted as rejected instead of rolling back the whole chunk and
        // failing every later exchange of the same file. A shared Артикул is
        // not such a case: products are not unique by article (migration 0046).
        await client.query("SAVEPOINT one_c_row");
        let outcome: Awaited<ReturnType<OneCExchangeService["applyRow"]>>;
        try {
          outcome = await this.applyRow(client, row, placement, run.source_key ?? "one_c");
          await client.query("RELEASE SAVEPOINT one_c_row");
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          await client.query("ROLLBACK TO SAVEPOINT one_c_row");
          rejected += 1;
          continue;
        }
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
    // Product counts per section changed with this run; without this the
    // storefront would hide freshly filled sections for up to 5 minutes.
    this.categoryTreeCache.invalidate();
    const totals = (await this.database.query<{
      images_attached: number; images_skipped: number;
      hiding_skipped: boolean; products_hidden: number;
      rows_rejected: number; rows_touched: number; rows_uncategorized: number;
    }>(
      `UPDATE app.one_c_exchange_runs SET phase = 'done', status = 'completed'
       WHERE id = $1 RETURNING rows_touched, rows_rejected, rows_uncategorized, images_attached, images_skipped, products_hidden, hiding_skipped`,
      [run.id],
    )).rows[0];
    await this.integration.recordExchangeResult({
      containsOnlyChanges: run.contains_only_changes,
      filename: run.filename,
      imagesAttached: totals?.images_attached ?? 0,
      imagesSkipped: totals?.images_skipped ?? 0,
      hidingSkipped: totals?.hiding_skipped ?? false,
      kind: run.kind,
      productsHidden: totals?.products_hidden ?? 0,
      rowsRejected: totals?.rows_rejected ?? 0,
      rowsTouched: totals?.rows_touched ?? 0,
      // How many products this run could not confidently place in a real
      // category and filed under "Без категории" instead of guessing -- see
      // this file's module doc and catalog-known-categories.ts. Surfaced
      // here (not just in the row count) so the owner sees the number on
      // the admin settings page instead of discovering the gap later.
      rowsUncategorized: totals?.rows_uncategorized ?? 0,
    },run.source_key ?? "one_c");
  }

  /**
   * A full offers snapshot only ever tells us what 1C still sells, never
   * what it stopped selling. Within this base's products:
   *   - a product absent from the file has every non-zero balance zeroed;
   *   - a product whose offer carried stock has its balance zeroed on every
   *     warehouse the offer no longer lists;
   *   - a product whose offer carried only a price keeps its stock.
   * A file without any stock figure at all (the price-only prices*.xml or an
   * offers*.xml of a split 2.08+ export) zeroes nothing. Products themselves
   * are never touched here: they stay listed and simply show as unavailable.
   */
  private async computeTailRows(
    run: ExchangeRunRow,
  ): Promise<Array<Extract<OneCCatalogRow, { entityType: "stock" }>>> {
    const stockRows = run.body_rows
      .filter((row): row is Extract<OneCCatalogRow, { entityType: "stock" }> => row.entityType === "stock");
    if (stockRows.length === 0) return [];
    const stockPairs = new Set(stockRows.map((row) => `${row.productExternalId}\u0000${row.warehouseExternalId}`));
    const stockProducts = new Set(stockRows.map((row) => row.productExternalId));
    const priceOnlyProducts = new Set(run.body_rows
      .filter((row) => row.entityType === "price" && !stockProducts.has(row.productExternalId))
      .map((row) => (row as Extract<OneCCatalogRow, { entityType: "price" }>).productExternalId));
    const rows = (await this.database.query<{ external_id: string; warehouse_external_id: string }>(
      `SELECT product.external_id, warehouse.external_id AS warehouse_external_id
       FROM app.inventory_balances AS balance
       JOIN app.products AS product ON product.id = balance.product_id
       JOIN app.warehouses AS warehouse ON warehouse.id = balance.warehouse_id
       WHERE balance.quantity_on_hand <> 0 AND product.external_id IS NOT NULL
         AND warehouse.external_id IS NOT NULL
         AND product.one_c_source=${sourceSql(run.source_key ?? "one_c")}`,
    )).rows;
    return rows
      .filter((row) => !priceOnlyProducts.has(row.external_id))
      .filter((row) => !stockPairs.has(`${row.external_id}\u0000${row.warehouse_external_id}`))
      .map((row) => ({
        entityType: "stock" as const,
        productExternalId: row.external_id,
        quantityOnHand: 0,
        version: 1,
        warehouseExternalId: row.warehouse_external_id,
      }));
  }

  private async applyRow(
    client: PoolClient,
    row: OneCCatalogRow,
    placement: PlacementContext = { categoryIds: new Map(), groups: new Map(), rules: [] },
    source:OneCSource="one_c",
  ): Promise<RowOutcome> {
    switch (row.entityType) {
      case "brand": return this.applyBrand(client, row);
      case "category": return this.applyGroup(client, row, source);
      case "warehouse": return this.applyWarehouse(client, row);
      case "product": return this.applyProduct(client, row, placement, source);
      case "price": return this.applyPrice(client, row,source);
      case "stock": return this.applyStock(client, row,source);
    }
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
    // The brand key is case-insensitive ("TRW" and "trw" are one brand) and
    // shared by both bases, so a different spelling of the same name must
    // not rename it back and forth on every exchange: the first wins.
    const sameName = current.name.toLocaleUpperCase("ru-RU") === row.name.toLocaleUpperCase("ru-RU");
    if (sameName && current.is_active === row.isActive && deletionStateMatches) return NO_CHANGE;
    await client.query(
      `UPDATE app.brands SET name = $2, slug = $3, is_active = $4,
              deleted_at = CASE WHEN $4 THEN NULL ELSE COALESCE(deleted_at, clock_timestamp()) END,
              source_version = source_version + 1 WHERE id = $1`,
      [current.id, sameName ? current.name : row.name, sameName ? current.slug : row.slug, row.isActive],
    );
    return { applied: true, rejected: false, uncategorized: false };
  }

  /**
   * A 1С group is remembered per base in app.one_c_group_mappings, never
   * created as a public category: the storefront has one section tree
   * (STOREFRONT_TAXONOMY) and groups are only mapped into it. A staff
   * override already on the row is kept.
   */
  private async applyGroup(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "category" }>,
    source: OneCSource,
  ): Promise<RowOutcome> {
    const result = await client.query(
      `INSERT INTO app.one_c_group_mappings (source_key, group_external_id, group_name, parent_group_external_id, is_active)
       VALUES (${sourceSql(source)}, $1, $2, $3, $4)
       ON CONFLICT (source_key, group_external_id) DO UPDATE
       SET group_name = EXCLUDED.group_name, parent_group_external_id = EXCLUDED.parent_group_external_id,
           is_active = EXCLUDED.is_active
       WHERE (app.one_c_group_mappings.group_name, app.one_c_group_mappings.parent_group_external_id,
              app.one_c_group_mappings.is_active)
         IS DISTINCT FROM (EXCLUDED.group_name, EXCLUDED.parent_group_external_id, EXCLUDED.is_active)`,
      [row.externalId, row.name, row.parentExternalId, row.isActive],
    );
    return { applied: (result.rowCount ?? 0) > 0, rejected: false, uncategorized: false };
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
    // An offers file that references a warehouse without listing <Склады>
    // carries only a placeholder name; never overwrite a real one with it.
    const name = (row as ExchangeWarehouseRow).keepExistingName ? current.name : row.name;
    if (current.code === row.code && current.name === name
      && current.is_active === row.isActive && deletionStateMatches) return NO_CHANGE;
    await client.query(
      `UPDATE app.warehouses SET code = $2, name = $3, is_active = $4,
              deleted_at = CASE WHEN $4 THEN NULL ELSE COALESCE(deleted_at, clock_timestamp()) END,
              source_version = source_version + 1 WHERE id = $1`,
      [current.id, row.code, name, row.isActive],
    );
    return { applied: true, rejected: false, uncategorized: false };
  }

  private async applyProduct(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "product" }>,
    placement: PlacementContext,
    source:OneCSource="one_c",
  ): Promise<RowOutcome> {
    const brand = row.brandExternalId
      ? (await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM app.brands WHERE external_id = $1", [row.brandExternalId],
        )).rows[0] ?? null
      : null;
    const brandId = brand?.id ?? null;

    // One storefront tree: staff mapping of the 1С group, then the group's
    // (and parent groups') names, then the product name, then «Без
    // категории» -- see catalog-recategorize.service.ts placeProduct.
    const placed = placeProduct(placement, {
      brandName: brand?.name ?? null, groupExternalId: row.categoryExternalId, productName: row.name, sku: row.sku, source,
    });
    let categoryId = placed.categoryId;
    const uncategorized = placed.source === "none" || categoryId === null;
    const groupDangling = placed.danglingGroup;

    // A dangling brand/category reference degrades to an unlinked product
    // rather than dropping it: 40,000 SKUs must not lose one because of a
    // single bad cross-reference elsewhere in the file. Still surfaced via
    // rows_rejected so it is visible in the run's counters, not silent.
    const rejected = (row.brandExternalId !== null && brandId === null) || groupDangling;
    const attributesJson = JSON.stringify(row.attributes);
    const current = (await client.query<{
      attributes: Record<string, unknown>; brand_id: string | null; category_id: string | null; category_pinned: boolean;
      deleted_at: Date | null; description: string | null; id: string; is_active: boolean; name: string;
      one_c_group_external_id: string | null; search_text: string | null;
      sku: string; slug: string;
    }>(
      `SELECT id, sku::text, name, slug::text, brand_id, category_id, description, attributes, search_text,
              is_active, deleted_at, one_c_group_external_id, category_pinned
       FROM app.products WHERE external_id = $1 AND one_c_source=${sourceSql(source)} FOR UPDATE`,
      [row.externalId],
    )).rows[0];
    if (!current) {
      await client.query(
        `INSERT INTO app.products (
           external_id, sku, name, slug, brand_id, category_id, description, attributes, search_text,
           is_active, source_version, deleted_at,one_c_source, one_c_group_external_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 1,
           CASE WHEN $10 THEN NULL ELSE clock_timestamp() END,$11,$12)`,
        [row.externalId, row.sku, row.name, row.slug, brandId, categoryId, row.description,
          attributesJson, row.searchText, row.isActive,source, row.categoryExternalId],
      );
      return { applied: true, rejected, uncategorized };
    }
    // A section a staff member chose for this product by hand stays.
    if (current.category_pinned) categoryId = current.category_id;
    const unchanged = current.sku === row.sku && current.name === row.name && current.slug === row.slug
      && current.brand_id === brandId && current.category_id === categoryId
      && current.description === row.description && current.search_text === row.searchText
      && current.is_active === row.isActive
      && (row.isActive ? current.deleted_at === null : current.deleted_at !== null)
      && (current.one_c_group_external_id ?? null) === row.categoryExternalId
      && canonicalJson(current.attributes) === canonicalJson(row.attributes);
    if (unchanged) return { applied: false, rejected, uncategorized };
    await client.query(
      `UPDATE app.products SET sku = $2, name = $3, slug = $4, brand_id = $5, category_id = $6, description = $7,
              attributes = $8::jsonb, search_text = $9, is_active = $10,
              deleted_at = CASE WHEN $10 THEN NULL ELSE COALESCE(deleted_at, clock_timestamp()) END,
              source_version = source_version + 1, one_c_group_external_id = $12
       WHERE id = $1 AND one_c_source=$11`,
      [current.id, row.sku, row.name, row.slug, brandId, categoryId, row.description,
        attributesJson, row.searchText, row.isActive,source, row.categoryExternalId],
    );
    return { applied: true, rejected, uncategorized };
  }

  private async applyPrice(
    client: PoolClient,
    row: Extract<OneCCatalogRow, { entityType: "price" }>,
    source:OneCSource="one_c",
  ): Promise<RowOutcome> {
    const productId = (await client.query<{ id: string }>(
      `SELECT id FROM app.products WHERE external_id = $1 AND one_c_source=${sourceSql(source)}`, [row.productExternalId],
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
    source:OneCSource="one_c",
  ): Promise<RowOutcome> {
    const productId = (await client.query<{ id: string }>(
      `SELECT id FROM app.products WHERE external_id = $1 AND one_c_source=${sourceSql(source)}`, [row.productExternalId],
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
    // A zero for a warehouse this product never had stock on (e.g. the
    // synthetic flat-stock warehouse once 1C reports named warehouses) is not
    // worth a balance row.
    if (!current && row.quantityOnHand === 0) return NO_CHANGE;
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

/** Every <Картинка> of the run's products, in product order: the images phase's cursor indexes this list. */
function imageTasks(run: ExchangeRunRow): ImageTask[] {
  return run.body_rows.flatMap((row) => row.entityType === "product"
    ? ((row as ExchangeProductRow).imagePaths ?? []).map((path, sortOrder) => ({
        path, productExternalId: row.externalId, sortOrder,
      }))
    : []);
}
