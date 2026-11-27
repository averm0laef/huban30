import { readFileSync } from "node:fs";

import type { ConfigService } from "@nestjs/config";
import { load } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderCrossStore } from "../parts-finder/parts-finder-crosses.store.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { removeCatalogSearchFixtures, seedCatalogSearchFixtures, type FixtureProduct } from "./catalog-search-fixtures.js";

const golden = z.object({
  catalog: z.array(z.object({
    category: z.string().optional(),
    expect: z.array(z.object({ sku: z.string(), via: z.enum(["query", "cross"]) })),
    query: z.string(),
  })),
}).parse(load(readFileSync(new URL("../../../../tests/golden/search.yaml", import.meta.url), "utf8")));

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const goldenProducts: FixtureProduct[] = [
  { key: "gold-filter", sku: "KF6009SP", name: "Масляный фильтр ФОМ 44.3.001 Кострома", brand: "Кострома", category: "sf-filtry", rubles: 790, stock: 3 },
  { key: "gold-neighbor", sku: "81-94111-SX", name: "Фильтр воздушный Stellox", brand: "STELLOX", category: "sf-filtry", rubles: 900, stock: 1 },
  { key: "gold-same-number", sku: "81-88710-SX", name: "Масляный фильтр Mann", brand: "MANN-FILTER", category: "sf-filtry", rubles: 700, stock: 1 },
  { key: "gold-other-brand", sku: "81-66510-SX", name: "Фильтр другой марки", brand: "Bosch", category: "sf-filtry", rubles: 500, stock: 1 },
  { key: "gold-oem-own", sku: "ST-87139-28010", name: "Фильтр салона SAT", brand: "SAT", category: "sf-filtry", rubles: 540, stock: 2 },
  { key: "gold-lynx", sku: "LAC143", name: "Фильтр салона LYNXauto ST-87139-28010", brand: "LYNXauto", category: "sf-filtry", rubles: 990, stock: 1 },
  { key: "gold-dot-4", sku: "PFB401", name: "Жидкость тормозная DOT 4, 0,5 л", brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 700, stock: 1 },
  { key: "gold-dot-cyrillic", sku: "BF500", name: "Тормозная жидкость ДОТ-4", brand: "Bosch", category: "sf-tormoznaya-sistema", rubles: 850, stock: 1 },
  { key: "gold-dot-5", sku: "DOT51-A", name: "Жидкость тормозная DOT-5", brand: "Bosch", category: "sf-tormoznaya-sistema", rubles: 930, stock: 2 },
  { key: "gold-dot-51", sku: "DOT51-B", name: "Жидкость тормозная DOT 5.1", brand: "Bosch", category: "sf-tormoznaya-sistema", rubles: 1100, stock: 2 },
  { key: "gold-dot-number", sku: "W9004", name: "Шланг 4 метра", brand: "Bosch", category: "sf-podveska", rubles: 850, stock: 1 },
  { key: "gold-lynx201", sku: "LAC-201C", name: "Фильтр салона LYNXauto", brand: "LYNXauto", category: "sf-filtry", rubles: 860, stock: 2 },
];

describe.skipIf(!url)("golden search (isolated PostgreSQL)", () => {
  let database: DatabaseService;
  let service: CatalogPublicService;
  const fixtureArticles = ["8100110SX", "8194110SX", "8188710SX", "8177410SX", "8713928010"];

  beforeAll(async () => {
    database = new DatabaseService({
      get: () => "test",
      getOrThrow: () => url,
    } as unknown as ConfigService);
    await database.transaction((client) => seedCatalogSearchFixtures(client, goldenProducts));
    const crosses = new PartsFinderCrossStore(database);
    await crosses.rememberPairs([
      { article: "81-00110-SX", brand: "STELLOX", crossArticle: "KF6009SP", crossBrand: "Кострома", confirmed: true },
      { article: "81-88710-SX", brand: "STELLOX", crossArticle: "81-88710-SX", crossBrand: "MANN-FILTER", confirmed: true },
      { article: "81-77410-SX", brand: "Bosch", crossArticle: "KF6009SP", crossBrand: "Кострома", confirmed: true },
      { article: "87139-28010", brand: "TOYOTA", crossArticle: "LAC143", crossBrand: "LYNXauto", confirmed: true },
    ], "fapi");
    await crosses.rememberPairs([
      { article: "81-94110-SX", brand: "STELLOX", crossArticle: "KF6009SP", crossBrand: "Кострома", confirmed: false },
    ], "umapi");
    service = new CatalogPublicService(new CatalogCategoryTreeCache(), database, new ProductPhotoStorage({
      name: "local", read: async () => Buffer.alloc(0), remove: async () => undefined, store: async () => undefined,
    } as never), null);
  });

  afterAll(async () => {
    if (!database) return;
    await database.transaction(async (client) => {
      await client.query("DELETE FROM app.article_crosses WHERE article_a=ANY($1::text[]) OR article_b=ANY($1::text[])", [fixtureArticles]);
      await removeCatalogSearchFixtures(client);
    });
    await database.onModuleDestroy();
  });

  it.each(golden.catalog)("$query ($category)", async ({ category, expect: expected, query }) => {
    const result = await service.products({ q: query, limit: 10, ...(category ? { category } : {}) });
    expect(result.total).toBe(expected.length);
    expect(result.items.map(({ sku, matchedVia }) => ({ sku, via: matchedVia }))).toEqual(expect.arrayContaining(expected));
  });
});
