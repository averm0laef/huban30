// «Качество каталога»: the lists of what is wrong in the owner's 1С, on real PostgreSQL. Skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a migrated scratch database.

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogQualityService } from "./catalog-quality.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const PREFIX = "quality-fixture:";

const PRODUCTS = [
  { key: "audit", sku: "1106", name: "АУДИТ 17.07.2025", brand: false, category: "bez-kategorii", stock: 0, price: null },
  { key: "oil", sku: "1106", name: "Масло п-синт. MANNOL Diesel Extra SAE 10W-40 (5л.) 1106", brand: false, category: "polusinteticheskie-motornye-masla", stock: 4, price: 120_000 },
  { key: "lamp", sku: "QF-3930", name: "Лампа T4W 24V BA9s", brand: true, category: "signalnye-lampy", stock: 2, price: 10_000 },
  { key: "lamp-twin", sku: "QF-3931", name: "Лампа T4W 24V  BA9s", brand: true, category: "signalnye-lampy", stock: 0, price: 5_000 },
  { key: "no-article", sku: "00-00009366", name: "Хомут силовой 20-22мм", brand: false, category: "homuty", stock: 1, price: 0 },
] as const;

describe.skipIf(!url)("what is wrong in the catalogue, for the staff (real PostgreSQL)", () => {
  let database: DatabaseService;
  let quality: CatalogQualityService;
  const ids = new Map<string, string>();

  const remove = async () => {
    await database.query("DELETE FROM app.product_prices WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.inventory_balances WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.brands WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.warehouses WHERE external_id LIKE $1", [`${PREFIX}%`]);
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    quality = new CatalogQualityService(database);
    await remove();
    const brand = (await database.query<{ id: string }>("INSERT INTO app.brands (external_id,name,slug) VALUES ($1,'OSRAM','quality-osram') RETURNING id", [`${PREFIX}brand`])).rows[0]!.id;
    const warehouse = (await database.query<{ id: string }>("INSERT INTO app.warehouses (external_id,code,name) VALUES ($1,'QF','Склад') RETURNING id", [`${PREFIX}warehouse`])).rows[0]!.id;
    for (const product of PRODUCTS) {
      const id = (await database.query<{ id: string }>(
        `INSERT INTO app.products (external_id,sku,name,slug,brand_id,category_id)
         SELECT $1,$2,$3,$4,$5,category.id FROM app.categories AS category WHERE category.slug=$6 RETURNING id`,
        [product.key === "no-article" ? "00-00009366" : `${PREFIX}${product.key}`, product.sku, product.name, `quality-${product.key}`, product.brand ? brand : null, product.category],
      )).rows[0]!.id;
      ids.set(product.key, id);
      if (product.price !== null) await database.query("INSERT INTO app.product_prices (product_id,amount_kopeks) VALUES ($1,$2)", [id, product.price]);
      await database.query("INSERT INTO app.inventory_balances (product_id,warehouse_id,quantity_on_hand) VALUES ($1,$2,$3)", [id, warehouse, product.stock]);
    }
    // The product without an article has the 1С code for its external id, as the list export gives it.
    await database.query("UPDATE app.products SET external_id=$2 WHERE id=$1", [ids.get("no-article"), `${PREFIX}00-00009366`]);
    await database.query("UPDATE app.products SET sku=$2 WHERE id=$1", [ids.get("no-article"), "00-00009366"]);
  }, 60_000);

  afterAll(async () => {
    if (database) await remove();
    await database?.onModuleDestroy?.();
  });

  const listed = async (check: string) => (await quality.list({ check, limit: "50" })).items
    .map((item) => [...ids].find(([, id]) => id === item.id)?.[0]).filter(Boolean);

  it("counts every check", async () => {
    const counts = await quality.summary();
    expect(counts.no_brand).toBeGreaterThanOrEqual(3);
    expect(Object.keys(counts).sort()).toEqual(["duplicate_name", "no_brand", "no_photo", "no_price", "no_sku", "service_name", "shared_number", "uncategorized"]);
  });

  it("lists each problem, what is in stock first", async () => {
    expect(await listed("no_brand")).toEqual(["oil", "no-article", "audit"]);
    expect(await listed("shared_number")).toEqual(["oil", "audit"]);
    expect(await listed("service_name")).toEqual(["audit"]);
    expect(await listed("duplicate_name")).toEqual(["lamp", "lamp-twin"]);
    expect(await listed("uncategorized")).toEqual(["audit"]);
    expect(await listed("no_price")).toEqual(["no-article", "audit"]);
    expect(await listed("no_sku")).toEqual(["no-article"]);
  });

  it("writes a list for 1С that Excel opens: a code to find the item by and what to do", async () => {
    const csv = await quality.csv("no_brand");
    expect(csv.startsWith("\uFEFFКод 1С;Артикул;Название;Бренд;Раздел;Остаток;Цена, ₽;Что сделать\r\n")).toBe(true);
    expect(csv).toContain(`${PREFIX}oil;1106;"Масло п-синт. MANNOL Diesel Extra SAE 10W-40 (5л.) 1106";;`);
    expect(csv).toContain("Заполнить «Производитель»");
  });

  it("refuses a check it does not know", async () => {
    await expect(quality.list({ check: "drop table" })).rejects.toThrow();
  });
});
