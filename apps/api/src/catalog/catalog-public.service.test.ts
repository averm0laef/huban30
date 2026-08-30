import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicController } from "./catalog-public.controller.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { normalizeArticleNumber } from "./catalog-search-normalize.js";

const PRODUCT_ID = "019bf9ea-0d3e-7def-9c9a-000000000010";
const IMAGE_ID = "019bf9ea-0d3e-7def-8c9a-000000000011";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    available_quantity: "7",
    brand_id: "019bf9ea-0d3e-7def-8c9a-000000000020",
    brand_name: "NGK",
    brand_slug: "ngk",
    category_id: "019bf9ea-0d3e-7def-8c9a-000000000030",
    category_name: "Фильтры",
    category_slug: "filters",
    created_at: new Date("2026-08-01T01:00:00.000Z"),
    id: PRODUCT_ID,
    name: "Фильтр масляный",
    price_kopeks: "125000",
    primary_image_alt_text: null,
    primary_image_byte_size: null,
    primary_image_id: null,
    primary_image_is_primary: null,
    primary_image_mime_type: null,
    sku: "FILTER-1",
    slug: "oil-filter-1",
    total_count: "1",
    updated_at: new Date("2026-08-02T01:00:00.000Z"),
    ...overrides,
  };
}

describe("CatalogPublicService", () => {
  const query = vi.fn();
  const read = vi.fn();
  const storage: StorageProvider = {
    name: "local",
    read,
    remove: vi.fn(),
    store: vi.fn(),
  };
  const database = {
    query,
    transaction: async <T>(work: (client: { query: typeof query }) => Promise<T>) => work({
      query: vi.fn((text: string, values?: unknown[]) => (
        text.startsWith("SET LOCAL") ? Promise.resolve({ rows: [] }) : query(text, values)
      )),
    }),
  };
  const service = new CatalogPublicService(
    new CatalogCategoryTreeCache(),
    database as unknown as DatabaseService,
    storage,
  );

  beforeEach(() => {
    query.mockReset();
    read.mockReset();
  });

  it("rejects malformed catalog filters before querying PostgreSQL", async () => {
    await expect(service.products({ minPriceKopeks: "200", maxPriceKopeks: "100" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.products({ brand: ["ngk", "ngk"] }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("applies server-side filters and returns deterministic pagination", async () => {
    query
      .mockResolvedValueOnce({ rows: [productRow()] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });

    await expect(service.products({
      availability: "in_stock",
      brand: "ngk",
      category: "filters",
      limit: "12",
      maxPriceKopeks: "200000",
      minPriceKopeks: "100000",
      offset: "24",
      q: "фильтр",
      sort: "price_asc",
    })).resolves.toMatchObject({
      items: [{
        availableQuantity: 7,
        name: "Фильтр масляный",
        priceKopeks: 125000,
        primaryImage: null,
      }],
      limit: 12,
      offset: 24,
      total: 1,
    });

    const [itemsSql, itemsParameters] = query.mock.calls[0] as [string, unknown[]];
    expect(itemsSql).toContain("warehouse.is_active");
    expect(itemsSql).toContain("storage.status='available'");
    expect(itemsSql).toContain("price.amount_kopeks ASC NULLS LAST");
    // The category filter matches the category itself and every descendant
    // (category_subtree), not only an exact slug match — a search scoped to
    // "Кузов" must also surface products filed under "Кузов / Щётки".
    expect(itemsSql).toContain("category_subtree");
    expect(itemsSql).toContain("category.id IN (SELECT id FROM category_subtree)");
    expect(itemsParameters).toEqual([
      "фильтр",
      "фильтр",
      "filters",
      ["ngk"],
      100000,
      200000,
      "in_stock",
      normalizeArticleNumber("фильтр"),
      // A Cyrillic query needs neither transliteration nor a layout-swap
      // recovery — see alternateSearchQueries.
      [],
      "local",
      12,
      24,
      ["image/avif", "image/jpeg", "image/png", "image/webp"],
    ]);
  });

  it("ranks an exact normalised article match before a prefix match before fuzzy name relevance", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await service.products({ q: "w914-2" });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    // Rank order lives in ORDER BY. The same LIKE also appears earlier in the
    // WHERE clause, so searching the whole statement would measure the filter
    // rather than the ranking and read the tiers as inverted.
    const ranking = sql.slice(sql.lastIndexOf("ORDER BY"));
    const exactTier = ranking.indexOf("product.sku_normalized=$8");
    const prefixTier = ranking.indexOf("product.sku_normalized LIKE $8");
    const fuzzyTier = ranking.indexOf("similarity(product.name");
    const nameTiebreak = ranking.indexOf("lower(product.name) ASC");
    expect(exactTier).toBeGreaterThan(-1);
    expect(prefixTier).toBeGreaterThan(exactTier);
    expect(fuzzyTier).toBeGreaterThan(prefixTier);
    expect(nameTiebreak).toBeGreaterThan(fuzzyTier);
    expect(parameters[7]).toBe(normalizeArticleNumber("w914-2"));
    expect(parameters[7]).toBe("W9142");
  });

  it("recovers a Cyrillic word typed in Latin, both phonetically and via a wrong keyboard layout", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "filtr" });
    const [, phoneticParameters] = query.mock.calls[0] as [string, unknown[]];
    // filtr -> "филтр" (transliteration) and "ашдек" (layout swap) — see
    // packages/contracts/src/catalog-search-normalize.test.ts for how each
    // is derived. Both are searched, not just one.
    expect(phoneticParameters[8]).toEqual(["филтр", "ашдек"]);

    query.mockResolvedValueOnce({ rows: [] });
    // The task's own example: "фильтр" typed with the OS layout left on
    // English lands as "abkmnh".
    await service.products({ q: "abkmnh" });
    const [layoutSql, layoutParameters] = query.mock.calls[1] as [string, unknown[]];
    expect(layoutParameters[8]).toEqual(["абкмнх", "фильтр"]);
    // The alt-query branch is folded into the existing WHERE/ORDER BY, not a
    // second statement — extend the one search path, not a parallel one.
    expect(layoutSql).toContain("unnest($9::text[])");
    expect(query.mock.calls).toHaveLength(2);
  });

  it("does not attempt Latin recovery on a query that is already Cyrillic or is an article-shaped code", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "фильтр" });
    expect((query.mock.calls[0] as [string, unknown[]])[1][8]).toEqual([]);

    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "w914-2" });
    // Only one Latin letter ("w") — too little signal to guess a misspelled
    // word from, and normalizeArticleNumber already owns this case.
    expect((query.mock.calls[1] as [string, unknown[]])[1][8]).toEqual([]);
  });

  it("folds ё to е on the query, in both directions, so a plain-е query and a ё query converge", async () => {
    // AN30-013 search-gap fix: a product name stored with a ё (1C exports
    // "Щётка стеклоочистителя ...") was unreachable by the near-universal
    // plain spelling "щетка", because nothing folded ё to е anywhere on the
    // search path. foldYo now runs on the query before it becomes $1/$2 —
    // see catalog-search-normalize.ts's foldYo and this file's module
    // comment on PUBLIC_PRODUCT_FILTERS.
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "щётка" });
    const [, yoParameters] = query.mock.calls[0] as [string, unknown[]];

    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "щетка" });
    const [, plainParameters] = query.mock.calls[1] as [string, unknown[]];

    // Both spellings produce the *identical* $1/$2 — proof that whichever
    // way the customer happens to type it, PostgreSQL receives the same
    // free-text query and so returns the same rows, regardless of which
    // spelling (if either) the stored product name actually used.
    expect(yoParameters[0]).toBe("щетка");
    expect(yoParameters[1]).toBe("щетка");
    expect(plainParameters[0]).toBe("щетка");
    expect(plainParameters[1]).toBe("щетка");
    expect(yoParameters[9]).toEqual(plainParameters[9]);

    // $8 is the *article* parameter and deliberately keeps the ё: it is
    // matched against product.sku_normalized, which app.normalize_article
    // (migration 0016) builds without any ё fold, so folding only the query
    // side would break the agreement the two sides already have. The narrow
    // consequence — a SKU that literally contains ё is not reachable by its
    // plain-е spelling — is accepted because article numbers are Latin and
    // digits in practice; see this service's $8 comment.
    expect(yoParameters[7]).toBe("ЩЁTKA");
    expect(plainParameters[7]).toBe("ЩETKA");
  });

  it("folds Ё (upper-case) too, and folds every alt-query candidate the same way", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "ЁЖ ФИЛЬТР" });
    const [, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters[0]).toBe("ЕЖ ФИЛЬТР");
  });

  it("matches ё/е-folded, generated columns rather than the raw name/search_text columns", async () => {
    // The other half of the fold: folding only the query would still miss a
    // product whose *stored* name carries the ё (the shop's actual case).
    // product.name_folded / product.search_text_folded are generated
    // columns (migration 0025) built through app.fold_yo, the SQL mirror of
    // foldYo — so both sides of every comparison are folded the same way.
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "щетка" });
    const [sql] = query.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain("product.name_folded ILIKE");
    expect(sql).toContain("similarity(product.name_folded, $1)");
    expect(sql).toContain("to_tsvector('simple',product.search_text_folded)");
    // The raw (unfolded) columns must not be the ones actually matched —
    // only the display-only final tiebreaker (lower(product.name) ASC, an
    // existing, unrelated stable-sort clause) legitimately still names the
    // raw column.
    expect(sql).not.toContain("product.name ILIKE");
    expect(sql).not.toContain("coalesce(product.search_text,product.name)");
  });

  it("adds real Russian stemming as an additive full-text branch, in both the filter and the ranking", async () => {
    // Gap 2: search only ever matched substrings/trigrams/'simple' lexemes
    // of the exact text typed, never a Russian word form ("щёток" the
    // genitive plural vs "щётка"). PostgreSQL's built-in 'russian'
    // text-search config already ships a real (Snowball) stemmer, so this
    // reuses the existing to_tsvector/websearch_to_tsquery idiom instead of
    // taking on a full morphological-analysis dependency.
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "фильтры", sort: "relevance" });
    const [sql] = query.mock.calls[0] as [string, unknown[]];

    // Present in the filter (can add a match)... sliced at the LAST
    // "ORDER BY", not the first: the primary-image LATERAL join carries an
    // "ORDER BY image.is_primary" of its own that sits *before* the WHERE
    // clause, so slicing at the first occurrence cuts the filter away
    // entirely and the assertion below would pass or fail for the wrong
    // reason.
    const filterPart = sql.slice(0, sql.lastIndexOf("ORDER BY"));
    expect(filterPart).toContain("to_tsvector('russian',product.search_text_folded)");
    expect(filterPart).toContain("websearch_to_tsquery('russian',$1)");
    // ...and in the ranking (a stemmed hit still only ever competes as a
    // last-resort relevance signal, never ahead of an exact/prefix article
    // match — same GREATEST() as the existing trigram/'simple' terms).
    const ranking = sql.slice(sql.lastIndexOf("ORDER BY"));
    const exactArticleTier = ranking.indexOf("product.sku_normalized=$8");
    const russianTerm = ranking.indexOf("ts_rank_cd(to_tsvector('russian',product.search_text_folded)");
    expect(russianTerm).toBeGreaterThan(exactArticleTier);
    expect(ranking).toContain("websearch_to_tsquery('russian',$1)");
  });

  it("documents a Russian word form the stemmer deliberately does not recover", () => {
    // "щёток" (genitive plural of "щётка") is the motivating example for
    // this fix, and real (Snowball) stemming still does not catch it: its
    // "о" is an epenthetic ("fleeting") vowel Russian inserts because this
    // form has no case ending of its own ("щётка" -> "щёт"+"о"+"к"), not a
    // suffix — there is nothing for a suffix-stripping stemmer to strip, so
    // 'russian' stems "щеток" (ё-folded) to itself, not to "щетк" (what it
    // gives "щетка"). Recovering this specific, common-in-practice case
    // would need a real morphological dictionary, which this fix
    // deliberately does not take on.
    //
    // This suite mocks the database client (see the `database` object at
    // the top of this file) rather than running against a real PostgreSQL,
    // so the actual stemmer output cannot be asserted here. Instead this
    // reads migration 0025's own SQL comment and pins the gap it documents,
    // so the claim above stays traceable to source and cannot silently
    // drift or be deleted without failing a test.
    const migrationSql = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../packages/database/migrations/0025_catalog_search_yo_and_word_forms.sql",
      ),
      "utf8",
    );
    expect(migrationSql).toContain('It does NOT fix "щёток" itself');
    expect(migrationSql).toContain("epenthetic");
    expect(migrationSql).toContain("no suffix");
  });

  it("a two-letter query matches nothing by design, not by omission", async () => {
    // CatalogProductsQuerySchema accepts a 2-character query (min(2)), but
    // PUBLIC_PRODUCT_FILTERS' length>=3 guard on the substring/trigram/
    // full-text/alt-query branches deliberately excludes it: a 2-letter
    // Cyrillic prefix like "фи" is too generic a signal (near-every "Фильтр
    // ..." AND "Фитинг ..." AND unrelated name would qualify) to be useful
    // recall rather than noise, and ILIKE '%фи%' / a raw trigram scan at
    // that length is exactly the kind of query this codebase already
    // refuses to run unindexed over 30-40k rows. This is the same threshold
    // the sku_normalized prefix and cross-equivalent branches do not need
    // (those are indexed exact/prefix lookups, not fuzzy scans), so it does
    // not block a short *article* search — only short free-text.
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "фи" });
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("length($1)>=3");
  });

  it("widens search to confirmed article-cross equivalents, ranked between an exact and a prefix match", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await service.products({ q: "w914-2" });

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    // Symmetric lookup: a confirmed cross is found whichever side of the
    // stored pair the searched article landed on (see migration 0018's
    // "one row per pair" comment) — both UNION branches must be present.
    expect(sql).toContain("WHERE article_a=$8 AND status='confirmed'");
    expect(sql).toContain("WHERE article_b=$8 AND status='confirmed'");
    // Never widens on an unconfirmed cross — this is the actual enforcement
    // of the correctness bar: nothing in this statement ever reads a
    // article_crosses row without also filtering status='confirmed'.
    expect(sql.match(/FROM app\.article_crosses/gu)).toHaveLength(2);
    expect(sql.match(/status='confirmed'/gu)).toHaveLength(2);
    expect(sql).not.toContain("unconfirmed");
    // A cross identity is article + brand. The target article alone is not
    // enough because the same number can belong to unrelated manufacturers.
    expect(sql).toContain("cross_equivalents.brand=app.normalize_brand(brand.name)");
    // A product whose own SKU already matches the typed prefix is a direct
    // query result even if another-brand same-number cross also exists.
    expect(sql).toContain("NOT ($8<>'' AND product.sku_normalized LIKE $8 || '%')");

    const ranking = sql.slice(sql.lastIndexOf("ORDER BY"));
    const exactTier = ranking.indexOf("product.sku_normalized=$8");
    const crossTier = ranking.indexOf("cross_equivalents.article=product.sku_normalized");
    const prefixTier = ranking.indexOf("product.sku_normalized LIKE $8");
    expect(exactTier).toBeGreaterThan(-1);
    expect(crossTier).toBeGreaterThan(exactTier);
    expect(prefixTier).toBeGreaterThan(crossTier);
  });

  it("labels a result found only through a confirmed cross as an equivalent, not the searched-for article", async () => {
    query.mockResolvedValueOnce({
      rows: [
        productRow({ id: PRODUCT_ID, is_cross_match: false, sku: "W914/2" }),
        productRow({ id: "019bf9ea-0d3e-7def-9c9a-000000000099", is_cross_match: true, sku: "OC90" }),
      ],
    });

    const result = await service.products({ q: "W914/2" });

    expect(result.items).toEqual([
      expect.objectContaining({ matchedVia: "query", sku: "W914/2" }),
      expect.objectContaining({ matchedVia: "cross", sku: "OC90" }),
    ]);
  });

  it("defaults matchedVia to a direct query match for product() and featured(), which never widen via crosses", async () => {
    query.mockResolvedValueOnce({ rows: [productRow({ description: null, public_attributes: {} })] })
      .mockResolvedValueOnce({ rows: [] });
    const detail = await service.product("oil-filter-1");
    expect(detail.matchedVia).toBe("query");

    query.mockResolvedValueOnce({ rows: [productRow()] });
    const featured = await service.featured({});
    expect(featured.items[0]?.matchedVia).toBe("query");
  });

  it("escapes SQL LIKE wildcards without changing full-text search input", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await service.products({ q: "100%_" });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ESCAPE '\\'");
    expect(parameters[0]).toBe("100%_");
    expect(parameters[1]).toBe("100\\%\\_");
  });

  it("returns only active category and brand projections", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          description: "Расходные материалы",
          id: "019bf9ea-0d3e-7def-8c9a-000000000030",
          name: "Фильтры",
          parent_id: null,
          product_count: "4",
          slug: "filters",
          sort_order: 10,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "019bf9ea-0d3e-7def-8c9a-000000000020",
            name: "NGK",
            product_count: "3",
            slug: "ngk",
          },
          {
            id: "019bf9ea-0d3e-7def-8c9a-000000000021",
            name: "Commerce Smoke Staging",
            product_count: "0",
            slug: "commerce-smoke-staging",
          },
        ],
      });

    const categories = await service.categories();
    const brands = await service.brands();
    expect(categories).toMatchObject({
      items: [{ productCount: 4, slug: "filters" }],
    });
    expect(brands).toMatchObject({
      items: [{ productCount: 3, slug: "ngk" }],
    });
    expect(brands.items).toHaveLength(1);
    expect(query.mock.calls[0]?.[0]).toContain("category.is_active");
    expect(query.mock.calls[1]?.[0]).toContain("brand.is_active");
    expect(query.mock.calls[1]?.[0]).toContain("products.product_count>0");
  });

  it("assembles and caches the category tree, hiding an inactive subtree", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          description: null,
          id: "parts",
          is_active: true,
          name: "Запчасти",
          parent_id: null,
          product_count: "1",
          slug: "zapchasti",
          sort_order: 0,
        },
        {
          description: null,
          id: "body",
          is_active: true,
          name: "Кузов",
          parent_id: "parts",
          product_count: "2",
          slug: "kuzov",
          sort_order: 0,
        },
        {
          description: null,
          id: "electric",
          is_active: false,
          name: "Электрика",
          parent_id: null,
          product_count: "9",
          slug: "elektrika",
          sort_order: 1,
        },
        {
          description: null,
          id: "commerce-smoke",
          is_active: true,
          name: "Smoke category",
          parent_id: null,
          product_count: "0",
          slug: "smoke-category",
          sort_order: 2,
        },
      ],
    });

    const first = await service.categoryTree();
    expect(first.items).toMatchObject([
      { id: "parts", productCount: 3, slug: "zapchasti", children: [{ id: "body", slug: "kuzov" }] },
    ]);
    expect(first.items.map((item) => item.id)).not.toContain("electric");
    expect(first.items.map((item) => item.id)).not.toContain("commerce-smoke");
    expect(query.mock.calls[0]?.[0]).toContain("category.deleted_at IS NULL");

    // A second call must not hit the database again — the tree is cached
    // until CatalogApplyService invalidates it on the next 1C import.
    const second = await service.categoryTree();
    expect(second).toEqual(first);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns detail images in primary-first order without exposing storage keys", async () => {
    query
      .mockResolvedValueOnce({
        rows: [productRow({ public_attributes: { thread: "M20" }, description: "Описание" })],
      })
      .mockResolvedValueOnce({
        rows: [{
          alt_text: "Фильтр",
          byte_size: String(PNG.length),
          id: IMAGE_ID,
          is_primary: true,
          mime_type: "image/png",
          sort_order: 0,
        }],
      });

    const result = await service.product("oil-filter-1");
    expect(result).toMatchObject({
      attributes: { thread: "M20" },
      description: "Описание",
      images: [{ id: IMAGE_ID, isPrimary: true, url: `/api/v1/catalog/media/${IMAGE_ID}` }],
      primaryImage: { id: IMAGE_ID },
    });
    expect(JSON.stringify(result)).not.toContain("storage_key");
    expect(query.mock.calls[0]?.[0]).toContain("product.slug::text=$1");
    expect(query.mock.calls[0]?.[0]).toContain("product.public_attributes");
    expect(query.mock.calls[0]?.[0]).not.toContain("product.attributes");
  });

  it("selects featured products only when price and active-warehouse stock are present", async () => {
    query.mockResolvedValueOnce({ rows: [productRow()] });
    const result = await service.featured({ limit: "6" });
    expect(result).toMatchObject({ selection: "available_recent", items: [{ id: PRODUCT_ID }] });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("price.amount_kopeks IS NOT NULL");
    expect(sql).toContain("stock.available_quantity>0");
    expect(sql).toContain("product.updated_at DESC");
    expect(parameters[1]).toBe(6);
  });

  it("serves only verified public product image bytes with a content ETag", async () => {
    const digest = createHash("sha256").update(PNG).digest();
    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(PNG.length),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "chat/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    read.mockResolvedValueOnce(PNG);

    await expect(service.media(IMAGE_ID)).resolves.toEqual({
      content: PNG,
      etag: `"sha256-${digest.toString("base64url")}"`,
      mimeType: "image/png",
    });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM app.product_images");
    expect(sql).toContain("product.is_active");
    expect(sql).toContain("storage.status='available'");
    expect(parameters[1]).toBe("local");
  });

  it("does not return missing or corrupt media", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);

    const digest = createHash("sha256").update(PNG).digest();
    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(PNG.length),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "chat/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    read.mockResolvedValueOnce(Buffer.from("not an image"));
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);

    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(PNG.length),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "catalog/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    read.mockRejectedValueOnce(new Error("unsupported storage namespace"));
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);

    read.mockClear();
    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(10 * 1024 * 1024 + 1),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "catalog/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("CatalogPublicController media headers", () => {
  it("supports weak conditional ETags and preserves safe cache headers on 304", async () => {
    const media = {
      content: null,
      etag: '"sha256-content"',
      mimeType: "image/png",
    };
    const catalog = { media: vi.fn().mockResolvedValue(media) };
    const rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
    const headers = new Map<string, string>();
    const reply = {
      header: vi.fn((name: string, value: string) => {
        headers.set(name, value);
        return reply;
      }),
      send: vi.fn(),
      status: vi.fn(() => reply),
    };
    const controller = new CatalogPublicController(
      catalog as unknown as CatalogPublicService,
      rateLimit as never,
    );

    await controller.media(
      IMAGE_ID,
      'W/"sha256-content", "another"',
      { ip: "127.0.0.1" } as never,
      reply as never,
    );

    expect(rateLimit.consume).toHaveBeenCalledWith("catalog-media", "127.0.0.1", 120, 60);
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(headers.get("ETag")).toBe(media.etag);
    expect(headers.get("Cache-Control")).toContain("stale-while-revalidate");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(reply.send).toHaveBeenCalledWith();
  });
});
