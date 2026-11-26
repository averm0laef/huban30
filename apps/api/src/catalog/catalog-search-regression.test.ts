// Real-database search regression suite: real-world auto-parts queries run
// through CatalogPublicService against PostgreSQL with the project
// migrations applied. Skipped unless CATALOG_SEARCH_DATABASE_URL points at
// a scratch database (never the shop's own one -- the fixture is inserted
// and removed again by its external_id prefix). Example:
//
//   createdb --template=template0 --encoding=UTF8 --locale=C.UTF-8 an30_search_scratch
//   DATABASE_URL=postgresql://localhost/an30_search_scratch DATABASE_ENVIRONMENT=development \
//     node packages/database/dist/migrate.js up
//   CATALOG_SEARCH_DATABASE_URL=postgresql://localhost/an30_search_scratch \
//     corepack pnpm --filter @an30/api exec vitest run src/catalog/catalog-search-regression.test.ts

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { removeCatalogSearchFixtures, seedCatalogSearchFixtures } from "./catalog-search-fixtures.js";
import { SEARCH_REGRESSION_CASES, searchCaseFailure } from "./catalog-search-regression-cases.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

describe.skipIf(!url)("catalog search regression (real PostgreSQL)", () => {
  let database: DatabaseService;
  let service: CatalogPublicService;

  beforeAll(async () => {
    database = new DatabaseService({
      get: () => "test",
      getOrThrow: () => url,
    } as unknown as ConfigService);
    await database.transaction((client) => seedCatalogSearchFixtures(client));
    service = new CatalogPublicService(new CatalogCategoryTreeCache(), database, new ProductPhotoStorage({
      name: "local", read: async () => Buffer.alloc(0), remove: async () => undefined, store: async () => undefined,
    } as never));
  }, 60_000);

  afterAll(async () => {
    if (!process.env.CATALOG_SEARCH_KEEP_FIXTURES) await database?.transaction((client) => removeCatalogSearchFixtures(client));
    await database?.onModuleDestroy?.();
  });

  it.each(SEARCH_REGRESSION_CASES.map((testCase) => [`${testCase.group}: ${testCase.q}`, testCase] as const))("%s", async (_q, testCase) => {
    const result = await service.products({ q: testCase.q, limit: "24", ...testCase.params });
    const reference = testCase.expect.sameTotalAs
      ? await service.products({ q: testCase.expect.sameTotalAs, limit: "1" })
      : undefined;
    expect(searchCaseFailure(testCase, result, reference)).toBeNull();
  });

  it("finds a confirmed cross by its source brand, not another maker's identical number", async () => {
    // Synthetic identities only; this test is not evidence for the production cross database.
    const target = await database.query<{ id: string }>(
      `INSERT INTO app.products (external_id,sku,name,slug,brand_id,is_active)
       SELECT 'search-fixture:kf6009sp','KF6009SP','Тестовый фильтр','sf-kf6009sp',id,true
       FROM app.brands WHERE name='MANN-FILTER' AND external_id LIKE 'search-fixture:%' RETURNING id`,
    );
    expect(target.rowCount).toBe(1);
    const pairs = await database.query<{ id: string }>(
      `INSERT INTO app.article_crosses
       (article_a,brand_a,article_b,brand_b,article_a_raw,brand_a_raw,article_b_raw,brand_b_raw,source,status,confirmed_at)
       SELECT a,ba,b,bb,a,ba,b,bb,'manual','confirmed',now() FROM (VALUES
         ('8100110SX','STELLOX','KF6009SP','MANN'),
         ('0986494104','BOSCH','8100110SX','VALEO')
       ) AS pairs(a,ba,b,bb) RETURNING id`,
    );
    try {
      for (const q of ["STELLOX 81-00110-SX", "стеллокс 8100110sx"]) {
        const result = await service.products({ q });
        expect(result.items.map(({ sku, matchedVia }) => [sku, matchedVia])).toEqual([["KF6009SP", "cross"]]);
      }
      const other = await service.products({ q: "VALEO 81-00110-SX" });
      expect(other.items.map(({ sku, matchedVia }) => [sku, matchedVia])).toEqual([["0 986 494 104", "cross"]]);
    } finally {
      await database.query("DELETE FROM app.article_crosses WHERE id=ANY($1::uuid[])", [pairs.rows.map(({ id }) => id)]);
      await database.query("DELETE FROM app.products WHERE id=$1", [target.rows[0]!.id]);
    }
  });
});
