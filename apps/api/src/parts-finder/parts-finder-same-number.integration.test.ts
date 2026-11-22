// Real-database check that a shared number alone never makes another product an analog
// (SHOP_OFFERS_SQL step 0 and same-part-number.ts; docs/CATALOG_MATCHING.md, «Совпадение номера»).
// The products are real names from the owner's 1С list. Skipped unless CATALOG_SEARCH_DATABASE_URL
// points at a scratch database -- see catalog/catalog-search-regression.test.ts for how to prepare one.

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderCrossStore } from "./parts-finder-crosses.store.js";
import { PartsFinderShopService, type ShopOfferRequest } from "./parts-finder-shop.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const PREFIX = "same-number-fixture:";

const PRODUCTS = [
  { key: "lamp", sku: "3930", name: "3930 Лампа T4W 24V BA9s Osram", brand: "OSRAM", category: "signalnye-lampy" },
  { key: "lamp-twin", sku: "3930", name: "Лампа OSRAM 3930", brand: "OSRAM", category: "avtolampy" },
  { key: "oil", sku: "3930", name: "3930 10W-40 SL/CF OPTIMAL 4л/5л (полусинт.мотор.масло) Liqui Moly 3930", brand: "LIQUI MOLY", category: "polusinteticheskie-motornye-masla" },
  { key: "filter", sku: "LC-341", name: "LC-341 Фильтр масляный LYNXauto Union C-341", brand: "LYNXauto", category: "maslyanye-filtry" },
  { key: "paint", sku: "LC341", name: "Краска-аэрозоль LUCKY золотая, 530мл (1/40) 90515", brand: null, category: "kraski-i-gruntovki" },
  { key: "clamp", sku: "20-22", name: "20-22 Хомут силовой 20-22мм", brand: null, category: "homuty" },
  { key: "spanner", sku: "20*22", name: "Ключ рожковый 20*22", brand: null, category: "klyuchi-i-golovki" },
  { key: "element", sku: "7405-1012040", name: "элемент масляного фильтра 7405-1012040 бумага Евро+ЯМЗ МАЗ г.Гродно шт.", brand: null, category: "maslyanye-filtry" },
  { key: "element-mesh", sku: "74051012040", name: "Элемент масляного фильтра 7405-1012040 м/сетка ДФВ 4803 Евро \"ДЗАФ\" (2317)", brand: null, category: "maslyanye-filtry" },
  { key: "element-kamaz", sku: "7405 1012040", name: "Элемент масляного фильтра КамАЗ 7405-1012040 (сетка)", brand: null, category: "maslyanye-filtry" },
  { key: "element-queued", sku: "7405-1012040", name: "Эл-т МФ ЕВРО (сетка) (Челны) Камаз 7405-1012040 74051012040", brand: null, category: "bez-kategorii" },
  // Two analogs the catalogue might name for the 24 V lamp: one of them is a 12 V lamp.
  { key: "lamp-24v-analog", sku: "17131", name: "Лампа T4W 24V BA9s Narva 17131", brand: "NARVA", category: "signalnye-lampy" },
  { key: "lamp-12v-analog", sku: "12929", name: "Лампа T4W 12V BA9s Philips 12929", brand: "PHILIPS", category: "signalnye-lampy" },
  // Belts of one standard size from three makers, and one a little longer.
  { key: "belt", sku: "4PK898", name: "4PK898 Ремень поликлиновый LYNXauto 4PK0898", brand: "LYNXauto", category: "remni" },
  { key: "belt-gates", sku: "4PK898G", name: "Ремень поликлиновый Gates 4PK898", brand: null, category: "remni" },
  { key: "belt-dayco", sku: "4PK0898D", name: "4PK0898D Ремень ручейковый Dayco 4PK 898", brand: null, category: "remni" },
  { key: "belt-longer", sku: "4PK900", name: "4PK900 Ремень поликлиновый LYNXauto", brand: "LYNXauto", category: "remni" },
] as const;

type Key = (typeof PRODUCTS)[number]["key"];

describe.skipIf(!url)("a shared number alone is not an analog (real PostgreSQL)", () => {
  let database: DatabaseService;
  let shop: PartsFinderShopService;
  const ids = new Map<Key, string>();

  const remove = async () => {
    await database.query("DELETE FROM app.article_crosses WHERE article_a IN ('3930','17131','12929') OR article_b IN ('3930','17131','12929')");
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.brands WHERE external_id LIKE $1", [`${PREFIX}%`]);
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    shop = new PartsFinderShopService(database);
    await remove();
    const brands = new Map<string, string>();
    for (const brand of new Set(PRODUCTS.flatMap((product) => (product.brand ? [product.brand] : [])))) {
      const row = await database.query<{ id: string }>(
        "INSERT INTO app.brands (external_id,name,slug) VALUES ($1,$2,$3) RETURNING id",
        [`${PREFIX}${brand}`, brand, `same-number-${brand.toLowerCase().replace(/[^a-z]+/gu, "-")}`],
      );
      brands.set(brand, row.rows[0]!.id);
    }
    for (const product of PRODUCTS) {
      const row = await database.query<{ id: string }>(
        `INSERT INTO app.products (external_id,sku,name,slug,brand_id,category_id)
         SELECT $1,$2,$3,$4,$5,category.id FROM app.categories AS category WHERE category.slug=$6 RETURNING id`,
        [`${PREFIX}${product.key}`, product.sku, product.name, `same-number-${product.key}`, product.brand ? brands.get(product.brand) : null, product.category],
      );
      ids.set(product.key, row.rows[0]!.id);
    }
  }, 60_000);

  afterAll(async () => {
    if (database) await remove();
    await database?.onModuleDestroy?.();
  });

  const found = async (request: ShopOfferRequest, only?: "exact"): Promise<Key[]> => {
    const offers = (await shop.lookup([request], 10)).for(request).filter((offer) => !only || offer.matchedVia === only);
    return offers.map((offer) => PRODUCTS.find((product) => ids.get(product.key) === offer.productId)!.key).sort();
  };
  const card = (key: Key, brand: string | null = null): ShopOfferRequest => ({
    article: PRODUCTS.find((product) => product.key === key)!.sku, brand, productId: ids.get(key)!,
  });

  it("the OSRAM 3930 lamp sees its second card, not the LIQUI MOLY 3930 oil", async () => {
    expect(await found(card("lamp", "OSRAM"))).toEqual(["lamp", "lamp-twin"]);
  });

  it("takes the brand of the product itself, not the one the page sent", async () => {
    expect(await found(card("lamp", "LIQUI MOLY"))).toEqual(["lamp", "lamp-twin"]);
  });

  it("the LYNXauto LC-341 filter does not see the LUCKY LC341 spray paint", async () => {
    expect(await found(card("filter", "LYNXauto"))).toEqual(["filter"]);
  });

  it("the 20-22 clamp does not see the 20*22 spanner", async () => {
    expect(await found(card("clamp"))).toEqual(["clamp"]);
  });

  it("a filter element without a brand keeps the other elements of its number, not the one still in the queue", async () => {
    expect(await found(card("element"))).toEqual(["element", "element-kamaz", "element-mesh"]);
  });

  it("a catalogue's part known by brand and description reaches only that kind of our product", async () => {
    expect(await found({ article: "3930", brand: "OSRAM", name: "Лампа накаливания" })).toEqual(["lamp", "lamp-twin"]);
    expect(await found({ article: "7405-1012040", brand: "КАМАЗ", name: "Элемент масляного фильтра" })).toEqual(["element", "element-kamaz", "element-mesh"]);
    expect(await found({ article: "7405-1012040", brand: "КАМАЗ" })).toEqual([]);
  });

  it("a confirmed cross to a lamp of another voltage stays off the card; one of the same voltage is shown", async () => {
    await new PartsFinderCrossStore(database).remember({
      part: { article: "3930", brand: "OSRAM" },
      groups: { analogs: [{ article: "17131", brand: "NARVA", manufacturer_verified: true }, { article: "12929", brand: "PHILIPS", manufacturer_verified: true }] },
    });
    expect(await found(card("lamp", "OSRAM"))).toEqual(["lamp", "lamp-24v-analog", "lamp-twin"]);
    const request = card("lamp", "OSRAM");
    const basis = Object.fromEntries((await shop.lookup([request], 10)).for(request).map((offer) => [offer.sku, offer.basis]));
    expect(basis).toEqual({ "3930": "same_number", "17131": "maker" });
  });

  it("offers parts of any maker of the same standard size, and of that size only", async () => {
    const keys = (offers: Array<{ productId: string }>) => offers.map((offer) => PRODUCTS.find((product) => ids.get(product.key) === offer.productId)!.key).sort();
    const belt = await shop.sameSize(ids.get("belt")!, 10);
    expect(belt?.label).toBe("4PK898");
    expect(keys(belt!.offers)).toEqual(["belt-dayco", "belt-gates"]);
    const lamp = await shop.sameSize(ids.get("lamp")!, 10);
    expect(lamp?.label).toBe("T4W 24 В BA9s");
    expect(keys(lamp!.offers)).toEqual(["lamp-24v-analog"]);
    expect(await shop.sameSize(ids.get("filter")!, 10)).toBeNull();
  });

  it("a customer who typed only the number sees every product of that number", async () => {
    expect(await found({ article: "3930", brand: null }, "exact")).toEqual(["lamp", "lamp-twin", "oil"]);
  });
});
