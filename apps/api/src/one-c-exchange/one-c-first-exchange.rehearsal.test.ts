// Rehearsal of the first real exchange over a base that is already loaded: the catalogue was filled from the owner's
// list export under 1С codes (rehearsal-*.xml), and now 1С sends the same goods under its own identifiers
// (first-exchange-*.xml, both built by scripts/catalog-placement/build-commerceml.py). The files go through the real
// OneCExchangeService into a COPY of the loaded base; the suite says what the exchange kept, added and hid.
//
// Skipped unless both are set:
//   ONE_C_FIRST_EXCHANGE_DIR            folder with the files (absolute path)
//   ONE_C_FIRST_EXCHANGE_DATABASE_URL   a copy of a loaded base made for this run and dropped after it
//   ONE_C_FIRST_EXCHANGE_FILES          optional: "first-exchange-no-code" for the files without the 1С code
//
//   createdb -T an30_test_base an30_first_exchange
//   DATABASE_URL=postgresql://localhost/an30_first_exchange DATABASE_ENVIRONMENT=development node packages/database/dist/migrate.js up
//   ONE_C_FIRST_EXCHANGE_DIR="$PWD/local-data/1c" ONE_C_FIRST_EXCHANGE_DATABASE_URL=postgresql://localhost/an30_first_exchange \
//     corepack pnpm --filter @an30/api exec vitest run src/one-c-exchange/one-c-first-exchange.rehearsal.test.ts
//   dropdb an30_first_exchange
//
// Never point it at the stand: it rewrites the identifiers of the products. What it does not check: a file made by
// 1С itself (which group each product is in, properties, pictures). Only a real exchange checks those.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { OneCExchangeService } from "./one-c-exchange.service.js";

const directory = process.env.ONE_C_FIRST_EXCHANGE_DIR;
const url = process.env.ONE_C_FIRST_EXCHANGE_DATABASE_URL;
const files = process.env.ONE_C_FIRST_EXCHANGE_FILES ?? "first-exchange";
const MAX_POLLS = 2000;
const TEN_MINUTES = 600_000;

interface Shop { active: boolean; category: string | null; id: string; name: string; price: string | null; sku: string; slug: string; stock: number }

describe.skipIf(!directory || !url)("rehearsal of the first 1С exchange over a loaded base (real PostgreSQL, a copy)", () => {
  let database: DatabaseService;
  let exchange: OneCExchangeService;
  let before = new Map<string, Shop>();

  /** Every product the way a buyer and the staff see it, by its row. */
  const shop = async () => new Map((await database.query<Shop>(
    `SELECT product.id::text, product.sku::text, product.name, product.slug::text, product.is_active AS active,
            product.category_id::text AS category, price.amount_kopeks::text AS price,
            COALESCE((SELECT sum(quantity_on_hand) FROM app.inventory_balances WHERE product_id = product.id), 0)::int AS stock
     FROM app.products AS product
     LEFT JOIN app.product_prices AS price ON price.product_id = product.id AND price.valid_to IS NULL AND price.currency = 'RUB'
     WHERE product.one_c_source = 'one_c' AND NOT product.is_demo`,
  )).rows.map((row) => [row.id, row]));

  async function importFile(kind: "catalog" | "offers"): Promise<Record<string, unknown>> {
    const filename = `${files}-${kind === "catalog" ? "import" : "offers"}.xml`;
    const assembled = readFileSync(path.join(directory!, filename));
    const checksum = createHash("sha256").update(assembled).digest();
    const started = Date.now();
    for (let polls = 1; polls <= MAX_POLLS; polls += 1) {
      const outcome = await exchange.processImport({ assembled, checksum, filename, kind });
      if (outcome.kind === "progress") continue;
      expect(outcome).toEqual({ kind: "success" });
      const run = (await database.query<Record<string, unknown>>(
        `SELECT status, rows_touched, rows_rejected, products_adopted, products_hidden, hiding_skipped
         FROM app.one_c_exchange_runs WHERE filename = $1 ORDER BY created_at DESC LIMIT 1`, [filename],
      )).rows[0]!;
      process.stdout.write(`\n[first exchange] ${filename}: ${polls} polls, ${Math.round((Date.now() - started) / 1000)} s, journal ${JSON.stringify(run)}\n`);
      return run;
    }
    throw new Error(`the import did not finish in ${MAX_POLLS} polls`);
  }

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    const integration = new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never);
    exchange = new OneCExchangeService(new CatalogCategoryTreeCache(), database, integration);
    before = await shop();
    if (before.size === 0) throw new Error("ONE_C_FIRST_EXCHANGE_DATABASE_URL must point at a copy of a loaded base; this one holds no products");
  }, TEN_MINUTES);

  afterAll(async () => {
    await database?.onModuleDestroy?.();
  });

  it("keeps the loaded products in their rows and says what changed for a buyer", async () => {
    const catalog = await importFile("catalog");
    const offers = await importFile("offers");
    const after = await shop();

    const kept = [...before.values()].filter((row) => after.get(row.id)?.active === row.active);
    const changed = (field: keyof Shop) => kept.filter((row) => after.get(row.id)![field] !== row[field]).length;
    const report = {
      addedAsNew: [...after.keys()].filter((id) => !before.has(id)).length,
      hidden: [...before.values()].filter((row) => row.active && after.get(row.id)?.active === false).length,
      liveAfter: [...after.values()].filter((row) => row.active).length,
      liveBefore: [...before.values()].filter((row) => row.active).length,
      newAddress: changed("slug"), newArticle: changed("sku"), newName: changed("name"), newPrice: changed("price"),
      newSection: changed("category"), newStock: changed("stock"),
    };
    process.stdout.write(`\n[first exchange] ${JSON.stringify(report)}\n`);

    expect(catalog).toMatchObject({ rows_rejected: 0, status: "completed" });
    expect(offers).toMatchObject({ status: "completed" });
    expect(after.size).toBe(before.size + report.addedAsNew);
    // With the 1С code in the file nothing is added twice and nothing is hidden. Without it the report above is the
    // answer: products with no article cannot be read at all, and their prices are refused with them.
    if (files === "first-exchange") {
      expect(report).toMatchObject({ addedAsNew: 0, hidden: 0, liveAfter: report.liveBefore, newAddress: 0 });
      expect(catalog.products_adopted).toBe(before.size);
      expect(offers.rows_rejected).toBe(0);
    }
  }, TEN_MINUTES);
});
