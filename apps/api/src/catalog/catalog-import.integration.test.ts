// Real-database check of the staged JSON import (CatalogImportService.upload):
// which rows it accepts. Skipped unless CATALOG_SEARCH_DATABASE_URL points at a
// scratch database -- see catalog-search-regression.test.ts for how to prepare one.

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogImportService } from "./catalog-import.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

/** Everything this file creates carries this prefix, so it can be removed without touching other fixtures. */
const PREFIX = "itjson-import-";

function product(key: string, name: string, sku: string) {
  return { entityType: "product", externalId: `${PREFIX}${key}`, name, sku, slug: `${PREFIX}${key}`, version: 1 };
}

describe.skipIf(!url)("staged JSON import (real PostgreSQL)", () => {
  let database: DatabaseService;
  let service: CatalogImportService;

  async function removeEverythingThisFileCreated(): Promise<void> {
    await database.query("DELETE FROM app.catalog_import_batches WHERE external_batch_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
  }

  beforeAll(() => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    service = new CatalogImportService(database);
  });

  beforeEach(removeEverythingThisFileCreated);

  afterAll(async () => {
    await removeEverythingThisFileCreated();
    await database?.onModuleDestroy?.();
  });

  it("accepts two different products that share one article", async () => {
    const summary = await service.upload({
      exportedAt: "2026-11-22T10:00:00Z",
      externalBatchId: `${PREFIX}shared-article`,
      rows: [
        product("belt-gmb", "4PK0820 Ремень поликлиновый GMB", "4PK820"),
        product("belt-masuma", "4PK0820 Ремень ручейковый MASUMA", "4pk820"),
      ],
      schemaVersion: 1,
    });

    expect(summary).toMatchObject({ invalidRows: 0, validRows: 2 });
  });

  it("accepts a product whose article already belongs to another product of the shop", async () => {
    await database.query(
      "INSERT INTO app.products (external_id, sku, name, slug) VALUES ($1, '4PK820', 'Ремень поликлиновой Bando', $2)",
      [`${PREFIX}belt-bando`, `${PREFIX}belt-bando`],
    );

    const summary = await service.upload({
      exportedAt: "2026-11-22T10:00:00Z",
      externalBatchId: `${PREFIX}article-in-use`,
      rows: [product("belt-gates", "4PK0820 Ремень поликлиновый Gates", "4PK820")],
      schemaVersion: 1,
    });

    expect(summary).toMatchObject({ invalidRows: 0, validRows: 1 });
  });

  it("still refuses two products with one slug: the slug is the product's address", async () => {
    const summary = await service.upload({
      exportedAt: "2026-11-22T10:00:00Z",
      externalBatchId: `${PREFIX}shared-slug`,
      rows: [
        product("belt-gmb", "4PK0820 Ремень поликлиновый GMB", "4PK820"),
        { ...product("belt-masuma", "4PK0820 Ремень ручейковый MASUMA", "4PK821"), slug: `${PREFIX}belt-gmb` },
      ],
      schemaVersion: 1,
    });

    expect(summary).toMatchObject({ invalidRows: 2, validRows: 0 });
  });
});
