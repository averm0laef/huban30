// Real-database search regression suite: real-world auto-parts queries run
// through CatalogPublicService against PostgreSQL with the project
// migrations applied. Skipped unless CATALOG_SEARCH_DATABASE_URL points at
// a scratch database (never the shop's own one -- the fixture is inserted
// and removed again by its external_id prefix). Example:
//
//   createdb an30_search_scratch
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
});
