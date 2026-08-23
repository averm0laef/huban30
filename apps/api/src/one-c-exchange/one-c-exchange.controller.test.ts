// End-to-end proof that a CommerceML export from 1C actually lands in the
// database, driven through the real four-step protocol (checkauth -> init
// -> file -> import) against the real controller, the real service, the
// real commerce-ml.parser.ts and the real OneCExchangeTempStorageService
// (which writes genuine chunk files to a temp directory on disk).
//
// There is no Postgres available in this sandbox (no Docker, no local
// `psql`; see the task notes), and every existing apps/api test in this repo
// already follows the same convention (e.g. catalog-public.service.test.ts):
// a hand-rolled fake standing in for DatabaseService's `query`/`transaction`
// contract rather than a real connection. This file follows that same
// convention, scaled up to a small in-memory relational model (Maps keyed
// like the real tables) that the fake's `query()` dispatches into by
// matching the exact SQL text OneCExchangeService and OneCIntegrationService
// issue -- so what is under test is the *application* code path (routing,
// auth/session handshake, chunked resumable apply, delta-vs-snapshot logic),
// not PostgreSQL itself. Redis (rate limiting, the checkauth session cookie)
// is stubbed the same way, and PasswordService is used for real -- it is
// pure crypto with no external dependency.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ConfigService } from "@nestjs/config";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OneCCatalogRow } from "@an30/contracts";

import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import {
  KNOWN_CATALOG_CATEGORIES,
  UNCATEGORIZED_CATEGORY_LABEL,
  UNCATEGORIZED_CATEGORY_SLUG,
} from "../catalog/catalog-known-categories.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { RedisService } from "../infrastructure/redis.service.js";
import { PasswordService } from "../security/password.service.js";
import type { RateLimitService } from "../security/rate-limit.service.js";
import type { AuditService } from "../security/audit.service.js";
import { OneCExchangeSessionService } from "./one-c-exchange-session.service.js";
import { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";
import { OneCExchangeController } from "./one-c-exchange.controller.js";
import { OneCExchangeService } from "./one-c-exchange.service.js";

const USERNAME = "shop-1c-exchange";
const PASSWORD = "correct horse battery staple 2026";
const CLIENT_IP = "127.0.0.1";

// ---------------------------------------------------------------------------
// Fixtures: a small but structurally real CommerceML 2 export -- a two-level
// category tree, three products across two brands in import.xml, and prices
// + stock for all three in offers.xml.
// ---------------------------------------------------------------------------

function importXml(timestamp = "2026-08-01T03:00:00"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ДатаФормирования="${timestamp}">
  <Классификатор>
    <Группы>
      <Группа>
        <Ид>cat-brakes</Ид>
        <Наименование>Тормозная система</Наименование>
        <Группы>
          <Группа>
            <Ид>cat-pads</Ид>
            <Наименование>Колодки тормозные</Наименование>
          </Группа>
        </Группы>
      </Группа>
    </Группы>
  </Классификатор>
  <Каталог СодержитТолькоИзменения="false">
    <Товары>
      <Товар>
        <Ид>prod-1</Ид>
        <Артикул>BP-001</Артикул>
        <Наименование>Колодки тормозные передние Bosch</Наименование>
        <Изготовитель><Наименование>Bosch</Наименование></Изготовитель>
        <Группы><Ид>cat-pads</Ид></Группы>
      </Товар>
      <Товар>
        <Ид>prod-2</Ид>
        <Артикул>BP-002</Артикул>
        <Наименование>Колодки тормозные задние NGK</Наименование>
        <Изготовитель><Наименование>NGK</Наименование></Изготовитель>
        <Группы><Ид>cat-pads</Ид></Группы>
      </Товар>
      <Товар>
        <Ид>prod-3</Ид>
        <Артикул>BP-003</Артикул>
        <Наименование>Диск тормозной Bosch</Наименование>
        <Изготовитель><Наименование>Bosch</Наименование></Изготовитель>
        <Группы><Ид>cat-brakes</Ид></Группы>
      </Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
}

function offersXml(options: { includeProd3: boolean; prod3Quantity?: string | null; timestamp: string }): string {
  const prod3Quantity = options.prod3Quantity === undefined ? "7" : options.prod3Quantity;
  const prod3Offer = options.includeProd3
    ? `
      <Предложение>
        <Ид>prod-3</Ид>
        <Цены><Цена><ЦенаЗаЕдиницу>3200.00</ЦенаЗаЕдиницу></Цена></Цены>
        ${prod3Quantity === null ? "" : `<Количество>${prod3Quantity}</Количество>`}
      </Предложение>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ДатаФормирования="${options.timestamp}">
  <ПакетПредложений СодержитТолькоИзменения="false">
    <Предложения>
      <Предложение>
        <Ид>prod-1</Ид>
        <Цены><Цена><ЦенаЗаЕдиницу>1250.50</ЦенаЗаЕдиницу></Цена></Цены>
        <Количество>12</Количество>
      </Предложение>
      <Предложение>
        <Ид>prod-2</Ид>
        <Цены><Цена><ЦенаЗаЕдиницу>980.00</ЦенаЗаЕдиницу></Цена></Цены>
        <Количество>5</Количество>
      </Предложение>${prod3Offer}
    </Предложения>
  </ПакетПредложений>
</КоммерческаяИнформация>`;
}

// ---------------------------------------------------------------------------
// Fake database: a small relational model behind DatabaseService's contract,
// scoped exactly to the SQL OneCExchangeService and OneCIntegrationService
// issue (both written for this task, so the shapes are known and stable).
// ---------------------------------------------------------------------------

interface BrandRow {
  deleted_at: Date | null; external_id: string; id: string; is_active: boolean; name: string; slug: string;
}
interface CategoryRow {
  // external_id is null for the seeded fallback categories (they are not
  // sourced from 1С -- see migration 0024) and for a test-seeded junk group
  // that stands in for one imported by an earlier, separate run.
  deleted_at: Date | null; description: string | null; external_id: string | null; id: string;
  is_active: boolean; name: string; parent_id: string | null; slug: string; sort_order: number;
}
interface WarehouseRow {
  code: string; deleted_at: Date | null; external_id: string; id: string; is_active: boolean; name: string;
}
interface ProductRow {
  attributes: Record<string, unknown>; brand_id: string | null; category_id: string | null;
  deleted_at: Date | null; description: string | null; external_id: string; id: string;
  is_active: boolean; name: string; search_text: string | null; sku: string; slug: string;
}
interface PriceRow { amount_kopeks: number; currency: string; id: string; product_id: string; valid_to: Date | null }
interface BalanceRow { product_id: string; quantity_on_hand: number; quantity_reserved: number; warehouse_id: string }
interface RunRow {
  batch_size: number; body_rows: OneCCatalogRow[]; contains_only_changes: boolean;
  content_checksum: Buffer; cursor_index: number; error_message: string | null; filename: string;
  header_rows: OneCCatalogRow[]; id: string; kind: string; phase: string; rows_rejected: number;
  rows_touched: number; rows_uncategorized: number; status: string; tail_rows: OneCCatalogRow[] | null;
}
interface IntegrationRow {
  allowed_networks: string[]; is_enabled: boolean; last_exchange_at: Date | null;
  last_exchange_summary: Record<string, unknown>; secret_hash: Buffer | null; updated_at: Date;
  username: string | null;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  const baseInt = base ? ipv4ToInt(base) : null;
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null || !Number.isInteger(prefix)) return false;
  if (prefix <= 0) return true;
  const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

class FakeCatalogDatabase {
  readonly balances = new Map<string, BalanceRow>();
  readonly brands = new Map<string, BrandRow>();
  readonly categories = new Map<string, CategoryRow>();
  readonly integration: IntegrationRow = {
    allowed_networks: [], is_enabled: false, last_exchange_at: null,
    last_exchange_summary: {}, secret_hash: null, updated_at: new Date(), username: null,
  };
  readonly inventoryEvents: Array<Record<string, unknown>> = [];
  readonly prices = new Map<string, PriceRow>();
  readonly products = new Map<string, ProductRow>();
  readonly requestLog: Array<Record<string, unknown>> = [];
  readonly runs = new Map<string, RunRow>();
  readonly warehouses = new Map<string, WarehouseRow>();

  private byExternalId<T extends { external_id: string | null }>(map: Map<string, T>, externalId: string): T | undefined {
    return [...map.values()].find((row) => row.external_id === externalId);
  }

  async query<Row extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    const sql = normalize(text);
    const rows = this.dispatch(sql, values);
    return { rows: rows as Row[] };
  }

  async transaction<T>(work: (client: { query: FakeCatalogDatabase["query"] }) => Promise<T>): Promise<T> {
    return work({ query: this.query.bind(this) });
  }

  // Returns `unknown[]` rather than `Array<Record<string, unknown>>`: each
  // branch below returns a concrete row interface (BrandRow, RunRow, ...)
  // with no index signature, which structurally cannot satisfy
  // `Record<string, unknown>` even though every field is known -- `query()`
  // above casts to the caller's requested row type at the one place that
  // actually needs it.
  private dispatch(sql: string, values: unknown[]): unknown[] {
    // -- app.integration_endpoints -----------------------------------------
    if (sql.includes("FROM app.integration_endpoints") && sql.includes("ip_allowed")) {
      const ip = values[0] as string;
      const ipAllowed = this.integration.allowed_networks.some((cidr) => cidrContains(cidr, ip));
      return [{ ...this.integration, ip_allowed: ipAllowed }];
    }
    if (sql.startsWith("UPDATE app.integration_endpoints SET last_used_at")) {
      this.integration.updated_at = new Date();
      return [];
    }
    if (sql.includes("SET last_exchange_at = clock_timestamp()")) {
      this.integration.last_exchange_at = new Date();
      this.integration.last_exchange_summary = JSON.parse(values[0] as string) as Record<string, unknown>;
      return [];
    }
    if (sql.startsWith("INSERT INTO app.integration_request_log (")) {
      this.requestLog.push({ values });
      return [];
    }

    // -- app.one_c_exchange_runs --------------------------------------------
    if (sql.includes("FROM app.one_c_exchange_runs WHERE kind = $1 AND content_checksum = $2")) {
      const [kind, checksum] = values as [string, Buffer];
      const found = [...this.runs.values()].find((run) => run.kind === kind && run.content_checksum.equals(checksum));
      return found ? [found] : [];
    }
    if (sql.startsWith("INSERT INTO app.one_c_exchange_runs (")) {
      const [kind, filename, checksum, containsOnlyChanges, exportedAt, batchSize, headerRowsJson, bodyRowsJson] = values as [
        string, string, Buffer, boolean, string, number, string, string,
      ];
      const duplicate = [...this.runs.values()].some((run) => run.kind === kind && run.content_checksum.equals(checksum));
      if (duplicate) {
        const error = new Error("duplicate key value violates unique constraint") as Error & { code: string };
        error.code = "23505";
        throw error;
      }
      const row: RunRow = {
        batch_size: batchSize, body_rows: JSON.parse(bodyRowsJson) as OneCCatalogRow[], contains_only_changes: containsOnlyChanges,
        content_checksum: checksum, cursor_index: 0, error_message: null, filename,
        header_rows: JSON.parse(headerRowsJson) as OneCCatalogRow[], id: randomUUID(), kind,
        phase: "header", rows_rejected: 0, rows_touched: 0, rows_uncategorized: 0,
        status: "running", tail_rows: null,
      };
      void exportedAt;
      this.runs.set(row.id, row);
      return [row];
    }
    if (sql.includes("SET cursor_index = $2, rows_touched = rows_touched + $3")) {
      const [id, cursorIndex, touched, rejected, uncategorized] = values as [
        string, number, number, number, number,
      ];
      const run = this.mustRun(id);
      run.cursor_index = cursorIndex;
      run.rows_touched += touched;
      run.rows_rejected += rejected;
      run.rows_uncategorized += uncategorized;
      return [];
    }
    if (sql.includes("cursor_index = 0, tail_rows = $3::jsonb")) {
      const [id, phase, tailRowsJson] = values as [string, string, string];
      const run = this.mustRun(id);
      run.phase = phase;
      run.cursor_index = 0;
      run.tail_rows = JSON.parse(tailRowsJson) as OneCCatalogRow[];
      return [];
    }
    if (sql.includes("cursor_index = 0 WHERE id = $1")) {
      const [id, phase] = values as [string, string];
      const run = this.mustRun(id);
      run.phase = phase;
      run.cursor_index = 0;
      return [];
    }
    if (sql.includes("phase = 'done', status = 'completed'")) {
      const [id] = values as [string];
      const run = this.mustRun(id);
      run.phase = "done";
      run.status = "completed";
      return [{
        rows_rejected: run.rows_rejected, rows_touched: run.rows_touched,
        rows_uncategorized: run.rows_uncategorized,
      }];
    }
    if (sql.includes("status = 'failed', error_message = $2")) {
      const [id, reason] = values as [string, string];
      const run = this.mustRun(id);
      run.status = "failed";
      run.error_message = reason;
      return [];
    }

    // -- tail-row computation (products with stale, still-nonzero stock) ---
    if (sql.includes("FROM app.inventory_balances AS balance")) {
      const [warehouseExternalId] = values as [string];
      const warehouse = this.byExternalId(this.warehouses, warehouseExternalId);
      if (!warehouse) return [];
      return [...this.balances.values()]
        .filter((balance) => balance.warehouse_id === warehouse.id && balance.quantity_on_hand !== 0)
        .map((balance) => this.products.get(balance.product_id))
        .filter((product): product is ProductRow => Boolean(product))
        .map((product) => ({ external_id: product.external_id }));
    }

    // -- app.brands -----------------------------------------------------------
    if (sql.includes("SELECT id, name, slug::text, is_active, deleted_at FROM app.brands")) {
      const found = this.byExternalId(this.brands, values[0] as string);
      return found ? [found] : [];
    }
    if (sql.startsWith("INSERT INTO app.brands (")) {
      const [externalId, name, slug, isActive] = values as [string, string, string, boolean];
      const row: BrandRow = {
        deleted_at: isActive ? null : new Date(), external_id: externalId, id: randomUUID(),
        is_active: isActive, name, slug,
      };
      this.brands.set(row.id, row);
      return [];
    }
    if (sql.startsWith("UPDATE app.brands SET name")) {
      const [id, name, slug, isActive] = values as [string, string, string, boolean];
      const row = this.brands.get(id)!;
      row.name = name; row.slug = slug; row.is_active = isActive;
      row.deleted_at = isActive ? null : row.deleted_at ?? new Date();
      return [];
    }
    if (sql === "SELECT id FROM app.brands WHERE external_id = $1") {
      const found = this.byExternalId(this.brands, values[0] as string);
      return found ? [{ id: found.id }] : [];
    }

    // -- app.categories -------------------------------------------------------
    if (sql.includes("SELECT id, parent_id, name, slug::text, description, sort_order, is_active")) {
      const found = this.byExternalId(this.categories, values[0] as string);
      return found ? [found] : [];
    }
    if (sql.startsWith("INSERT INTO app.categories (")) {
      const [externalId, parentId, name, slug, description, sortOrder, isActive] = values as [
        string, string | null, string, string, string | null, number, boolean,
      ];
      const row: CategoryRow = {
        deleted_at: isActive ? null : new Date(), description, external_id: externalId,
        id: randomUUID(), is_active: isActive,
        name, parent_id: parentId, slug, sort_order: sortOrder,
      };
      this.categories.set(row.id, row);
      return [];
    }
    if (sql.startsWith("UPDATE app.categories SET parent_id")) {
      const [id, parentId, name, slug, description, sortOrder, isActive] = values as [
        string, string | null, string, string, string | null, number, boolean,
      ];
      const row = this.categories.get(id)!;
      row.parent_id = parentId; row.name = name; row.slug = slug;
      row.description = description; row.sort_order = sortOrder; row.is_active = isActive;
      row.deleted_at = isActive ? null : row.deleted_at ?? new Date();
      return [];
    }
    // applyCategory's own parent-category lookup (category header rows).
    if (sql === "SELECT id FROM app.categories WHERE external_id = $1") {
      const found = this.byExternalId(this.categories, values[0] as string);
      return found ? [{ id: found.id }] : [];
    }
    // applyProduct's group lookup -- also needs the group's name, to decide
    // whether it is a junk catch-all (see isJunkCategoryGroupName).
    if (sql === "SELECT id, name FROM app.categories WHERE external_id = $1") {
      const found = this.byExternalId(this.categories, values[0] as string);
      return found ? [{ id: found.id, name: found.name }] : [];
    }
    // Batch fetch for applyProduct's category fallback (loadKnownCategoryIds)
    // -- one call per chunk, not per row, mirroring migration 0024's seeded
    // twelve known categories plus "Без категории".
    if (sql === "SELECT id, slug::text AS slug FROM app.categories WHERE slug::text = ANY($1::text[])") {
      const slugs = new Set(values[0] as string[]);
      return [...this.categories.values()]
        .filter((row) => slugs.has(row.slug))
        .map((row) => ({ id: row.id, slug: row.slug }));
    }

    // -- app.warehouses ---------------------------------------------------------
    if (sql.includes("SELECT id, code::text, name, is_active, deleted_at FROM app.warehouses")) {
      const found = this.byExternalId(this.warehouses, values[0] as string);
      return found ? [found] : [];
    }
    if (sql.startsWith("INSERT INTO app.warehouses (")) {
      const [externalId, code, name, isActive] = values as [string, string, string, boolean];
      const row: WarehouseRow = {
        code, deleted_at: isActive ? null : new Date(), external_id: externalId,
        id: randomUUID(), is_active: isActive, name,
      };
      this.warehouses.set(row.id, row);
      return [];
    }
    if (sql.startsWith("UPDATE app.warehouses SET code")) {
      const [id, code, name, isActive] = values as [string, string, string, boolean];
      const row = this.warehouses.get(id)!;
      row.code = code; row.name = name; row.is_active = isActive;
      row.deleted_at = isActive ? null : row.deleted_at ?? new Date();
      return [];
    }
    if (sql === "SELECT id FROM app.warehouses WHERE external_id = $1") {
      const found = this.byExternalId(this.warehouses, values[0] as string);
      return found ? [{ id: found.id }] : [];
    }

    // -- app.products -----------------------------------------------------------
    if (sql.includes("SELECT id, sku::text, name, slug::text, brand_id, category_id")) {
      const found = this.byExternalId(this.products, values[0] as string);
      return found ? [found] : [];
    }
    if (sql.startsWith("INSERT INTO app.products (")) {
      const [externalId, sku, name, slug, brandId, categoryId, description, attributesJson, searchText, isActive] = values as [
        string, string, string, string, string | null, string | null, string | null, string, string | null, boolean,
      ];
      const row: ProductRow = {
        attributes: JSON.parse(attributesJson) as Record<string, unknown>, brand_id: brandId, category_id: categoryId,
        deleted_at: isActive ? null : new Date(), description, external_id: externalId,
        id: randomUUID(), is_active: isActive, name, search_text: searchText, sku, slug,
      };
      this.products.set(row.id, row);
      return [];
    }
    if (sql.startsWith("UPDATE app.products SET sku")) {
      const [id, sku, name, slug, brandId, categoryId, description, attributesJson, searchText, isActive] = values as [
        string, string, string, string, string | null, string | null, string | null, string, string | null, boolean,
      ];
      const row = this.products.get(id)!;
      row.sku = sku; row.name = name; row.slug = slug; row.brand_id = brandId; row.category_id = categoryId;
      row.description = description; row.attributes = JSON.parse(attributesJson) as Record<string, unknown>;
      row.search_text = searchText; row.is_active = isActive;
      row.deleted_at = isActive ? null : row.deleted_at ?? new Date();
      return [];
    }
    if (sql === "SELECT id FROM app.products WHERE external_id = $1") {
      const found = this.byExternalId(this.products, values[0] as string);
      return found ? [{ id: found.id }] : [];
    }

    // -- app.product_prices -------------------------------------------------------
    if (sql.includes("FROM app.product_prices WHERE product_id")) {
      const [productId, currency] = values as [string, string];
      const found = [...this.prices.values()].find((price) => (
        price.product_id === productId && price.currency === currency && price.valid_to === null
      ));
      return found ? [{ amount_kopeks: String(found.amount_kopeks), id: found.id }] : [];
    }
    if (sql.startsWith("UPDATE app.product_prices SET valid_to")) {
      const [id, validTo] = values as [string, Date];
      this.prices.get(id)!.valid_to = validTo;
      return [];
    }
    if (sql.startsWith("INSERT INTO app.product_prices (")) {
      const [productId, amountKopeks, currency] = values as [string, number, string];
      const row: PriceRow = { amount_kopeks: amountKopeks, currency, id: randomUUID(), product_id: productId, valid_to: null };
      this.prices.set(row.id, row);
      return [];
    }

    // -- app.inventory_balances / app.inventory_events -----------------------------
    if (sql.includes("SELECT quantity_on_hand, quantity_reserved FROM app.inventory_balances")) {
      const [productId, warehouseId] = values as [string, string];
      const found = this.balances.get(`${productId}:${warehouseId}`);
      return found ? [found] : [];
    }
    if (sql.startsWith("UPDATE app.inventory_balances SET quantity_on_hand")) {
      const [productId, warehouseId, quantity] = values as [string, string, number];
      const row = this.balances.get(`${productId}:${warehouseId}`)!;
      row.quantity_on_hand = quantity;
      return [];
    }
    if (sql.startsWith("INSERT INTO app.inventory_balances (")) {
      const [productId, warehouseId, quantity] = values as [string, string, number];
      this.balances.set(`${productId}:${warehouseId}`, {
        product_id: productId, quantity_on_hand: quantity, quantity_reserved: 0, warehouse_id: warehouseId,
      });
      return [];
    }
    if (sql.startsWith("INSERT INTO app.inventory_events (")) {
      this.inventoryEvents.push({ values });
      return [];
    }

    throw new Error(`FakeCatalogDatabase received an unrecognised query: ${sql}`);
  }

  private mustRun(id: string): RunRow {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown exchange run ${id}`);
    return run;
  }
}

// ---------------------------------------------------------------------------
// Fastify request/reply doubles -- just enough surface for the controller.
// ---------------------------------------------------------------------------

function fakeRequest(options: { authorization?: string; body?: Buffer; cookie?: [string, string] }): FastifyRequest {
  return {
    body: options.body,
    cookies: options.cookie ? { [options.cookie[0]]: options.cookie[1] } : {},
    headers: options.authorization ? { authorization: options.authorization } : {},
    ip: CLIENT_IP,
  } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply {
  return {
    header: () => undefined,
    setCookie: () => undefined,
    status: () => undefined,
    type: () => undefined,
  } as unknown as FastifyReply;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Harness: real controller/service/session/temp-storage wiring over the fake
// database and a fake Redis, mirroring how one-c-exchange.module.ts wires
// the real providers together.
// ---------------------------------------------------------------------------

async function createHarness() {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "an30-one-c-exchange-"));
  const config = {
    get: (key: string) => (key === "COOKIE_SECURE" ? false : undefined),
    getOrThrow: (key: string) => {
      if (key === "STORAGE_ROOT") return storageRoot;
      throw new Error(`Unexpected config key requested in test: ${key}`);
    },
  } as unknown as ConfigService;

  const database = new FakeCatalogDatabase();
  const passwords = new PasswordService();
  database.integration.is_enabled = true;
  database.integration.username = USERNAME;
  database.integration.secret_hash = Buffer.from(await passwords.hash(PASSWORD), "utf8");
  database.integration.allowed_networks = ["127.0.0.1/32"];

  const audit = { record: async () => undefined } as unknown as AuditService;
  const rateLimit = { consume: async () => undefined } as unknown as RateLimitService;
  const redisValues = new Map<string, string>();
  const redis = {
    client: {
      expire: async (key: string) => (redisValues.has(key) ? 1 : 0),
      get: async (key: string) => redisValues.get(key) ?? null,
      set: async (key: string, value: string) => { redisValues.set(key, value); return "OK"; },
    },
    ensureConnected: async () => undefined,
  } as unknown as RedisService;

  const integration = new OneCIntegrationService(audit, database as unknown as DatabaseService, passwords, rateLimit);
  const categoryTreeCache = new CatalogCategoryTreeCache();
  const exchange = new OneCExchangeService(categoryTreeCache, database as unknown as DatabaseService, integration);
  const session = new OneCExchangeSessionService(redis);
  const tempStorage = new OneCExchangeTempStorageService(config);
  const controller = new OneCExchangeController(config, exchange, integration, rateLimit, session, tempStorage);

  return { controller, database, exchange, storageRoot, tempStorage };
}

type Harness = Awaited<ReturnType<typeof createHarness>>;

async function applyCatalogRowForRegression(
  harness: Harness,
  row: OneCCatalogRow,
  knownCategories: ReadonlyMap<string, string> = new Map(),
) {
  const exchange = harness.exchange as unknown as {
    applyRow(
      client: { query: FakeCatalogDatabase["query"] },
      catalogRow: OneCCatalogRow,
      categories: ReadonlyMap<string, string>,
    ): Promise<{ applied: boolean; rejected: boolean; uncategorized: boolean }>;
  };
  return exchange.applyRow(
    { query: harness.database.query.bind(harness.database) },
    row,
    knownCategories,
  );
}

async function checkauth(harness: Harness): Promise<{ cookieName: string; cookieValue: string }> {
  const reply = fakeReply();
  const response = await harness.controller.get(
    { mode: "checkauth", type: "catalog" },
    fakeRequest({ authorization: basicAuthHeader(USERNAME, PASSWORD) }),
    reply,
  );
  const [status, cookieName, cookieValue] = response.split("\n");
  expect(status).toBe("success");
  if (!cookieName || !cookieValue) throw new Error(`checkauth did not return a cookie: ${response}`);
  return { cookieName, cookieValue };
}

async function init(harness: Harness, cookie: [string, string]): Promise<void> {
  const response = await harness.controller.get(
    { mode: "init", type: "catalog" },
    fakeRequest({ cookie }),
    fakeReply(),
  );
  expect(response).toMatch(/^zip=no\nfile_limit=\d+$/u);
}

async function uploadFile(harness: Harness, cookie: [string, string], filename: string, content: string): Promise<void> {
  const buffer = Buffer.from(content, "utf8");
  // Split into two chunks to exercise real multi-POST assembly, the same way
  // 1C splits a file larger than its configured chunk size across several
  // mode=file requests for the same filename.
  const midpoint = Math.ceil(buffer.length / 2);
  for (const chunk of [buffer.subarray(0, midpoint), buffer.subarray(midpoint)]) {
    const response = await harness.controller.post(
      { filename, mode: "file", type: "catalog" },
      fakeRequest({ body: chunk, cookie }),
      fakeReply(),
    );
    expect(response).toBe("success");
  }
}

async function runImportToCompletion(harness: Harness, cookie: [string, string], filename: string): Promise<void> {
  for (let poll = 0; poll < 500; poll += 1) {
    const response = await harness.controller.get(
      { filename, mode: "import", type: "catalog" },
      fakeRequest({ cookie }),
      fakeReply(),
    );
    if (response === "success") return;
    if (response.startsWith("failure")) throw new Error(`1C exchange import failed: ${response}`);
    expect(response.startsWith("progress\n")).toBe(true);
  }
  throw new Error("Import did not reach 'success' within the poll budget");
}

async function driveFullSequence(harness: Harness, filename: string, content: string): Promise<void> {
  const { cookieName, cookieValue } = await checkauth(harness);
  const cookie: [string, string] = [cookieName, cookieValue];
  await init(harness, cookie);
  await uploadFile(harness, cookie, filename, content);
  await runImportToCompletion(harness, cookie, filename);
}

// ---------------------------------------------------------------------------

describe("OneCExchangeController end-to-end (checkauth -> init -> file -> import)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
    await driveFullSequence(harness, "import_files/session-1/import.xml", importXml());
    await driveFullSequence(
      harness,
      "import_files/session-1/offers.xml",
      offersXml({ includeProd3: true, timestamp: "2026-08-01T03:05:00" }),
    );
  });

  afterAll(async () => {
    await rm(harness.storageRoot, { force: true, recursive: true });
  });

  it("lands categories, brands, products, prices and stock in the database", () => {
    const { database } = harness;

    expect(database.categories.size).toBe(2);
    const brakes = [...database.categories.values()].find((row) => row.external_id === "cat-brakes")!;
    const pads = [...database.categories.values()].find((row) => row.external_id === "cat-pads")!;
    expect(brakes.parent_id).toBeNull();
    expect(pads.parent_id).toBe(brakes.id);

    expect(database.brands.size).toBe(2);
    const brandNames = new Set([...database.brands.values()].map((row) => row.name.toUpperCase()));
    expect(brandNames.has("BOSCH")).toBe(true);
    expect(brandNames.has("NGK")).toBe(true);

    expect(database.products.size).toBe(3);
    const prod1 = [...database.products.values()].find((row) => row.external_id === "prod-1")!;
    const prod2 = [...database.products.values()].find((row) => row.external_id === "prod-2")!;
    const prod3 = [...database.products.values()].find((row) => row.external_id === "prod-3")!;
    expect(prod1.sku).toBe("BP-001");
    expect(prod1.category_id).toBe(pads.id);
    expect(prod3.category_id).toBe(brakes.id);

    const warehouse = [...database.warehouses.values()][0]!;
    expect(warehouse.code).toBe("1C");

    const priceFor = (productId: string) => [...database.prices.values()]
      .find((price) => price.product_id === productId && price.valid_to === null)!;
    expect(priceFor(prod1.id).amount_kopeks).toBe(125_050);
    expect(priceFor(prod2.id).amount_kopeks).toBe(98_000);
    expect(priceFor(prod3.id).amount_kopeks).toBe(320_000);

    const balanceFor = (productId: string) => database.balances.get(`${productId}:${warehouse.id}`)!;
    expect(balanceFor(prod1.id).quantity_on_hand).toBe(12);
    expect(balanceFor(prod2.id).quantity_on_hand).toBe(5);
    expect(balanceFor(prod3.id).quantity_on_hand).toBe(7);

    const summary = database.integration.last_exchange_summary as { rowsTouched: number };
    expect(database.integration.last_exchange_at).not.toBeNull();
    expect(summary.rowsTouched).toBeGreaterThan(0);
  });

  it("does not duplicate anything when the exact same files are re-sent", async () => {
    const { database } = harness;
    const productsBefore = database.products.size;
    const categoriesBefore = database.categories.size;
    const brandsBefore = database.brands.size;
    const pricesBefore = database.prices.size;
    const catalogRunsBefore = [...database.runs.values()].filter((run) => run.kind === "catalog").length;
    const offersRunsBefore = [...database.runs.values()].filter((run) => run.kind === "offers").length;

    // A fresh 1C session: checkauth -> init (purges temp storage) -> the
    // byte-identical files again -> import. Idempotency is keyed off the
    // file's content checksum, not off "did init already run this file".
    await driveFullSequence(harness, "import_files/session-2/import.xml", importXml());
    await driveFullSequence(
      harness,
      "import_files/session-2/offers.xml",
      offersXml({ includeProd3: true, timestamp: "2026-08-01T03:05:00" }),
    );

    expect(database.products.size).toBe(productsBefore);
    expect(database.categories.size).toBe(categoriesBefore);
    expect(database.brands.size).toBe(brandsBefore);
    // Re-applying an unchanged price is a no-op (no new valid_from row) --
    // this is what stops a re-synced, unchanged catalog from growing price
    // history forever.
    expect(database.prices.size).toBe(pricesBefore);
    // Same checksum -> the existing 'completed' run is reused, not a new row.
    expect([...database.runs.values()].filter((run) => run.kind === "catalog").length).toBe(catalogRunsBefore);
    expect([...database.runs.values()].filter((run) => run.kind === "offers").length).toBe(offersRunsBefore);
  });

  it("keeps is_active and deleted_at synchronized for every CommerceML catalog entity", async () => {
    const { database } = harness;
    const brand = [...database.brands.values()].find((row) => row.name.toUpperCase() === "BOSCH")!;
    const category = [...database.categories.values()].find((row) => row.external_id === "cat-brakes")!;
    const warehouse = [...database.warehouses.values()][0]!;
    const product = [...database.products.values()].find((row) => row.external_id === "prod-3")!;
    const inactiveRows: OneCCatalogRow[] = [
      {
        entityType: "brand", externalId: brand.external_id, isActive: false,
        name: brand.name, slug: brand.slug, version: 1,
      },
      {
        // Non-null: found by external_id === "cat-brakes" above, so it is
        // never one of the (external_id: null) seeded fallback categories.
        description: category.description, entityType: "category", externalId: category.external_id!,
        isActive: false, name: category.name, parentExternalId: null, slug: category.slug,
        sortOrder: category.sort_order, version: 1,
      },
      {
        code: warehouse.code, entityType: "warehouse", externalId: warehouse.external_id,
        isActive: false, name: warehouse.name, version: 1,
      },
      {
        attributes: product.attributes, brandExternalId: brand.external_id,
        categoryExternalId: category.external_id, description: product.description,
        entityType: "product", externalId: product.external_id, isActive: false,
        name: product.name, searchText: product.search_text, sku: product.sku,
        slug: product.slug, version: 1,
      },
    ];

    for (const row of inactiveRows) {
      await expect(applyCatalogRowForRegression(harness, row)).resolves.toMatchObject({ applied: true });
    }
    const softDeleted = [brand, category, warehouse, product];
    expect(softDeleted.every((row) => !row.is_active && row.deleted_at instanceof Date)).toBe(true);
    const deletedAtBeforeReplay = softDeleted.map((row) => row.deleted_at!.getTime());

    // Replaying an unchanged inactive row is a true no-op: it must neither
    // bump source_version nor replace the original soft-deletion timestamp.
    for (const row of inactiveRows) {
      await expect(applyCatalogRowForRegression(harness, row)).resolves.toEqual({
        applied: false,
        rejected: false,
        uncategorized: false,
      });
    }
    expect(softDeleted.map((row) => row.deleted_at!.getTime())).toEqual(deletedAtBeforeReplay);

    // Simulate the live legacy state left by the old updater: a later active
    // export had already flipped is_active back to true but had not cleared
    // deleted_at. All business fields now match, so only deleted_at can make
    // the next active export non-"unchanged".
    for (const row of softDeleted) row.is_active = true;
    await driveFullSequence(
      harness,
      "import_files/session-soft-delete/import.xml",
      importXml("2026-08-05T03:00:00"),
    );
    await driveFullSequence(
      harness,
      "import_files/session-soft-delete/offers.xml",
      offersXml({ includeProd3: true, timestamp: "2026-08-05T03:05:00" }),
    );

    expect(softDeleted.every((row) => row.is_active && row.deleted_at === null)).toBe(true);
  });

  it("zeroes stock for a product missing from a full snapshot, without deleting it", async () => {
    const { database } = harness;
    const prod3 = [...database.products.values()].find((row) => row.external_id === "prod-3")!;
    const warehouse = [...database.warehouses.values()][0]!;
    expect(database.balances.get(`${prod3.id}:${warehouse.id}`)!.quantity_on_hand).toBe(7);

    // A full (СодержитТолькоИзменения=false) snapshot that simply omits
    // prod-3 -- exactly what 1C sends once a part is discontinued.
    await driveFullSequence(
      harness,
      "import_files/session-3/offers.xml",
      offersXml({ includeProd3: false, timestamp: "2026-08-02T03:05:00" }),
    );

    expect(database.balances.get(`${prod3.id}:${warehouse.id}`)!.quantity_on_hand).toBe(0);
    // Never hard-deleted: the product row, its brand/category link and its
    // price history are all still there -- only the stock went to zero.
    expect(database.products.has(prod3.id)).toBe(true);
    expect(database.products.get(prod3.id)!.is_active).toBe(true);
    const priceStillThere = [...database.prices.values()].some((price) => price.product_id === prod3.id);
    expect(priceStillThere).toBe(true);

    // prod-1 and prod-2, still present in this snapshot, are untouched.
    const prod1 = [...database.products.values()].find((row) => row.external_id === "prod-1")!;
    expect(database.balances.get(`${prod1.id}:${warehouse.id}`)!.quantity_on_hand).toBe(12);
  });

  it("does not zero stock for an offer that is present but omits optional Количество", async () => {
    const { database } = harness;
    const prod3 = [...database.products.values()].find((row) => row.external_id === "prod-3")!;
    const warehouse = [...database.warehouses.values()][0]!;

    // Restore the stock after the preceding omission test, then send a full
    // snapshot where the offer is present and priced but has no quantity.
    await driveFullSequence(
      harness,
      "import_files/session-4/offers.xml",
      offersXml({ includeProd3: true, timestamp: "2026-08-03T03:05:00" }),
    );
    expect(database.balances.get(`${prod3.id}:${warehouse.id}`)!.quantity_on_hand).toBe(7);

    await driveFullSequence(
      harness,
      "import_files/session-5/offers.xml",
      offersXml({ includeProd3: true, prod3Quantity: null, timestamp: "2026-08-04T03:05:00" }),
    );
    expect(database.balances.get(`${prod3.id}:${warehouse.id}`)!.quantity_on_hand).toBe(7);
  });

  it("rejects checkauth with the wrong password and never issues a session", async () => {
    const response = await harness.controller.get(
      { mode: "checkauth", type: "catalog" },
      fakeRequest({ authorization: basicAuthHeader(USERNAME, "wrong password entirely") }),
      fakeReply(),
    );
    expect(response).toBe("failure");
  });

  it("does not accept a valid exchange cookie from a different source IP", async () => {
    const { cookieName, cookieValue } = await checkauth(harness);
    const request = fakeRequest({ cookie: [cookieName, cookieValue] });
    Object.defineProperty(request, "ip", { value: "127.0.0.2" });
    const response = await harness.controller.get(
      { mode: "init", type: "catalog" },
      request,
      fakeReply(),
    );
    expect(response).toBe("failure\nАутентификация не пройдена");
  });

  it("fails closed on an unknown type/mode instead of guessing", async () => {
    const unknownType = await harness.controller.get(
      { mode: "checkauth", type: "sale" },
      fakeRequest({}),
      fakeReply(),
    );
    expect(unknownType).toBe("failure\nПоддерживается только type=catalog");
  });
});

// ---------------------------------------------------------------------------
// AN30-013: category assignment for products imported from 1С. A real
// import against staging showed applyProduct trusting 1С's <Группы> group
// and nothing else, which left three of four representative products
// unreachable by browsing -- see one-c-exchange.service.ts's module doc.
// This gets its own harness (not the shared one above) because it needs
// migration 0024's seeded fallback categories pre-populated, which the
// shared harness's own assertions (e.g. `database.categories.size`) must
// stay unaffected by.
// ---------------------------------------------------------------------------

function seedKnownCategories(database: FakeCatalogDatabase): void {
  const seeds = [
    ...KNOWN_CATALOG_CATEGORIES,
    { label: UNCATEGORIZED_CATEGORY_LABEL, slug: UNCATEGORIZED_CATEGORY_SLUG },
  ];
  for (const category of seeds) {
    const row: CategoryRow = {
      deleted_at: null, description: null, external_id: null, id: randomUUID(),
      is_active: true, name: category.label, parent_id: null, slug: category.slug, sort_order: 9000,
    };
    database.categories.set(row.id, row);
  }
}

function importXmlForCategoryFallback(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ДатаФормирования="2026-08-10T03:00:00">
  <Классификатор>
    <Группы>
      <Группа>
        <Ид>cat-brakes</Ид>
        <Наименование>Тормозная система</Наименование>
      </Группа>
      <Группа>
        <Ид>cat-junk</Ид>
        <Наименование>Товары</Наименование>
      </Группа>
    </Группы>
  </Классификатор>
  <Каталог СодержитТолькоИзменения="false">
    <Товары>
      <Товар>
        <Ид>prod-control</Ид>
        <Артикул>BRK-001</Артикул>
        <Наименование>Фильтр масляный Bosch</Наименование>
        <Группы><Ид>cat-brakes</Ид></Группы>
      </Товар>
      <Товар>
        <Ид>prod-nogroup</Ид>
        <Артикул>ACC-062</Артикул>
        <Наименование>Аккумулятор Тюмень 62Ач</Наименование>
      </Товар>
      <Товар>
        <Ид>prod-dangling</Ид>
        <Артикул>FLT-777</Артикул>
        <Наименование>Щётка стеклоочистителя Bosch 600мм</Наименование>
        <Группы><Ид>cat-missing</Ид></Группы>
      </Товар>
      <Товар>
        <Ид>prod-junk</Ид>
        <Артикул>ANF-120</Артикул>
        <Наименование>Антифриз G12</Наименование>
        <Группы><Ид>cat-junk</Ид></Группы>
      </Товар>
      <Товар>
        <Ид>prod-unrecognisable</Ид>
        <Артикул>STK-001</Артикул>
        <Наименование>Наклейка декоративная на бампер</Наименование>
      </Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
}

describe("OneCExchangeService category fallback (AN30-013)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
    seedKnownCategories(harness.database);
    await driveFullSequence(
      harness,
      "import_files/category-fallback/import.xml",
      importXmlForCategoryFallback(),
    );
  });

  afterAll(async () => {
    await rm(harness.storageRoot, { force: true, recursive: true });
  });

  function categorySlugFor(externalId: string): string | undefined {
    const product = [...harness.database.products.values()].find((row) => row.external_id === externalId);
    const category = product?.category_id
      ? [...harness.database.categories.values()].find((row) => row.id === product.category_id)
      : undefined;
    return category?.slug;
  }

  it("lets a real, specific 1С group win over what the product's own name would infer", () => {
    // "Фильтр масляный Bosch" would itself infer to "filtry" (see
    // catalog-known-categories.test.ts), but this product is filed under
    // the real, specific "Тормозная система" group -- 1С's own grouping
    // must win regardless of what the name suggests.
    const brakes = [...harness.database.categories.values()].find((row) => row.external_id === "cat-brakes")!;
    expect(categorySlugFor("prod-control")).toBe(brakes.slug);
    expect(categorySlugFor("prod-control")).not.toBe("filtry");
  });

  it("falls back to name inference when a product has no <Группы> at all", () => {
    expect(categorySlugFor("prod-nogroup")).toBe("akkumulyatory");
  });

  it("falls back to name inference when the group id is dangling (absent from <Классификатор>)", () => {
    expect(categorySlugFor("prod-dangling")).toBe("shchetki");
  });

  it("falls back to name inference when the group resolves but its name is a junk catch-all", () => {
    expect(categorySlugFor("prod-junk")).toBe("antifriz");
  });

  it('files an unrecognisable name under "Без категории" and counts it in the run summary', () => {
    expect(categorySlugFor("prod-unrecognisable")).toBe(UNCATEGORIZED_CATEGORY_SLUG);
    const summary = harness.database.integration.last_exchange_summary as { rowsUncategorized: number };
    expect(summary.rowsUncategorized).toBe(1);
  });

  it("flags the dangling group as rejected but not the junk-named one", () => {
    const run = [...harness.database.runs.values()].find((row) => row.kind === "catalog")!;
    // Only prod-dangling's bad cross-reference should count; prod-junk's
    // group *did* resolve, it was just generic -- that is not a 1С data
    // problem to flag, only a signal to fall through to name inference.
    expect(run.rows_rejected).toBe(1);
  });
});
