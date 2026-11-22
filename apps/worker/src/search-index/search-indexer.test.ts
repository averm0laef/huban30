import { describe, expect, it, vi } from "vitest";

import { SEARCH_INDEX_DEFINITION } from "./index-definition.js";
import type { SearchEngineHttp } from "./opensearch-http.js";
import { measureKeys, productDocument, type ProductDocumentRow } from "./product-documents.js";
import { readSearchIndexConfig } from "./search-index-config.js";
import { SearchIndexer } from "./search-indexer.js";

const ID_A = "019bf9ea-0d3e-7def-9c9a-0000000000a1";
const ID_B = "019bf9ea-0d3e-7def-9c9a-0000000000b2";
const silent = { info: vi.fn(), warn: vi.fn() };

function row(id: string, overrides: Partial<ProductDocumentRow> = {}): ProductDocumentRow {
  return {
    available_quantity: "3", brand_key: "MANNFILTER", brand_name: "MANN-FILTER", brand_slug: "mann",
    category_path: ["filtry", "maslyanye"], created_at: new Date("2026-11-01T00:00:00Z"), id,
    name_folded: "Фильтр масляный W 914/2", price_kopeks: "45000", sku: "W 914/2", sku_normalized: "W9142", ...overrides,
  };
}

class FakeEngine implements SearchEngineHttp {
  readonly calls: Array<{ method: string; path: string; body?: unknown }> = [];
  readonly bulks: unknown[][] = [];
  aliasTargets: string[] = [];
  bulkStatus = 200;
  bulkBody: unknown = { errors: false, items: [] };

  async request(method: "DELETE" | "GET" | "HEAD" | "POST" | "PUT", path: string, body?: unknown) {
    this.calls.push({ method, path, body });
    if (method === "GET" && path.startsWith("/_alias/")) {
      return this.aliasTargets.length
        ? { status: 200, body: Object.fromEntries(this.aliasTargets.map((index) => [index, { aliases: {} }])) }
        : { status: 404, body: {} };
    }
    if (method === "HEAD") return { status: this.aliasTargets.length ? 200 : 404, body: null };
    return { status: 200, body: { acknowledged: true } };
  }

  async bulk(lines: unknown[]) {
    this.bulks.push(lines);
    return { status: this.bulkStatus, body: this.bulkBody };
  }
}

function fakeDatabase(queue: Array<{ product_id: string; enqueued_at: Date }>, documents: ProductDocumentRow[]) {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    statements.push({ text, values });
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (text.includes("FROM app.search_index_queue") && text.startsWith("SELECT")) return { rows: queue };
    if (text.includes("FROM app.products AS product")) {
      if (text.includes("product.id>$1::uuid")) {
        const after = values?.[0] as string | null;
        return { rows: documents.filter((document) => after === null || document.id > after).slice(0, values?.[1] as number) };
      }
      const ids = values?.[0] as string[];
      return { rows: documents.filter((document) => ids.includes(document.id)) };
    }
    return { rows: [] };
  });
  const database = { connect: async () => ({ query, release: vi.fn() }), query } as unknown as ConstructorParameters<typeof SearchIndexer>[0];
  return { database, statements };
}

describe("search index configuration", () => {
  it("is off by default and needs an address when on", () => {
    expect(readSearchIndexConfig({})).toBeNull();
    expect(readSearchIndexConfig({ SEARCH_ENGINE: "postgres" })).toBeNull();
    expect(() => readSearchIndexConfig({ SEARCH_ENGINE: "opensearch" })).toThrow(/OPENSEARCH_URL/u);
    expect(readSearchIndexConfig({ SEARCH_ENGINE: "opensearch", OPENSEARCH_URL: "http://opensearch:9200/" }))
      .toEqual({ alias: "an30-products", batchSize: 500, url: "http://opensearch:9200" });
  });
});

describe("product documents", () => {
  it("carries the fields the API queries", () => {
    const document = productDocument(row(ID_A, { available_quantity: "0", name_folded: "Масло моторное Лукойл Люкс 5W-40 4 л" }));
    expect(document).toMatchObject({
      brand_key: "MANNFILTER", category_path: ["filtry", "maslyanye"], id: ID_A, in_stock: false,
      lead: "масло", price_kopeks: 45000, sku_normalized: "w9142",
    });
    expect(Object.keys(document).sort()).toEqual(Object.keys(SEARCH_INDEX_DEFINITION.mappings.properties).sort());
  });

  it("extracts the same measurement keys the API search plan asks for", () => {
    expect(measureKeys("Масло моторное 5W-40 полусинтетическое 4 л")).toEqual(expect.arrayContaining(["visc:5w40", "4л"]));
    expect(measureKeys("Масло SAE 5W40 4л")).toEqual(expect.arrayContaining(["visc:5w40", "4л"]));
    expect(measureKeys("Масло 15W-40 5 литров")).toEqual(expect.arrayContaining(["visc:15w40", "5л"]));
    expect(measureKeys("Масло 15W-40")).not.toContain("visc:5w40");
    expect(measureKeys("Масло 5W-40 4 л")).not.toContain("5вт");
    expect(measureKeys("Жидкость тормозная DOT 4 0,5 л")).toContain("0.5л");
    expect(measureKeys("Жидкость тормозная DOT 4 0,5 л")).not.toContain("5л");
    expect(measureKeys("Щётка Aerotwin 600/450 мм")).toEqual(expect.arrayContaining(["600мм", "450мм"]));
    expect(measureKeys("Аккумулятор 60Ач 540А")).toEqual(expect.arrayContaining(["60ач", "540а"]));
    expect(measureKeys("Лампа H7 12V 55W")).toEqual(expect.arrayContaining(["12в", "55вт"]));
  });
});

describe("SearchIndexer.drainQueue", () => {
  it("indexes visible products, deletes the rest, and dequeues only what it handled", async () => {
    const queued = [{ product_id: ID_A, enqueued_at: new Date(1) }, { product_id: ID_B, enqueued_at: new Date(2) }];
    const { database, statements } = fakeDatabase(queued, [row(ID_A)]);
    const engine = new FakeEngine();
    const indexer = new SearchIndexer(database, engine, "an30-products", 500, silent);
    await expect(indexer.drainQueue()).resolves.toBe(2);
    expect(engine.bulks[0]).toEqual([
      { index: { _index: "an30-products", _id: ID_A } }, expect.objectContaining({ id: ID_A }),
      { delete: { _index: "an30-products", _id: ID_B } },
    ]);
    const dequeue = statements.find((statement) => statement.text.includes("DELETE FROM app.search_index_queue"));
    // Matched on enqueued_at too: a product re-queued during indexing stays queued.
    expect(dequeue?.text).toContain("queue.enqueued_at=done.enqueued_at");
    expect(dequeue?.values).toEqual([[ID_A, ID_B], [new Date(1), new Date(2)]]);
    expect(statements.at(-1)?.text).toContain("pg_advisory_unlock");
  });

  it("keeps the queue and records the error when the engine rejects the batch", async () => {
    const { database, statements } = fakeDatabase([{ product_id: ID_A, enqueued_at: new Date(1) }], [row(ID_A)]);
    const engine = new FakeEngine();
    engine.bulkBody = { errors: true, items: [{ index: { status: 400, error: { reason: "mapper_parsing_exception" } } }] };
    const indexer = new SearchIndexer(database, engine, "an30-products", 500, silent);
    await expect(indexer.drainQueue()).resolves.toBe(0);
    expect(statements.some((statement) => statement.text.includes("DELETE FROM app.search_index_queue"))).toBe(false);
    const failure = statements.find((statement) => statement.text.includes("attempt_count=attempt_count+1"));
    expect(failure?.values?.[1]).toContain("mapper_parsing_exception");
  });

  it("treats deleting a document that is already gone as success", async () => {
    const { database } = fakeDatabase([{ product_id: ID_B, enqueued_at: new Date(1) }], []);
    const engine = new FakeEngine();
    engine.bulkBody = { errors: true, items: [{ delete: { status: 404 } }] };
    await expect(new SearchIndexer(database, engine, "an30-products", 500, silent).drainQueue()).resolves.toBe(1);
  });
});

describe("SearchIndexer.reindexAll", () => {
  it("builds a new index page by page and switches the alias atomically", async () => {
    const { database, statements } = fakeDatabase([], [row(ID_A), row(ID_B)]);
    const engine = new FakeEngine();
    engine.aliasTargets = ["an30-products-20261101000000"];
    const indexer = new SearchIndexer(database, engine, "an30-products", 1, silent);
    const result = await indexer.reindexAll(new Date("2026-11-20T10:11:12Z"));
    expect(result).toEqual({ documents: 2, index: "an30-products-20261120101112" });
    expect(engine.calls).toContainEqual({ method: "PUT", path: "/an30-products-20261120101112", body: SEARCH_INDEX_DEFINITION });
    expect(engine.bulks).toHaveLength(2);
    expect(engine.calls).toContainEqual({ method: "POST", path: "/_aliases", body: { actions: [
      { remove: { index: "an30-products-20261101000000", alias: "an30-products" } },
      { add: { index: "an30-products-20261120101112", alias: "an30-products" } },
    ] } });
    expect(engine.calls).toContainEqual({ method: "DELETE", path: "/an30-products-20261101000000", body: undefined });
    expect(statements.at(-1)?.text).toContain("DELETE FROM app.search_index_queue WHERE enqueued_at<$1");
  });
});
