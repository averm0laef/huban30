import { describe, expect, it, vi } from "vitest";

import { CatalogProductsQuerySchema } from "@an30/contracts";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import {
  catalogSearchEngineFromEnvironment,
  catalogSearchIsFreeText,
  type CatalogSearchEngine,
  OpenSearchCatalogEngine,
  openSearchRequest,
} from "./catalog-search-engine.js";
import { catalogSearchIdentity } from "./catalog-search-identity.js";
import type { CatalogSearchInput } from "./catalog-search-sql.js";
import { searchTokenPlan } from "./catalog-search-tokens.js";

const ID_A = "019bf9ea-0d3e-7def-9c9a-0000000000a1";
const ID_B = "019bf9ea-0d3e-7def-9c9a-0000000000b2";

function input(q: string, extra: Record<string, unknown> = {}): CatalogSearchInput {
  return {
    alternates: [],
    folded: q,
    identity: catalogSearchIdentity(q),
    plan: searchTokenPlan(q),
    query: CatalogProductsQuerySchema.parse({ q, ...extra }),
  };
}

function okResponse(ids: string[], total = ids.length) {
  return new Response(JSON.stringify({ hits: { total: { value: total }, hits: ids.map((id) => ({ _id: id })) } }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("search engine configuration", () => {
  it("is off unless SEARCH_ENGINE=opensearch", () => {
    expect(catalogSearchEngineFromEnvironment({})).toBeNull();
    expect(catalogSearchEngineFromEnvironment({ SEARCH_ENGINE: "postgres", OPENSEARCH_URL: "http://localhost:9200" })).toBeNull();
    expect(catalogSearchEngineFromEnvironment({ SEARCH_ENGINE: "" })).toBeNull();
  });

  it("requires an address when switched on", () => {
    expect(() => catalogSearchEngineFromEnvironment({ SEARCH_ENGINE: "opensearch" })).toThrow(/OPENSEARCH_URL/u);
    expect(catalogSearchEngineFromEnvironment({ SEARCH_ENGINE: "opensearch", OPENSEARCH_URL: "http://localhost:9200" })?.name).toBe("opensearch");
  });
});

describe("catalogSearchIsFreeText", () => {
  it.each(["масляный фильтр", "масло 5w40 4л", "vfckj", "бош колодки"])("lets the engine answer %s", (q) => {
    expect(catalogSearchIsFreeText(input(q))).toBe(true);
  });
  it.each(["W914/2", "0 986 494 104", "bosch 0986494104", "фильтр w914", "h7"])("keeps %s in PostgreSQL", (q) => {
    expect(catalogSearchIsFreeText(input(q))).toBe(false);
  });
});

describe("openSearchRequest", () => {
  it("requires every word through any of its alternatives, with filters and boosts", () => {
    const body = openSearchRequest(input("бош колодки 4л", {
      availability: "in_stock", brand: "bosch", category: "tormoza", maxPriceKopeks: "900000", limit: "12", offset: "24",
    }), false) as { from: number; size: number; query: { bool: { filter: unknown[]; must: Array<{ bool: { must: Array<{ bool: { should: unknown[] } }> } }> } } };
    expect(body.from).toBe(24);
    expect(body.size).toBe(12);
    expect(body.query.bool.filter).toEqual(expect.arrayContaining([
      { term: { category_path: "tormoza" } },
      { terms: { brand_slug: ["bosch"] } },
      { range: { price_kopeks: { lte: 900000 } } },
      { range: { available_quantity: { gt: 0 } } },
    ]));
    const words = body.query.bool.must[0]!.bool.must;
    expect(words).toHaveLength(3);
    expect(JSON.stringify(words[0])).toContain("bosch");
    expect(JSON.stringify(words[1])).toContain("колодк");
    expect(words[2]!.bool.should).toEqual([{ term: { measures: "4л" } }]);
  });

  it("accepts any word in the retry and sorts by price when asked", () => {
    const body = openSearchRequest(input("масляный фильтр", { sort: "price_asc" }), true) as {
      query: { bool: { must: Array<{ bool: { should?: unknown[]; minimum_should_match?: number } }> } }; sort: unknown[];
    };
    expect(body.query.bool.must[0]!.bool.minimum_should_match).toBe(1);
    expect(body.sort[0]).toEqual({ price_kopeks: { order: "asc", missing: "_last" } });
  });
});

describe("OpenSearchCatalogEngine", () => {
  it("returns ranked ids and the total", async () => {
    const fetchImpl = vi.fn(async () => okResponse([ID_B, ID_A], 7));
    const engine = new OpenSearchCatalogEngine({ index: "an30-products", timeoutMs: 500, url: "http://search:9200/" }, fetchImpl as unknown as typeof fetch);
    await expect(engine.search(input("масляный фильтр"), false)).resolves.toEqual({ ids: [ID_B, ID_A], total: 7 });
    expect(fetchImpl).toHaveBeenCalledWith("http://search:9200/an30-products/_search", expect.objectContaining({ method: "POST" }));
  });

  it("gives up for 30 seconds after a failure so PostgreSQL answers", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async (): Promise<Response> => { throw new Error("connect ECONNREFUSED"); });
    const engine = new OpenSearchCatalogEngine({ index: "an30-products", timeoutMs: 500, url: "http://search:9200" }, fetchImpl as unknown as typeof fetch, () => now);
    await expect(engine.search(input("фильтр"), false)).resolves.toBeNull();
    await expect(engine.search(input("фильтр"), false)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 30_001;
    fetchImpl.mockImplementationOnce(async () => okResponse([ID_A]));
    await expect(engine.search(input("фильтр"), false)).resolves.toEqual({ ids: [ID_A], total: 1 });
  });

  it("treats an error status or a malformed body as unavailable", async () => {
    const engine = new OpenSearchCatalogEngine({ index: "i", timeoutMs: 500, url: "http://s" },
      (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch);
    await expect(engine.search(input("фильтр"), false)).resolves.toBeNull();
  });
});

describe("CatalogPublicService with an engine", () => {
  function setup(engine: CatalogSearchEngine) {
    const query = vi.fn();
    const transactionQuery = vi.fn(async (text: string) => (text.startsWith("SET LOCAL") ? { rows: [] } : query(text)));
    const database = { query, transaction: async <T>(work: (client: unknown) => Promise<T>) => work({ query: transactionQuery }) };
    const service = new CatalogPublicService(new CatalogCategoryTreeCache(), database as unknown as DatabaseService,
      new ProductPhotoStorage({ name: "local", read: vi.fn(), remove: vi.fn(), store: vi.fn() }), engine);
    return { query, service };
  }
  const row = (id: string, sku: string) => ({
    available_quantity: "1", brand_id: null, brand_name: null, brand_slug: null, category_id: null, category_name: null,
    category_slug: null, created_at: new Date(0), id, name: sku, price_kopeks: null, primary_image_alt_text: null,
    primary_image_byte_size: null, primary_image_id: null, primary_image_is_primary: null, primary_image_mime_type: null,
    sku, slug: sku.toLowerCase(), updated_at: new Date(0),
  });

  it("reads the engine's ranked ids from PostgreSQL in the same order and response shape", async () => {
    const engine = { name: "fake", search: vi.fn(async () => ({ ids: [ID_B, ID_A], total: 2 })) };
    const { query, service } = setup(engine);
    query.mockResolvedValueOnce({ rows: [row(ID_B, "B"), row(ID_A, "A")] });
    const result = await service.products({ q: "масляный фильтр" });
    expect(result).toMatchObject({ matchMode: "all", total: 2, limit: 24, offset: 0 });
    expect(result.items.map((item) => item.sku)).toEqual(["B", "A"]);
    expect(result.items[0]).toMatchObject({ matchedVia: "query", availableQuantity: 1, primaryImage: null });
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain("product.id=ANY(");
    expect(sql).toContain("array_position(");
    expect(sql).toContain("category.id IN (SELECT id FROM visible_categories)");
  });

  it("retries with any word and drops a product hidden since it was indexed", async () => {
    const engine = { name: "fake", search: vi.fn()
      .mockResolvedValueOnce({ ids: [], total: 0 })
      .mockResolvedValueOnce({ ids: [ID_A, ID_B], total: 2 }) };
    const { query, service } = setup(engine);
    query.mockResolvedValueOnce({ rows: [row(ID_A, "A")] });
    const result = await service.products({ q: "масляный фильтр" });
    expect(engine.search).toHaveBeenLastCalledWith(expect.anything(), true);
    expect(result).toMatchObject({ matchMode: "any", total: 1 });
  });

  it("falls back to PostgreSQL when the engine cannot answer, and never sends it an article", async () => {
    const engine = { name: "fake", search: vi.fn(async () => null) };
    const { query, service } = setup(engine);
    query.mockResolvedValue({ rows: [] });
    await service.products({ q: "масляный фильтр" });
    expect(engine.search).toHaveBeenCalledTimes(1);
    expect((query.mock.calls[0] as [string])[0]).toContain("count(*) OVER()");

    engine.search.mockClear();
    await service.products({ q: "W914/2" });
    expect(engine.search).not.toHaveBeenCalled();
  });
});
