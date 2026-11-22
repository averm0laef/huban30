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
import { NAME_ORDER } from "./catalog-search-sql.js";
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

  it("lists one part of the site map: public products only, in a stable order, with the catalogue's size", async () => {
    query.mockResolvedValueOnce({ rows: [{ items: [{ slug: "lampa-osram-3930", updated_at: "2026-11-22T13:00:00.5+03:00" }], total: "42723" }] });
    await expect(service.sitemapProducts({ part: "2" })).resolves.toEqual({
      items: [{ slug: "lampa-osram-3930", updatedAt: "2026-11-22T10:00:00.500Z" }], partSize: 10_000, total: 42_723,
    });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("category.id IN (SELECT id FROM visible_categories)");
    expect(sql).toContain("ORDER BY listed.id");
    expect(values).toEqual([10_000, 20_000]);
    await expect(service.sitemapProducts({ part: "x" })).rejects.toBeInstanceOf(BadRequestException);
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
    expect(itemsSql).toContain("brand.slug::text=ANY(");
    expect(itemsSql).toContain("price.amount_kopeks >= $");
    expect(itemsSql).toContain("price.amount_kopeks <= $");
    expect(itemsSql).toContain("stock.available_quantity>0");
    // Every placeholder in the generated statement has a bound value.
    const placeholders = [...itemsSql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
    expect(Math.max(...placeholders)).toBe(itemsParameters.length);
    expect(itemsParameters).toEqual(expect.arrayContaining([
      "filters", ["ngk"], 100000, 200000, "фильтр", "%фильтр%", "local", 12, 24,
      ["image/avif", "image/jpeg", "image/png", "image/webp"],
    ]));
  });

  it("ranks an exact normalised article match before a prefix match before fuzzy name relevance", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await service.products({ q: "w914-2" });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    // Rank order lives in the final ORDER BY (the primary-image LATERAL has
    // its own ORDER BY earlier in the statement).
    const ranking = sql.slice(sql.lastIndexOf("ORDER BY"));
    const exactTier = ranking.search(/product\.sku_normalized=\$\d+\) DESC/u);
    const prefixTier = ranking.search(/product\.sku_normalized LIKE \$\d+\) DESC/u);
    const fuzzyTier = ranking.indexOf("relevance.score");
    const nameTiebreak = ranking.indexOf(NAME_ORDER);
    expect(exactTier).toBeGreaterThan(-1);
    expect(prefixTier).toBeGreaterThan(exactTier);
    expect(fuzzyTier).toBeGreaterThan(prefixTier);
    expect(nameTiebreak).toBeGreaterThan(fuzzyTier);
    expect(sql).toContain("similarity(product.name_folded");
    expect(parameters).toContain(normalizeArticleNumber("w914-2"));
    expect(parameters).toContain("W9142%");
  });

  it("requires both the named brand and article and never relaxes to any word for a concrete part", async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await service.products({ q:"манн W 914/2" });
    expect(result).toMatchObject({items:[],total:0,matchMode:"all"});
    expect(query).toHaveBeenCalledTimes(1);
    const [sql,parameters]=query.mock.calls[0] as [string,unknown[]];
    expect(parameters).toContain("W9142");
    expect(parameters).toContainEqual(["MANN","MANNFILTER"]);
    expect(sql).toMatch(/app\.normalize_brand\(brand\.name\)=ANY\(\$\d+::text\[\]\)/u);
  });

  it("recovers a Cyrillic word typed in Latin, both phonetically and via a wrong keyboard layout", async () => {
    query.mockResolvedValue({ rows: [] });
    await service.products({ q: "filtr" });
    const [, phoneticParameters] = query.mock.calls[0] as [string, unknown[]];
    // filtr -> "филтр" (transliteration) and "ашдек" (layout swap) — see
    // packages/contracts/src/catalog-search-normalize.test.ts for how each
    // is derived. Both are searched, not just one.
    expect(phoneticParameters).toEqual(expect.arrayContaining(["%филтр%", "%ашдек%"]));

    query.mockClear();
    // The task's own example: "фильтр" typed with the OS layout left on
    // English lands as "abkmnh".
    await service.products({ q: "abkmnh" });
    const [layoutSql, layoutParameters] = query.mock.calls[0] as [string, unknown[]];
    expect(layoutParameters).toContain("%фильтр%");
    // Still one statement per pass, not one per candidate.
    expect(layoutSql).toContain("product.search_text_folded ILIKE");
  });

  it("does not attempt Latin recovery on a query that is already Cyrillic or is an article-shaped code", async () => {
    query.mockResolvedValue({ rows: [] });
    await service.products({ q: "w914-2" });
    // Only one Latin letter ("w") — too little signal to guess a misspelled
    // word from, and normalizeArticleNumber already owns this case.
    const [, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters.filter((value) => typeof value === "string" && /[а-я]/u.test(value))).toEqual([]);
  });

  it("folds ё to е on the query, in both directions, so a plain-е query and a ё query converge", async () => {
    // A product name stored with a ё (1C exports "Щётка стеклоочистителя
    // ...") must be reachable by the near-universal plain spelling "щетка".
    query.mockResolvedValue({ rows: [] });
    await service.products({ q: "щётка" });
    const [yoSql, yoParameters] = query.mock.calls[0] as [string, unknown[]];

    query.mockClear();
    await service.products({ q: "щетка" });
    const [plainSql, plainParameters] = query.mock.calls[0] as [string, unknown[]];

    // Both spellings produce the identical statement and free-text values.
    // The article key (normalizeArticleNumber) keeps its own fold, so only
    // that one value differs.
    expect(yoSql).toBe(plainSql);
    expect(yoParameters).toContain("щетка");
    // "щетка" is covered by its stem "щетк" as a substring.
    expect(yoParameters).toContain("%щетк%");
    expect(yoParameters).not.toContain("щётка");
    expect(yoParameters).toContain("ЩЁTKA");
    expect(plainParameters).toContain("ЩETKA");
    const differing = yoParameters.filter((value, index) => JSON.stringify(value) !== JSON.stringify(plainParameters[index]));
    expect(differing.every((value) => typeof value === "string" && value.toUpperCase().includes("ЩЁTKA"))).toBe(true);
  });

  it("folds Ё (upper-case) too, and folds every alt-query candidate the same way", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "ЁЖ ФИЛЬТР" });
    const [, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toContain("ЕЖ ФИЛЬТР");
    expect(parameters).toContain("%еж%");
  });

  it("matches ё/е-folded, generated columns rather than the raw name/search_text columns", async () => {
    // product.name_folded / product.search_text_folded are generated
    // columns (migration 0025) built through app.fold_yo, the SQL mirror of
    // foldYo — so both sides of every comparison are folded the same way.
    query.mockResolvedValue({ rows: [] });
    await service.products({ q: "щетка" });
    const [sql] = query.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain("product.search_text_folded ILIKE");
    expect(sql).toContain("similarity(product.name_folded,");
    expect(sql).toContain("to_tsvector('simple',product.search_text_folded)");
    expect(sql).toContain("app.fold_yo(searched_brand.name)");
    // Only the display tiebreaker (lower(product.name) ASC) names the raw column.
    expect(sql).not.toContain("product.name ILIKE");
    expect(sql).not.toContain("coalesce(product.search_text,product.name)");
  });

  it("adds real Russian stemming as an additive full-text branch and a light stem for fleeting vowels", async () => {
    query.mockResolvedValue({ rows: [] });
    await service.products({ q: "колодок", sort: "relevance" });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];

    const filterPart = sql.slice(0, sql.lastIndexOf("ORDER BY"));
    expect(filterPart).toContain("to_tsvector('russian',product.search_text_folded)");
    expect(filterPart).toMatch(/websearch_to_tsquery\('russian',\$\d+\)/u);
    // Snowball leaves "колодок" alone; the light stem finds "колодки".
    expect(parameters).toContain("%колодк%");
    // The ranking puts names that start with the named part type first.
    expect(parameters).toContainEqual(["колодк"]);
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

  it("matches a two-letter query only as the start of a word, through the full-text index", async () => {
    // "фи" or "h7" give a trigram index nothing to look up and a mid-word
    // substring would be noise; the start of a word is useful ("h7" lamps).
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "фи" });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/to_tsquery\('simple',\$\d+\)/u);
    expect(parameters).toContain("фи:*");
    expect(sql).not.toMatch(/search_text_folded ILIKE \$\d+\n/u);
  });

  it("widens search to confirmed article-cross equivalents, ranked between an exact and a prefix match", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await service.products({ q: "w914-2" });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    const article = `$${parameters.indexOf("W9142") + 1}`;
    // Symmetric lookup: a confirmed cross is found whichever side of the
    // stored pair the searched article landed on (migration 0018).
    expect(sql).toContain(`WHERE article_a=${article} AND status='confirmed'`);
    expect(sql).toContain(`WHERE article_b=${article} AND status='confirmed'`);
    // Never widens on an unconfirmed cross.
    expect(sql.match(/FROM app\.article_crosses/gu)).toHaveLength(2);
    expect(sql.match(/status='confirmed'/gu)).toHaveLength(2);
    expect(sql).not.toContain("unconfirmed");
    // A cross identity is article + brand.
    // Brands are compared by identity (migration 0042): «MANN» = «MANN-FILTER».
    expect(sql).toContain("app.canonical_brand(cross_equivalents.brand)=app.canonical_brand(brand.name)");
    // A product whose own SKU already matches the typed prefix is a direct
    // query result even if another-brand same-number cross also exists.
    expect(sql).toMatch(/NOT \(\$\d+<>'' AND product\.sku_normalized LIKE \$\d+\)/u);

    const ranking = sql.slice(sql.lastIndexOf("ORDER BY"));
    const exactTier = ranking.indexOf(`product.sku_normalized=${article}`);
    const crossTier = ranking.indexOf("cross_equivalents.article=product.sku_normalized");
    const prefixTier = ranking.search(/product\.sku_normalized LIKE \$\d+\) DESC/u);
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

  it("shows a product's name without the staff's notes typed into it in 1С, in the list, on the card and among the featured", async () => {
    // «(Ш)», «+++» and the shelf box are the staff's own marks (packages/contracts/src/product-name.ts).
    const noted = { name: "(Ш) +++ Клипса крепежная TORSO КОРОБКА 9" };
    query.mockResolvedValueOnce({ rows: [productRow(noted)] }).mockResolvedValueOnce({ rows: [{ count: "1" }] });
    const list = await service.products({});
    expect(list.items[0]?.name).toBe("Клипса крепежная TORSO");

    // The list may not have needed its count: start each call from an empty queue of answers.
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [productRow({ ...noted, description: null, public_attributes: {} })] })
      .mockResolvedValueOnce({ rows: [] });
    expect((await service.product("oil-filter-1")).name).toBe("Клипса крепежная TORSO");

    query.mockReset();
    query.mockResolvedValueOnce({ rows: [productRow(noted)] });
    expect((await service.featured({})).items[0]?.name).toBe("Клипса крепежная TORSO");
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
    query.mockResolvedValue({ rows: [] });

    await service.products({ q: "100%_" });

    const [, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toContain("100%_");
    expect(parameters).toContain("%100\\%\\_%");
    expect(parameters.some((value) => typeof value === "string" && /(^|[^\\])[%_]/u.test(value.slice(1, -1)) && value.startsWith("%") && value !== "%100\\%\\_%")).toBe(false);
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
      { record: vi.fn() } as never,
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

describe("CatalogPublicService word-by-word search", () => {
  const query = vi.fn();
  const service = new CatalogPublicService(
    new CatalogCategoryTreeCache(),
    {
      query,
      transaction: async <T>(work: (client: { query: typeof query }) => Promise<T>) => work({
        query: vi.fn((text: string, values?: unknown[]) => (
          text.startsWith("SET LOCAL") ? Promise.resolve({ rows: [] }) : query(text, values)
        )),
      }),
    } as unknown as DatabaseService,
    { name: "local", read: vi.fn(), remove: vi.fn(), store: vi.fn() },
  );

  beforeEach(() => query.mockReset());

  it("requires every word in any order, searches the brand and a mid-article fragment", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "фильтр mann" });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("<% product.search_text_folded");
    expect(sql).toContain("app.fold_yo(searched_brand.name)");
    expect(sql).toMatch(/\)\n {4}INTERSECT \(/u);
    expect(parameters).toEqual(expect.arrayContaining(["%фильтр%", "%mann%"]));
    // "mann-filter" adds nothing once "mann" matches as a substring.
    expect(parameters).not.toContain("%mann-filter%");

    query.mockClear();
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ q: "914/2" });
    expect((query.mock.calls[0] as [string, unknown[]])[1]).toContain("%9142%");
  });

  it("retries a multi-word query with any word when no product has all of them", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await service.products({ q: "масляный фильтр" });
    expect(query.mock.calls).toHaveLength(2);
    const [strictSql] = query.mock.calls[0] as [string, unknown[]];
    const [relaxedSql] = query.mock.calls[1] as [string, unknown[]];
    expect(strictSql).toMatch(/\)\n {4}INTERSECT \(/u);
    expect(relaxedSql).not.toMatch(/INTERSECT/u);
    // Whole-query closeness only widens the retry.
    expect(strictSql).not.toContain("product.name_folded %");
    expect(relaxedSql).toContain("product.name_folded %");
    expect(result.matchMode).toBe("all");
  });

  it("browses a section with in-stock and priced items first", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await service.products({ category: "filters" });
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(`(stock.available_quantity>0) DESC,(price.amount_kopeks IS NOT NULL) DESC,${NAME_ORDER}`);
  });
});

describe("CatalogPublicService first page of a section", () => {
  // The catalogue's root without filters cost about half a second of the database on the owner's 42 723 items
  // (23.11.2026); every visitor who opens a section asks for the same page.
  const query = vi.fn();
  const cache = new CatalogCategoryTreeCache();
  const service = new CatalogPublicService(
    cache,
    {
      query,
      transaction: async <T>(work: (client: { query: typeof query }) => Promise<T>) => work({
        query: vi.fn((text: string, values?: unknown[]) => (
          text.startsWith("SET LOCAL") ? Promise.resolve({ rows: [] }) : query(text, values)
        )),
      }),
    } as unknown as DatabaseService,
    { name: "local", read: vi.fn(), remove: vi.fn(), store: vi.fn() },
  );

  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [productRow()] });
    cache.invalidate();
  });

  it("answers the same unfiltered first page from memory for half a minute", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const first = await service.products({ category: "filters" });
    expect(await service.products({ category: "filters" })).toEqual(first);
    expect(await service.products({ category: "filters", limit: "24", sort: "relevance" })).toEqual(first);
    expect(query).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 30_001);
    await service.products({ category: "filters" });
    expect(query).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("asks the database again once a 1С exchange changed the catalogue", async () => {
    await service.products({});
    cache.invalidate();
    await service.products({});
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("never keeps a search, a filter or a further page", async () => {
    for (const filters of [{ q: "фильтр" }, { brand: "ngk" }, { availability: "in_stock" }, { minPriceKopeks: "100" }, { offset: "48" }]) {
      query.mockClear();
      await service.products({ category: "filters", ...filters });
      await service.products({ category: "filters", ...filters });
      expect(query.mock.calls.length).toBeGreaterThanOrEqual(2);
    }
  });
});
