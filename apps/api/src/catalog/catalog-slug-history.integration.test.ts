// A product renamed in 1С gets a new page address (the slug is made from the name); the old one must lead to it,
// or every link a search engine knows dies with each rename (migration 0051). Real PostgreSQL only; skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a migrated scratch database.

import { NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "./catalog-public.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const PREFIX = "slug-history-fixture:";

describe.skipIf(!url)("old addresses of a renamed product (real PostgreSQL)", () => {
  let database: DatabaseService;
  let service: CatalogPublicService;

  const remove = async () => {
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
  };
  const movedTo = async (slug: string): Promise<string | null> => {
    try {
      await service.product(slug);
      return "found";
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      const body = error.getResponse() as { movedTo?: string };
      return body.movedTo ?? null;
    }
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    service = new CatalogPublicService(new CatalogCategoryTreeCache(), database, { name: "local", read: async () => null, remove: async () => undefined, store: async () => ({}) } as never, null);
    await remove();
    await database.query(
      "INSERT INTO app.products (external_id,sku,name,slug) VALUES ($1,'SH-1','Лампа T4W','slug-history-lampa-t4w')", [`${PREFIX}lamp`],
    );
  }, 60_000);

  afterAll(async () => {
    if (database) await remove();
    await database?.onModuleDestroy?.();
  });

  it("leads every former address to the product's address of today", async () => {
    await database.query("UPDATE app.products SET name='Лампа T4W 24V',slug='slug-history-lampa-t4w-24v' WHERE external_id=$1", [`${PREFIX}lamp`]);
    await database.query("UPDATE app.products SET name='Лампа T4W 24V BA9s',slug='slug-history-lampa-t4w-24v-ba9s' WHERE external_id=$1", [`${PREFIX}lamp`]);

    expect(await movedTo("slug-history-lampa-t4w")).toBe("slug-history-lampa-t4w-24v-ba9s");
    expect(await movedTo("slug-history-lampa-t4w-24v")).toBe("slug-history-lampa-t4w-24v-ba9s");
    expect(await movedTo("slug-history-lampa-t4w-24v-ba9s")).toBe("found");
  });

  it("gives a former address to a product that takes it: a live address wins", async () => {
    await database.query(
      "INSERT INTO app.products (external_id,sku,name,slug) VALUES ($1,'SH-2','Лампа T4W','slug-history-lampa-t4w')", [`${PREFIX}second`],
    );
    expect(await movedTo("slug-history-lampa-t4w")).toBe("found");
    expect(await movedTo("slug-history-lampa-t4w-24v")).toBe("slug-history-lampa-t4w-24v-ba9s");
  });

  it("does not lead to a product that is no longer for sale", async () => {
    await database.query("UPDATE app.products SET is_active=false WHERE external_id=$1", [`${PREFIX}lamp`]);
    expect(await movedTo("slug-history-lampa-t4w-24v")).toBeNull();
  });

  it("knows nothing of an address no product ever had", async () => {
    expect(await movedTo("slug-history-never-was")).toBeNull();
  });
});
