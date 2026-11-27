// Optional external search engine for catalog text search (docs/SEARCH_ENGINE.md).
//
// PostgreSQL stays the default and the fallback: the engine is used only
// when SEARCH_ENGINE=opensearch, only for free-text queries (an article
// number keeps the exact/cross/prefix logic in PostgreSQL), and any engine
// error or timeout falls back to PostgreSQL for that request and makes the
// service skip the engine for a short cool-down. The engine returns ranked
// product ids; CatalogPublicService reads prices, stock, images and
// visibility from PostgreSQL, so the API response shape never changes.

import { readFileSync } from "node:fs";

import { z } from "zod";

import { normalizeArticleNumber } from "./catalog-search-normalize.js";
import type { CatalogSearchInput } from "./catalog-search-sql.js";

export const CATALOG_SEARCH_ENGINE = Symbol("CATALOG_SEARCH_ENGINE");

export interface CatalogSearchEngineResult {
  ids: string[];
  total: number;
}

export interface CatalogSearchEngine {
  readonly name: string;
  /** Ranked ids for one page, or null when the engine cannot answer (use PostgreSQL). */
  search(input: CatalogSearchInput, matchAny: boolean): Promise<CatalogSearchEngineResult | null>;
}

const EngineEnvironmentSchema = z.object({
  SEARCH_ENGINE: z.enum(["postgres", "opensearch"]).default("postgres"),
  OPENSEARCH_URL: z.string().url().optional(),
  OPENSEARCH_INDEX: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/u).default("an30-products"),
  OPENSEARCH_USERNAME: z.string().min(1).optional(),
  OPENSEARCH_PASSWORD: z.string().min(1).optional(),
  OPENSEARCH_PASSWORD_FILE: z.string().min(1).optional(),
  OPENSEARCH_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(800),
});

/** The configured engine, or null for the default PostgreSQL search. */
export function catalogSearchEngineFromEnvironment(
  raw: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): CatalogSearchEngine | null {
  const environment = EngineEnvironmentSchema.parse(Object.fromEntries(
    Object.entries(raw).filter(([key, value]) => key.startsWith("SEARCH_ENGINE") || key.startsWith("OPENSEARCH_") ? value !== "" : false),
  ));
  if (environment.SEARCH_ENGINE !== "opensearch") return null;
  if (!environment.OPENSEARCH_URL) throw new Error("SEARCH_ENGINE=opensearch requires OPENSEARCH_URL");
  const password = environment.OPENSEARCH_PASSWORD
    ?? (environment.OPENSEARCH_PASSWORD_FILE ? readFileSync(environment.OPENSEARCH_PASSWORD_FILE, "utf8").trim() : undefined);
  return new OpenSearchCatalogEngine({
    index: environment.OPENSEARCH_INDEX,
    timeoutMs: environment.OPENSEARCH_TIMEOUT_MS,
    url: environment.OPENSEARCH_URL,
    ...(environment.OPENSEARCH_USERNAME && password
      ? { authorization: `Basic ${Buffer.from(`${environment.OPENSEARCH_USERNAME}:${password}`).toString("base64")}` }
      : {}),
  }, fetchImpl);
}

/**
 * Whether the engine may answer: free text and measurements only. A word
 * with a digit that is not a measurement may be (part of) an article
 * number, and article identity, confirmed crosses and the "never a fuzzy
 * neighbour" rule live in PostgreSQL.
 */
export function catalogSearchIsFreeText(input: CatalogSearchInput): boolean {
  if (input.identity.articleOnly || input.plan.words.length === 0) return false;
  // DOT is a mandatory product-name constraint that the optional index does not store yet.
  if (input.plan.alternatives.some((alternative) => alternative.measure?.startsWith("dot:"))) return false;
  return input.plan.words.every((word, index) => !/\d/u.test(word)
    || input.plan.alternatives.some((alternative) => alternative.word === index + 1 && alternative.measure));
}

type Query = Record<string, unknown>;

function wordQuery(input: CatalogSearchInput, word: number): Query {
  const should: Query[] = [];
  for (const alternative of input.plan.alternatives) {
    if (alternative.word !== word) continue;
    if (alternative.measure) {
      should.push({ term: { measures: alternative.measure } });
      continue;
    }
    if (!alternative.text) continue;
    const text = alternative.text;
    should.push({ match: { "name.ru": { query: text, operator: "and", ...(alternative.fuzzy ? { fuzziness: "AUTO" } : {}) } } });
    should.push({ match: { "name.prefix": { query: text, operator: "and" } } });
    should.push({ match: { brand: { query: text, operator: "and" } } });
    if (/\d/u.test(text)) {
      const article = normalizeArticleNumber(text).toLowerCase();
      if (article) {
        should.push({ prefix: { sku_normalized: article } });
        if (article.length >= 3) should.push({ match: { "sku_normalized.fragment": article } });
      }
    }
  }
  return { bool: { should, minimum_should_match: 1 } };
}

/** OpenSearch request body for one search pass (pure, unit-tested). */
export function openSearchRequest(input: CatalogSearchInput, matchAny: boolean): Query {
  const { query, identity, plan } = input;
  const filter: Query[] = [];
  if (query.category) filter.push({ term: { category_path: query.category } });
  if (query.brand.length > 0) filter.push({ terms: { brand_slug: query.brand } });
  if (query.minPriceKopeks !== undefined || query.maxPriceKopeks !== undefined) {
    filter.push({ range: { price_kopeks: {
      ...(query.minPriceKopeks === undefined ? {} : { gte: query.minPriceKopeks }),
      ...(query.maxPriceKopeks === undefined ? {} : { lte: query.maxPriceKopeks }),
    } } });
  }
  if (query.availability === "in_stock") filter.push({ range: { available_quantity: { gt: 0 } } });
  if (query.availability === "out_of_stock") filter.push({ term: { available_quantity: 0 } });
  if (identity.brandKeys.length > 0) filter.push({ terms: { brand_key: identity.brandKeys } });

  const words = plan.words.map((_word, index) => wordQuery(input, index + 1));
  const boosts: Query[] = [];
  for (const lead of plan.leads) boosts.push({ prefix: { lead: { value: lead, boost: 3 } } });
  if (identity.article) {
    const article = identity.article.toLowerCase();
    boosts.push({ term: { sku_normalized: { value: article, boost: 20 } } });
    boosts.push({ prefix: { sku_normalized: { value: article, boost: 10 } } });
  }
  boosts.push({ term: { in_stock: { value: true, boost: 0.5 } } });

  const textQuery: Query = matchAny
    ? { bool: { should: words, minimum_should_match: 1 } }
    : { bool: { must: words } };
  const sort: unknown[] = query.sort === "price_asc" ? [{ price_kopeks: { order: "asc", missing: "_last" } }]
    : query.sort === "price_desc" ? [{ price_kopeks: { order: "desc", missing: "_last" } }]
      : query.sort === "name" ? [{ name_sort: "asc" }]
        : query.sort === "newest" ? [{ created_at: "desc" }]
          : ["_score", { in_stock: "desc" }, { name_sort: "asc" }];
  return {
    from: query.offset,
    size: query.limit,
    track_total_hits: true,
    _source: false,
    query: { bool: { filter, must: [textQuery], should: boosts } },
    sort: [...sort, { id: "asc" }],
  };
}

export class OpenSearchCatalogEngine implements CatalogSearchEngine {
  readonly name = "opensearch";
  private unavailableUntil = 0;

  constructor(
    private readonly options: { authorization?: string; index: string; timeoutMs: number; url: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async search(input: CatalogSearchInput, matchAny: boolean): Promise<CatalogSearchEngineResult | null> {
    if (this.now() < this.unavailableUntil) return null;
    try {
      const response = await this.fetchImpl(`${this.options.url.replace(/\/$/u, "")}/${this.options.index}/_search`, {
        body: JSON.stringify(openSearchRequest(input, matchAny)),
        headers: {
          "Content-Type": "application/json",
          ...(this.options.authorization ? { Authorization: this.options.authorization } : {}),
        },
        method: "POST",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!response.ok) throw new Error(`opensearch_status_${response.status}`);
      const body = SearchResponseSchema.parse(await response.json());
      return { ids: body.hits.hits.map((hit) => hit._id), total: body.hits.total.value };
    } catch {
      // PostgreSQL answers this request; try the engine again in 30 seconds.
      this.unavailableUntil = this.now() + 30_000;
      return null;
    }
  }
}

const SearchResponseSchema = z.object({
  hits: z.object({
    total: z.object({ value: z.number().int().min(0) }),
    hits: z.array(z.object({ _id: z.uuid() })),
  }),
});
