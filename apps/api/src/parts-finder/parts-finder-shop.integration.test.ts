// Real-database check of how a requested number reaches our product
// (SHOP_OFFERS_SQL, app.article_crosses, brand identities; migration 0042).
// Skipped unless CATALOG_SEARCH_DATABASE_URL points at a scratch database --
// see catalog/catalog-search-regression.test.ts for how to prepare one.

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeCatalogSearchFixtures, seedCatalogSearchFixtures } from "../catalog/catalog-search-fixtures.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderCrossStore } from "./parts-finder-crosses.store.js";
import { PartsFinderShopService } from "./parts-finder-shop.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

describe.skipIf(!url)("shop offers through the cross graph (real PostgreSQL)", () => {
  let database: DatabaseService;
  let shop: PartsFinderShopService;
  let store: PartsFinderCrossStore;

  const status = async (article: string) => (await database.query<{ evidence: string[]; relation: string | null; status: string }>(
    "SELECT status,relation,evidence FROM app.article_crosses WHERE article_a=app.normalize_article($1) OR article_b=app.normalize_article($1)", [article],
  )).rows;

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    await database.transaction((client) => seedCatalogSearchFixtures(client));
    await database.query("DELETE FROM app.article_crosses");
    shop = new PartsFinderShopService(database);
    store = new PartsFinderCrossStore(database);
    // Our MANN W 914/2 (fixture) as a FAPI card: its original number, a
    // replacement, one verified and one plain analog.
    await store.remember({
      part: { article: "W 914/2", brand: "MANN-FILTER" },
      groups: {
        analogs: [{ article: "OC 9999", brand: "KNECHT" }, { article: "PH 2222", brand: "FRAM", manufacturer_verified: true }],
        oe: [{ article: "90915-YZZE1", brand: "TOYOTA" }],
        replaced_by: [{ article: "W 914/2 (10)", brand: "MANN-FILTER" }],
      },
    });
    // Somebody else's filter for the same original number.
    await store.remember({ part: { article: "SAK-1111", brand: "SAKURA" }, groups: { oe: [{ article: "90915YZZE1", brand: "Lexus" }] } });
  }, 60_000);

  afterAll(async () => {
    await database?.query("DELETE FROM app.article_crosses");
    await database?.transaction((client) => removeCatalogSearchFixtures(client));
    await database?.onModuleDestroy?.();
  });

  const first = async (article: string, brand: string | null) => (await shop.lookup([{ article, brand }], 5)).for({ article, brand })[0];

  it("finds our product by its own number whatever the brand spelling", async () => {
    expect(await first("w914/2", "MANN")).toMatchObject({ matchedVia: "exact", sku: "W 914/2" });
  });

  it("knows the article 1С keeps with a second number in the same field, by either number", async () => {
    expect(await shop.filedUnder(["7515"])).toEqual(["7515 (32215)"]);
    expect(await shop.filedUnder(["322-15", "nothing-such"])).toEqual(["7515 (32215)"]);
    expect(await first("7515 (32215)", null)).toMatchObject({ matchedVia: "exact", name: "Подшипник 7515 (32215)" });
    // Too short to be a number, and a number that only begins the same way.
    expect(await shop.filedUnder(["751"])).toEqual([]);
    expect(await shop.filedUnder(["75150"])).toEqual([]);
  });

  it("tells a product word with a size from a part number", async () => {
    expect(await shop.namesProducts("лампа h7")).toBe(true);
    expect(await shop.namesProducts("лампы h7")).toBe(true);
    expect(await shop.namesProducts("mobil 5w40")).toBe(true);
    expect(await shop.namesProducts("цшзук 300")).toBe(false);
    expect(await shop.namesProducts("04152-40060")).toBe(false);
    expect(await shop.namesProducts("W 914/2")).toBe(false);
  });

  it("names our product without the staff's notes typed into its name in 1С", async () => {
    expect(await first("KP-170", null)).toMatchObject({ matchedVia: "exact", name: "Клипса крепежная TORSO", sku: "KP-170" });
  });

  it("answers an original number with our confirmed analog; Lexus and Toyota are one maker", async () => {
    expect(await first("90915-YZZE1", "Lexus")).toMatchObject({ matchedVia: "cross", sku: "W 914/2" });
    expect(await first("PH2222", "Fram")).toMatchObject({ matchedVia: "cross", sku: "W 914/2" });
  });

  it("offers a single-source analog and a part sharing the original number only as possible", async () => {
    expect(await first("OC9999", "Knecht")).toMatchObject({ matchedVia: "possible", sku: "W 914/2" });
    expect(await first("SAK1111", "Sakura")).toMatchObject({ matchedVia: "possible", sku: "W 914/2" });
  });

  it("never follows a brand that is not the pair's brand, nor a rejected pair", async () => {
    expect(await first("90915-YZZE1", "Nissan")).toBeUndefined();
    await database.query("UPDATE app.article_crosses SET status='rejected' WHERE article_a='OC9999' OR article_b='OC9999'");
    expect(await first("OC9999", "Knecht")).toBeUndefined();
    await store.remember({ part: { article: "W 914/2", brand: "MANN-FILTER" }, groups: { analogs: [{ article: "OC 9999", brand: "KNECHT", manufacturer_verified: true }] } });
    expect((await status("OC9999"))[0]!.status).toBe("rejected");
  });

  it("records what a pair says and confirms a plain analog once a second source agrees", async () => {
    expect(await status("90915YZZE1")).toEqual(expect.arrayContaining([expect.objectContaining({ evidence: ["fapi"], status: "confirmed" })]));
    expect((await status("90915YZZE1")).every((row) => row.relation === "oe_a" || row.relation === "oe_b")).toBe(true);
    await store.remember({ part: { article: "GDB1330", brand: "TRW" }, groups: { analogs: [{ article: "P 83 052", brand: "BREMBO" }] } });
    await store.remember({ part: { article: "GDB1330", brand: "TRW" }, groups: { analogs: [{ article: "P 83 052", brand: "BREMBO" }] } });
    expect((await status("P83052"))[0]).toMatchObject({ evidence: ["fapi"], relation: "analog", status: "unconfirmed" });
    // The supplier's cross table (apps/worker article-cross-ingest) names the same pair.
    await database.query(
      `UPDATE app.article_crosses SET
         status=app.article_cross_merged_status(status,evidence,brand_a,brand_b,'unconfirmed','rossko'),
         confirmed_at=now(),evidence=evidence || 'rossko'::text
       WHERE article_a='GDB1330' OR article_b='GDB1330'`,
    );
    expect(await first("P83052", "Brembo")).toMatchObject({ matchedVia: "cross", sku: "GDB1330" });
  });
});
