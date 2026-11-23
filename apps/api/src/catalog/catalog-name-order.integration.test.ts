// The order «по названию» on real PostgreSQL. The server's database runs on musl (the Alpine image), where the
// libc collation en_US.utf8 is byte order: «Bcd» came before «abc» and every «ё» after «я». Skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a migrated scratch database.

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "./catalog-public.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const PREFIX = "name-order-fixture:";
const NAMES = ["Яблоко на присоске", "abc клипса", "Bcd втулка", "ёлочка ароматизатор", "Ель ароматизатор", "Абажур плафона", "0443E Бампер передний"];
// The storefront shows «0443E Бампер передний» as «Бампер передний» (publicProductName with the article): it is
// ordered so too.
const SKUS = new Map([["0443E Бампер передний", "0443E"]]);

describe.skipIf(!url)("products in the order of their names (real PostgreSQL)", () => {
  let database: DatabaseService;
  let service: CatalogPublicService;

  const remove = async () => {
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.categories WHERE external_id LIKE $1", [`${PREFIX}%`]);
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    service = new CatalogPublicService(new CatalogCategoryTreeCache(), database, new ProductPhotoStorage({ name: "local", read: async () => null, remove: async () => undefined, store: async () => ({}) } as never), null);
    await remove();
    const category = await database.query<{ id: string }>(
      "INSERT INTO app.categories (external_id,name,slug) VALUES ($1,'Порядок имён','name-order-fixture') RETURNING id", [`${PREFIX}category`],
    );
    for (const [index, name] of NAMES.entries()) {
      await database.query(
        "INSERT INTO app.products (external_id,sku,name,slug,category_id) VALUES ($1,$2,$3,$4,$5)",
        [`${PREFIX}${index}`, SKUS.get(name) ?? `NO-${index}`, name, `name-order-${index}`, category.rows[0]!.id],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (database) await remove();
    await database?.onModuleDestroy?.();
  });

  it("reads the alphabet as a Russian customer does: case does not matter, «ё» is read as «е» (as in a dictionary), Cyrillic before Latin, the leading article aside", async () => {
    const page = await service.products({ category: "name-order-fixture", sort: "name" });
    expect(page.items.map((item) => item.name)).toEqual(["Абажур плафона", "Бампер передний", "Ёлочка ароматизатор", "Ель ароматизатор", "Яблоко на присоске", "abc клипса", "Bcd втулка"]);
  });
});
