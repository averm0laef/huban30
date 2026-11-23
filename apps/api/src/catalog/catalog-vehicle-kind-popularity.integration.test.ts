// The kind of vehicle, «по популярности» and the other packs on real PostgreSQL: the make words of migration 0060
// against the ones the exchange uses, the stored popularity count from the shop's own orders, favourites and
// views, and the packs found through the trigram index. Skipped unless CATALOG_SEARCH_DATABASE_URL points at a
// migrated scratch database.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { VEHICLE_KIND_NAME_WORDS, vehicleKindOfName } from "./catalog-vehicle-kind.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const PREFIX = "kind-popularity-fixture:";
const SECTION = "kind-popularity-fixture";
const PRODUCTS = [
  { kind: "truck", name: "Вал карданный КАМАЗ-5320 межосевой", sku: "KP-1" },
  { kind: "tractor", name: "Гидрораспределитель МТЗ-82", sku: "KP-2" },
  { kind: "passenger", name: "Колодки тормозные передние Toyota Corolla", sku: "KP-3" },
  { kind: null, name: "Лампа H7 12V 55W", sku: "KP-4" },
  { kind: null, name: "9066 5W-50 Synthoil High Tech 1л", sku: "9066" },
  { kind: null, name: "9067 5W-50 Synthoil High Tech 4л", sku: "9067" },
  { kind: null, name: "9068 5W-50 Synthoil High Tech 20л", sku: "9068" },
  { kind: null, name: "9100 5W-40 Synthoil High Tech 4л", sku: "9100" },
] as const;

class Rollback extends Error {}

describe.skipIf(!url)("kind of vehicle, popularity and other packs (real PostgreSQL)", () => {
  let database: DatabaseService;
  let service: CatalogPublicService;
  const ids = new Map<string, string>();
  const users: string[] = [];

  const remove = async () => {
    await database.query("DELETE FROM app.users WHERE email LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.categories WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("SELECT app.refresh_product_popularity()");
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    service = new CatalogPublicService(new CatalogCategoryTreeCache(), database, new ProductPhotoStorage({ name: "local", read: async () => null, remove: async () => undefined, store: async () => ({}) } as never), null);
    await remove();
    const category = await database.query<{ id: string }>(
      "INSERT INTO app.categories (external_id,name,slug) VALUES ($1,'Техника и популярность',$2) RETURNING id", [`${PREFIX}category`, SECTION],
    );
    for (const [index, product] of PRODUCTS.entries()) {
      const inserted = await database.query<{ id: string }>(
        "INSERT INTO app.products (external_id,sku,name,slug,category_id,vehicle_kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [`${PREFIX}${index}`, product.sku, product.name, `kind-popularity-${index}`, category.rows[0]!.id, product.kind],
      );
      ids.set(product.sku, inserted.rows[0]!.id);
    }
    for (const name of ["one", "two"]) {
      const user = await database.query<{ id: string }>("INSERT INTO app.users (email) VALUES ($1) RETURNING id", [`${PREFIX}${name}@example.test`]);
      users.push(user.rows[0]!.id);
    }
    // Two customers keep the brake pads in favourites (2 × 2), one opened the tractor's part (1).
    for (const user of users) await database.query("INSERT INTO app.wishlist_items (user_id,product_id) VALUES ($1,$2)", [user, ids.get("KP-3")]);
    await database.query("INSERT INTO app.product_views (user_id,product_id) VALUES ($1,$2)", [users[0], ids.get("KP-2")]);
    await database.query("SELECT app.refresh_product_popularity()");
  }, 60_000);

  afterAll(async () => {
    if (database) await remove();
    await database?.onModuleDestroy?.();
  });

  it("reads the makes in migration 0060 exactly as the exchange reads them", async () => {
    const sql = readFileSync(path.join(
      path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/database/migrations/0060_vehicle_kind_and_popularity.sql",
    ), "utf8");
    const backfill = /SET vehicle_kind = (CASE[\s\S]+?END)\s+WHERE/u.exec(sql)?.[1];
    expect(backfill).toBeDefined();
    const names = [
      ...PRODUCTS.map((product) => product.name),
      ...Object.values(VEHICLE_KIND_NAME_WORDS).flat().flatMap((word) => [
        `Втулка ${word} 123`, `${word.toUpperCase()}-45 кронштейн`, `Втулка (${word})`, `Втулка x${word}`, `Втулка ${word}ю`, `Шина для ${word} и КАМАЗ`,
      ]),
      "Смазка графитная", "Вазелин технический", "Ёлочка ароматизатор", "Шина 8.25R20 для МТЗ и КАМАЗ", "Фильтр VW/Audi", "Газон 53 крестовина",
    ];
    const folded = names.map((name) => name.toLowerCase().replaceAll("ё", "е"));
    const result = await database.query<{ kind: string | null; position: number }>(
      `SELECT product.position::int AS position, ${backfill} AS kind
       FROM unnest($1::text[]) WITH ORDINALITY AS product(name_folded, position) ORDER BY product.position`, [folded],
    );
    expect(result.rows.map((row, index) => [names[index], row.kind]))
      .toEqual(names.map((name) => [name, vehicleKindOfName(name)]));
  });

  it("refuses a kind the catalogue does not know in the column itself", async () => {
    await expect(database.query("UPDATE app.products SET vehicle_kind='bus' WHERE id=$1", [ids.get("KP-4")])).rejects.toThrow(/products_vehicle_kind_check/u);
  });

  it("narrows a section to one kind of vehicle and counts each kind in it", async () => {
    for (const product of PRODUCTS.filter((entry) => entry.kind !== null)) {
      const page = await service.products({ category: SECTION, vehicleKind: product.kind });
      expect(page.items.map((item) => item.sku)).toEqual([product.sku]);
      expect(page.total).toBe(1);
    }
    expect((await service.products({ category: SECTION, limit: "96" })).total).toBe(PRODUCTS.length);
    await expect(service.vehicleKinds(SECTION)).resolves.toEqual({ items: [
      { kind: "passenger", productCount: 1 }, { kind: "truck", productCount: 1 }, { kind: "tractor", productCount: 1 },
    ] });
    // With a search text as well: the kind is one more condition, not another list.
    expect((await service.products({ category: SECTION, q: "колодки", vehicleKind: "truck" })).total).toBe(0);
    expect((await service.products({ category: SECTION, q: "колодки", vehicleKind: "passenger" })).items.map((item) => item.sku)).toEqual(["KP-3"]);
  });

  it("puts what customers keep and open first, and the rest in the order of their names", async () => {
    const page = await service.products({ category: SECTION, sort: "popular", limit: "96" });
    const byName = await service.products({ category: SECTION, sort: "name", limit: "96" });
    expect(page.items.slice(0, 2).map((item) => item.sku)).toEqual(["KP-3", "KP-2"]);
    expect(page.items.slice(2).map((item) => item.sku))
      .toEqual(byName.items.map((item) => item.sku).filter((sku) => sku !== "KP-3" && sku !== "KP-2"));
    // Two products a page: the second page goes on from where the first stopped.
    const second = await service.products({ category: SECTION, sort: "popular", limit: "2", offset: "2" });
    expect(second.items.map((item) => item.sku)).toEqual(page.items.slice(2, 4).map((item) => item.sku));
  });

  it("counts what was ordered in the last half a year, and not a cancelled or an old order", async () => {
    const scores = new Map<string, number>();
    await database.transaction(async (client) => {
      const order = async (status: string, daysAgo: number, sku: string, quantity: number) => {
        const placed = await client.query<{ id: string }>(
          `INSERT INTO app.orders (public_number,idempotency_key,status,customer_email,customer_phone,customer_name,contact_snapshot,
                                   subtotal_kopeks,total_amount_kopeks,created_at)
           VALUES ($1,$1,$2::app.order_status,'buyer@example.test','+70000000000','Покупатель','{}'::jsonb,0,0,clock_timestamp() - make_interval(days => $3))
           RETURNING id`, [`${PREFIX}${status}-${daysAgo}-${sku}`, status, daysAgo],
        );
        await client.query(
          "INSERT INTO app.order_items (order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_kopeks) VALUES ($1,$2,$3,$3,$4,0)",
          [placed.rows[0]!.id, ids.get(sku), sku, quantity],
        );
      };
      await order("completed", 3, "KP-1", 3);
      await order("cancelled", 3, "KP-2", 100);
      await order("completed", 200, "KP-4", 100);
      await client.query("REFRESH MATERIALIZED VIEW app.product_popularity");
      const stored = await client.query<{ product_id: string; score: string }>(
        "SELECT product_id,score::text FROM app.product_popularity WHERE product_id=ANY($1::uuid[])", [[...ids.values()]],
      );
      for (const row of stored.rows) scores.set(row.product_id, Number(row.score));
      // An order line cannot be deleted (it is the customer's receipt): the orders of this test are rolled back.
      throw new Rollback();
    }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    expect(scores.get(ids.get("KP-1")!)).toBe(15);
    expect(scores.get(ids.get("KP-2")!)).toBe(1);
    expect(scores.get(ids.get("KP-3")!)).toBe(4);
    expect(scores.has(ids.get("KP-4")!)).toBe(false);
  });

  it("shows the other packs of the same oil on its page, smallest first, and not the other viscosity", async () => {
    const one = await service.product("kind-popularity-4");
    expect(one.packSizes.map((pack) => [pack.label, pack.slug])).toEqual([["4 л", "kind-popularity-5"], ["20 л", "kind-popularity-6"]]);
    const twenty = await service.product("kind-popularity-6");
    expect(twenty.packSizes.map((pack) => pack.label)).toEqual(["1 л", "4 л"]);
    expect((await service.product("kind-popularity-7")).packSizes).toEqual([]);
    expect((await service.product("kind-popularity-3")).packSizes).toEqual([]);
  });
});
