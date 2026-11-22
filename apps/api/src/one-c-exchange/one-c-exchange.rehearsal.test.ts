// Rehearsal of the 1С exchange at full volume: the two CommerceML files built from the owner's list export
// (scripts/catalog-placement/build-commerceml.py) go through the real OneCExchangeService into a real, empty
// PostgreSQL database, the way 1С polls them in.
//
// Skipped unless both are set:
//   ONE_C_REHEARSAL_DIR            folder with rehearsal-import.xml and rehearsal-offers.xml (absolute path)
//   ONE_C_REHEARSAL_DATABASE_URL   an EMPTY database made for this run and dropped after it
//
//   createdb an30_exchange_rehearsal
//   DATABASE_URL=postgresql://localhost/an30_exchange_rehearsal DATABASE_ENVIRONMENT=development node packages/database/dist/migrate.js up
//   ONE_C_REHEARSAL_DIR="$PWD/local-data/1c" ONE_C_REHEARSAL_DATABASE_URL=postgresql://localhost/an30_exchange_rehearsal \
//     corepack pnpm --filter @an30/api exec vitest run src/one-c-exchange/one-c-exchange.rehearsal.test.ts
//   dropdb an30_exchange_rehearsal
//
// Never point it at the stand or the scratch database of the other suites: stock rows go to an append-only
// ledger and cannot be removed afterwards. The suite refuses a database that already holds products.
//
// What it does not check: a file made by 1С itself (groups, properties, pictures, parts), the network and the
// authorisation. Only a real exchange checks those.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { decideStorefrontCategory, UNCATEGORIZED_CATEGORY_SLUG } from "../catalog/catalog-known-categories.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { parseImportXml } from "./commerce-ml.parser.js";
import { OneCExchangeService, type OneCExchangeImportOutcome } from "./one-c-exchange.service.js";

const directory = process.env.ONE_C_REHEARSAL_DIR;
const url = process.env.ONE_C_REHEARSAL_DATABASE_URL;

const CATALOG_FILE = "rehearsal-import.xml";
const OFFERS_FILE = "rehearsal-offers.xml";
/** A catalogue of 40 000 items takes about a hundred polls of 500 rows, the offers twice as many. */
const MAX_POLLS = 2000;
const TEN_MINUTES = 600_000;

describe.skipIf(!directory || !url)("rehearsal of the 1С exchange at full volume (real PostgreSQL, empty database)", () => {
  let database: DatabaseService;
  let exchange: OneCExchangeService;
  let catalogXml = "";
  let offersXml = "";

  const count = async (sql: string) => Number((await database.query<{ n: string }>(sql)).rows[0]!.n);

  async function importFile(kind: "catalog" | "offers", filename: string, xml: string): Promise<{ outcome: OneCExchangeImportOutcome; polls: number; seconds: number }> {
    const assembled = Buffer.from(xml, "utf8");
    const checksum = createHash("sha256").update(assembled).digest();
    const started = Date.now();
    for (let polls = 1; polls <= MAX_POLLS; polls += 1) {
      const outcome = await exchange.processImport({ assembled, checksum, filename, kind });
      if (outcome.kind !== "progress") return { outcome, polls, seconds: Math.round((Date.now() - started) / 1000) };
    }
    throw new Error(`the import did not finish in ${MAX_POLLS} polls`);
  }

  const journal = async (filename: string) => (await database.query<{
    price_type_name: string | null; rows_rejected: number; rows_touched: number; rows_uncategorized: number; status: string;
  }>("SELECT status, rows_touched, rows_rejected, rows_uncategorized, price_type_name FROM app.one_c_exchange_runs WHERE filename = $1", [filename])).rows;

  beforeAll(async () => {
    catalogXml = readFileSync(path.join(directory!, CATALOG_FILE), "utf8");
    offersXml = readFileSync(path.join(directory!, OFFERS_FILE), "utf8");
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    const integration = new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never);
    exchange = new OneCExchangeService(new CatalogCategoryTreeCache(), database, integration);
    const existing = await count("SELECT count(*)::text AS n FROM app.products");
    if (existing > 0) throw new Error(`ONE_C_REHEARSAL_DATABASE_URL must point at an empty database; this one holds ${existing} products`);
  }, TEN_MINUTES);

  afterAll(async () => {
    await database?.onModuleDestroy?.();
  });

  it("takes every item of the catalogue and files it exactly as the sorting rules decide", async () => {
    const items = parseImportXml(catalogXml).bodyRows.filter((row) => row.entityType === "product");
    const expectedWithoutSection = items
      .filter((row) => decideStorefrontCategory({ groupNames: [], productName: row.name, sku: row.sku }).slug === UNCATEGORIZED_CATEGORY_SLUG).length;

    const { outcome, polls, seconds } = await importFile("catalog", CATALOG_FILE, catalogXml);

    expect(outcome).toEqual({ kind: "success" });
    const run = await journal(CATALOG_FILE);
    process.stdout.write(`\n[rehearsal] catalogue: ${items.length} items, ${polls} polls, ${seconds} s, journal ${JSON.stringify(run[0])}\n`);
    expect(run).toEqual([{ price_type_name: null, rows_rejected: 0, rows_touched: items.length, rows_uncategorized: expectedWithoutSection, status: "completed" }]);
    expect(await count("SELECT count(*)::text AS n FROM app.products WHERE deleted_at IS NULL AND is_active")).toBe(items.length);
    expect(await count(
      `SELECT count(*)::text AS n FROM app.products AS product JOIN app.categories AS category ON category.id = product.category_id
       WHERE category.slug = '${UNCATEGORIZED_CATEGORY_SLUG}'`,
    )).toBe(expectedWithoutSection);
  }, TEN_MINUTES);

  it("takes the prices and the stock of every offer", async () => {
    const priced = (offersXml.match(/<ЦенаЗаЕдиницу>/gu) ?? []).length;

    const { outcome, polls, seconds } = await importFile("offers", OFFERS_FILE, offersXml);

    expect(outcome).toEqual({ kind: "success" });
    const run = await journal(OFFERS_FILE);
    process.stdout.write(`\n[rehearsal] offers: ${priced} prices, ${polls} polls, ${seconds} s, journal ${JSON.stringify(run[0])}\n`);
    expect(run).toMatchObject([{ price_type_name: "Оптовая цена", rows_rejected: 0, status: "completed" }]);
    expect(await count("SELECT count(*)::text AS n FROM app.product_prices WHERE valid_to IS NULL")).toBe(priced);
    expect(await count("SELECT count(DISTINCT product_id)::text AS n FROM app.inventory_balances WHERE quantity_on_hand > 0")).toBeGreaterThan(0);
  }, TEN_MINUTES);
});
