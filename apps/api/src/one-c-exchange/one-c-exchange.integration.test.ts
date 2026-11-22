// Real-database check of the 1С exchange (CommerceML import.xml → app.products).
// The unit suite next to this file runs against an in-memory double that knows
// nothing about PostgreSQL's unique indexes; the cases here are the ones only a
// real database can answer. Skipped unless CATALOG_SEARCH_DATABASE_URL points at
// a scratch database -- see catalog/catalog-search-regression.test.ts for how
// to prepare one.

import { createHash } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { OneCExchangeService, type OneCExchangeImportOutcome } from "./one-c-exchange.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

/** Everything this file creates carries this prefix, so it can be removed without touching other fixtures. */
const PREFIX = "it1c-exchange-";

interface Item { description?: string; id: string; name: string; sku: string }

/** A delta file (СодержитТолькоИзменения="true"): it never hides products it does not list. */
function importXml(items: readonly Item[], exportedAt = "2026-11-22T10:00:00"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="${exportedAt}">
  <Классификатор><Ид>${PREFIX}classifier</Ид><Наименование>Классификатор</Наименование></Классификатор>
  <Каталог СодержитТолькоИзменения="true">
    <Ид>${PREFIX}catalog</Ид>
    <Товары>
${items.map((item) => `      <Товар><Ид>${item.id}</Ид><Артикул>${item.sku}</Артикул><Наименование>${item.name}</Наименование>${
    item.description ? `<Описание>${item.description}</Описание>` : ""}</Товар>`).join("\n")}
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
}

/**
 * offers.xml with the owner's two price types, the cost one listed first, and one offer priced in both.
 * It carries no stock on purpose: a stock row writes to app.inventory_events, an append-only ledger
 * that a test cannot clean up after itself.
 */
function offersXml(productId: string, exportedAt = "2026-11-22T10:30:00"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="${exportedAt}">
  <ПакетПредложений СодержитТолькоИзменения="true">
    <Ид>${PREFIX}offers</Ид>
    <ТипыЦен>
      <ТипЦены><Ид>t-cost</Ид><Наименование>Учетная цена</Наименование></ТипЦены>
      <ТипЦены><Ид>t-sell</Ид><Наименование>Оптовая цена</Наименование></ТипЦены>
    </ТипыЦен>
    <Предложения>
      <Предложение><Ид>${productId}</Ид><Цены>
        <Цена><ИдТипаЦены>t-cost</ИдТипаЦены><ЦенаЗаЕдиницу>449</ЦенаЗаЕдиницу><Валюта>RUB</Валюта></Цена>
        <Цена><ИдТипаЦены>t-sell</ИдТипаЦены><ЦенаЗаЕдиницу>700</ЦенаЗаЕдиницу><Валюта>RUB</Валюта></Цена>
      </Цены></Предложение>
    </Предложения>
  </ПакетПредложений>
</КоммерческаяИнформация>`;
}

describe.skipIf(!url)("1С exchange (real PostgreSQL)", () => {
  let database: DatabaseService;
  let exchange: OneCExchangeService;
  let integration: OneCIntegrationService;

  async function removeEverythingThisFileCreated(): Promise<void> {
    await database.query(
      "DELETE FROM app.product_prices WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)", [`${PREFIX}%`],
    );
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.one_c_exchange_runs WHERE filename LIKE $1", [`${PREFIX}%`]);
    await database.query("UPDATE app.integration_endpoints SET settings = '{}'::jsonb WHERE integration_key = 'one_c'");
  }

  async function storedDescription(externalId: string): Promise<string | null | undefined> {
    return (await database.query<{ description: string | null }>(
      "SELECT description FROM app.products WHERE external_id = $1", [externalId],
    )).rows[0]?.description;
  }

  /** Polls mode=import the way 1С does, until the file is applied or refused. */
  async function importFile(kind: "catalog" | "offers", filename: string, xml: string): Promise<OneCExchangeImportOutcome> {
    const assembled = Buffer.from(xml, "utf8");
    const checksum = createHash("sha256").update(assembled).digest();
    for (let poll = 0; poll < 50; poll += 1) {
      const outcome = await exchange.processImport({ assembled, checksum, filename, kind });
      if (outcome.kind !== "progress") return outcome;
    }
    throw new Error("the import did not finish in 50 polls");
  }
  const importCatalog = (filename: string, xml: string) => importFile("catalog", filename, xml);

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    // The exchange asks the integration service for one thing only: to store the run's summary.
    integration = new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never);
    exchange = new OneCExchangeService(new CatalogCategoryTreeCache(), database, integration);
  });

  beforeEach(removeEverythingThisFileCreated);

  afterAll(async () => {
    await removeEverythingThisFileCreated();
    await database?.onModuleDestroy?.();
  });

  it("keeps both items when two different 1С items share one article", async () => {
    // Real case from the owner's base: belts of ten brands all carry the size «4PK820» as their article.
    const filename = `${PREFIX}shared-article.xml`;
    const outcome = await importCatalog(filename, importXml([
      { id: `${PREFIX}belt-gmb`, name: "4PK0820 Ремень поликлиновый GMB", sku: "4PK820" },
      { id: `${PREFIX}belt-masuma`, name: "4PK0820 Ремень ручейковый MASUMA", sku: "4pk820" },
    ]));

    expect(outcome).toEqual({ kind: "success" });
    const products = await database.query<{ external_id: string; sku: string }>(
      "SELECT external_id, sku::text AS sku FROM app.products WHERE external_id LIKE $1 AND deleted_at IS NULL ORDER BY external_id",
      [`${PREFIX}%`],
    );
    expect(products.rows).toEqual([
      { external_id: `${PREFIX}belt-gmb`, sku: "4PK820" },
      { external_id: `${PREFIX}belt-masuma`, sku: "4pk820" },
    ]);
    const run = await database.query<{ rows_rejected: number; rows_touched: number; status: string }>(
      "SELECT status, rows_touched, rows_rejected FROM app.one_c_exchange_runs WHERE filename = $1", [filename],
    );
    expect(run.rows).toEqual([{ rows_rejected: 0, rows_touched: 2, status: "completed" }]);
  });

  describe("the price type of an offers file", () => {
    const item: Item = { id: `${PREFIX}priced`, name: "Сайлентблок рычага подвески", sku: "C9431" };
    const filename = `${PREFIX}offers.xml`;

    beforeEach(async () => {
      await importCatalog(`${PREFIX}priced.xml`, importXml([item]));
      await importFile("offers", filename, offersXml(item.id));
    });

    it("prices the product at what the shop sells for, not at its cost", async () => {
      const price = await database.query<{ amount_kopeks: string }>(
        `SELECT price.amount_kopeks::text FROM app.product_prices AS price
         JOIN app.products AS product ON product.id = price.product_id
         WHERE product.external_id = $1 AND price.valid_to IS NULL`, [item.id],
      );

      expect(price.rows).toEqual([{ amount_kopeks: "70000" }]);
    });

    it("writes the name of the price type it took into the exchange journal", async () => {
      const journal = await integration.listExchangeRuns({}) as { items: Array<{ filename: string; priceTypeName: string | null }> };

      expect(journal.items.find((run) => run.filename === filename)).toMatchObject({ priceTypeName: "Оптовая цена" });
    });

    it("leaves the price type empty for a catalog file, which carries no prices", async () => {
      const journal = await integration.listExchangeRuns({}) as { items: Array<{ filename: string; priceTypeName: string | null }> };

      expect(journal.items.find((run) => run.filename === `${PREFIX}priced.xml`)).toMatchObject({ priceTypeName: null });
    });
  });

  describe("the 1С «Описание» field", () => {
    // In the owner's base it holds stock-take notes and shelf numbers («аудит 27 03 2026 КОРОБКА 35»).
    const item: Item = { description: "аудит 27 03 2026 КОРОБКА 35", id: `${PREFIX}bush`, name: "Сайлентблок рычага подвески", sku: "C9431" };

    it("is not stored for the storefront by default", async () => {
      await importCatalog(`${PREFIX}note-default.xml`, importXml([item]));

      expect(await storedDescription(item.id)).toBeNull();
    });

    it("is stored once the base is set to publish descriptions", async () => {
      await database.query(
        `UPDATE app.integration_endpoints SET settings = settings || '{"publishDescriptions": true}'::jsonb WHERE integration_key = 'one_c'`,
      );

      await importCatalog(`${PREFIX}note-published.xml`, importXml([item], "2026-11-22T11:00:00"));

      expect(await storedDescription(item.id)).toBe("аудит 27 03 2026 КОРОБКА 35");
    });

    it("is removed by the next exchange after the base stops publishing descriptions", async () => {
      await database.query(
        `UPDATE app.integration_endpoints SET settings = settings || '{"publishDescriptions": true}'::jsonb WHERE integration_key = 'one_c'`,
      );
      await importCatalog(`${PREFIX}note-on.xml`, importXml([item], "2026-11-22T12:00:00"));
      await database.query("UPDATE app.integration_endpoints SET settings = '{}'::jsonb WHERE integration_key = 'one_c'");

      await importCatalog(`${PREFIX}note-off.xml`, importXml([item], "2026-11-22T13:00:00"));

      expect(await storedDescription(item.id)).toBeNull();
    });
  });
});
