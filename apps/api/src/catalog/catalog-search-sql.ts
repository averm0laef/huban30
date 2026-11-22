// SQL for the public catalog search (CatalogPublicService.products()).
//
// The statement is generated per request from the search plan so that
// PostgreSQL can answer it from indexes instead of scanning every product:
// each word of the query becomes an OR of index-friendly conditions on its
// alternatives (see catalog-search-tokens.ts), and the words are AND-ed
// (strict pass) or OR-ed (zero-results retry). Every value is a bound
// parameter; only placeholders are interpolated.
//
// Indexes used (migrations 0016, 0025, 0033):
//   - search_text_folded gin_trgm_ops  -- ILIKE '%word%', ~* pattern, <% (typo)
//   - name_folded gin_trgm_ops         -- whole phrase ILIKE, % (retry only)
//   - sku_normalized text_pattern_ops  -- article prefix
//   - sku_normalized gin_trgm_ops      -- article fragment ("914/2")
//   - to_tsvector('simple'|'russian', search_text_folded)
//   - brands are matched through a sub-select on app.brands (small table)
//     and products_brand_idx.
//
// search_text_folded is app.fold_yo(coalesce(search_text, name)) and 1C
// writes search_text as "<article> <name>", so it is the article + name
// document; the brand name is matched separately because it lives in
// app.brands.

import type { CatalogProductsQuery } from "@an30/contracts";

import { normalizeArticleNumber } from "./catalog-search-normalize.js";
import type { SearchTokenPlan } from "./catalog-search-tokens.js";

export class SqlParameters {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export interface CatalogSearchInput {
  query: CatalogProductsQuery;
  /** query.q with ё folded, or null when browsing without a query. */
  folded: string | null;
  identity: { article: string; brandKeys: string[]; articleOnly: boolean };
  plan: SearchTokenPlan;
  /** Whole-query recovery candidates (alias, transliteration, layout), ё-folded. */
  alternates: string[];
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/**
 * Every *confirmed* article-cross equivalent of the normalised query
 * article, read back in both stored directions (migration 0018 stores one
 * row per pair). The target brand travels with the target article: an
 * article number alone is not an identity (docs/CATALOG_MATCHING.md).
 * Only status='confirmed' rows can widen a customer's search.
 */
export function crossEquivalentsCte(article: string): string {
  return `cross_equivalents AS (
  SELECT article_b AS article,brand_b AS brand FROM app.article_crosses
    WHERE article_a=${article} AND status='confirmed'
  UNION
  SELECT article_a AS article,brand_a AS brand FROM app.article_crosses
    WHERE article_b=${article} AND status='confirmed'
)`;
}

// Brands are compared by identity (app.canonical_brand, migration 0042):
// 1С may call the brand «MANN» while the cross names «MANN-FILTER».
export const CROSS_MATCH = `(product.sku_normalized<>'' AND EXISTS (
  SELECT 1 FROM cross_equivalents
  WHERE cross_equivalents.article=product.sku_normalized
    AND app.canonical_brand(cross_equivalents.brand)=app.canonical_brand(brand.name)))`;

// Indexable first half (sku_normalized = ANY) and the brand check as a
// recheck: the article alone never decides a cross match.
const CROSS_FILTER = `(product.sku_normalized=ANY(ARRAY(SELECT article FROM cross_equivalents)) AND ${CROSS_MATCH})`;

function wordConditions(p: SqlParameters, plan: SearchTokenPlan, word: number): string[] {
  const conditions: string[] = [];
  const texts = plan.alternatives.filter((alternative) => alternative.word === word && alternative.text !== null).map((alternative) => alternative.text!);
  for (const alternative of plan.alternatives) {
    if (alternative.word !== word) continue;
    if (alternative.pattern !== null) {
      conditions.push(`product.search_text_folded ~* ${p.add(alternative.pattern)}`);
      continue;
    }
    const text = alternative.text ?? "";
    // "колодки" adds nothing to the substring match once "колодк" is there.
    const covered = texts.some((other) => other !== text && other.length >= 3 && text.includes(other));
    if (!covered) {
      const contains = p.add(`%${escapeLike(text)}%`);
      // Two characters ("h7") give the trigram index nothing to look up, so
      // they match as the start of a word through the full-text index.
      conditions.push(/^[\p{L}\p{N}]{2}$/u.test(text)
        ? `to_tsvector('simple',product.search_text_folded) @@ to_tsquery('simple',${p.add(`${text}:*`)})`
        : `product.search_text_folded ILIKE ${contains}`);
      conditions.push(`product.brand_id=ANY(ARRAY(SELECT searched_brand.id FROM app.brands AS searched_brand
      WHERE app.fold_yo(searched_brand.name) ILIKE ${contains}))`);
    }
    if (/\d/u.test(text)) {
      const article = normalizeArticleNumber(text);
      if (article) conditions.push(`product.sku_normalized LIKE ${p.add(`${escapeLike(article)}%`)}`);
    }
    // word_similarity(text, document) >= pg_trgm.word_similarity_threshold,
    // set per pass by the service (stricter first, looser in the retry).
    if (alternative.fuzzy) conditions.push(`${p.add(text)} <% product.search_text_folded`);
  }
  return conditions;
}

/**
 * One index-friendly SELECT of product ids per condition. A single WHERE
 * with twenty OR-ed conditions makes PostgreSQL over-estimate the matches
 * and read the whole table (0.5 s on 50 000 products); each condition alone
 * is a 1-5 ms bitmap index scan, so they are combined as sets instead.
 */
function idsWhere(condition: string, withBrand = false): string {
  return `SELECT product.id FROM app.products AS product${withBrand ? " LEFT JOIN app.brands AS brand ON brand.id=product.brand_id" : ""}
    WHERE product.deleted_at IS NULL AND ${condition}`;
}

function anyOf(selects: readonly string[]): string {
  return selects.length > 0 ? `(${selects.join("\n    UNION ")})` : "(SELECT NULL::uuid AS id WHERE false)";
}

function searchHits(p: SqlParameters, input: CatalogSearchInput, matchAny: boolean): string {
  const folded = input.folded ?? "";
  const q = p.add(folded);
  const branches: string[] = [];
  // An article needs a digit: "колодки" read as an article is just noise.
  if (input.identity.article !== "" && (/\d/u.test(input.identity.article) || input.identity.articleOnly)) {
    branches.push(idsWhere(`product.sku_normalized LIKE ${p.add(`${escapeLike(input.identity.article)}%`)}`));
    // A fragment from the middle of an article ("914/2" for W914/2).
    if (input.identity.article.length >= 4) {
      branches.push(idsWhere(`product.sku_normalized LIKE ${p.add(`%${escapeLike(input.identity.article)}%`)}`));
    }
    branches.push(idsWhere(CROSS_FILTER, true));
    // The number written in the name, in either alphabet (see codeWrittenInName).
    if (input.identity.articleOnly) {
      for (const spelling of codeWrittenInName(input.identity.article)) {
        branches.push(idsWhere(`product.search_text_folded ILIKE ${p.add(`%${escapeLike(spelling)}%`)}`));
      }
    }
  }
  const words = input.plan.words.map((_word, index) => anyOf(wordConditions(p, input.plan, index + 1).map((condition) => idsWhere(condition))));
  if (words.length > 0) branches.push(`SELECT id FROM (${words.join(matchAny ? "\n    UNION " : "\n    INTERSECT ")}) AS word_hits`);
  // The whole phrase / whole-query closeness ignore which words matched
  // (and "5w-40" is a substring of "15W-40"), so they only serve the retry
  // and queries without usable words.
  if ((matchAny || words.length === 0) && folded.length >= 3) {
    branches.push(idsWhere(`product.name_folded ILIKE ${p.add(`%${escapeLike(folded)}%`)}`));
  }
  if (matchAny && folded.length >= 3) branches.push(idsWhere(`product.name_folded % ${q}`));
  branches.push(idsWhere(`to_tsvector('simple',product.search_text_folded) @@ websearch_to_tsquery('simple',${q})`));
  // Snowball stemming (PostgreSQL's 'russian' configuration), see migration 0025.
  branches.push(idsWhere(`to_tsvector('russian',product.search_text_folded) @@ websearch_to_tsquery('russian',${q})`));
  if (folded.length >= 3) {
    for (const alternate of input.alternates) {
      if (alternate.length < 3) continue;
      const contains = p.add(`%${escapeLike(alternate)}%`);
      const plain = p.add(alternate);
      branches.push(idsWhere(`product.name_folded ILIKE ${contains}`));
      branches.push(idsWhere(`product.search_text_folded ILIKE ${contains}`));
      branches.push(idsWhere(`to_tsvector('simple',product.search_text_folded) @@ websearch_to_tsquery('simple',${plain})`));
      if (matchAny) branches.push(idsWhere(`product.name_folded % ${plain}`));
    }
  }
  return `product.id IN ${anyOf(branches)}`;
}

/** WITH clause: visible categories, the requested subtree and confirmed crosses. */
export function catalogSearchCte(p: SqlParameters, input: CatalogSearchInput, visibleWithSubtree: (slug: string) => string) {
  const category = p.add(input.query.category ?? null);
  const article = p.add(input.identity.article);
  return { article, sql: `${visibleWithSubtree(category)}, ${crossEquivalentsCte(article)}` };
}

const LATIN_TO_CYRILLIC_LOOKALIKE: Readonly<Record<string, string>> = {
  A: "а", B: "в", C: "с", E: "е", H: "н", K: "к", M: "м", O: "о", P: "р", T: "т", X: "х", Y: "у",
};

/**
 * How a part number may stand in a product's NAME. The owner's base writes the shop's own code before the name —
 * «(КС171) Фильтр топливный…» — and other makers' numbers after it, in Cyrillic look-alikes as often as in Latin.
 * A query shaped like a number was looked up among articles and crosses only, so «КС171» found nothing. The code is
 * matched exactly as written (both alphabets), never by closeness: a neighbouring number is another part. Short or
 * digits-only codes are left to the article: «2024» stands in too many names by chance.
 */
export function codeWrittenInName(article: string): string[] {
  if (article.length < 4 || !(/[A-Z]/u.test(article) || article.length >= 6)) return [];
  const latin = article.toLowerCase();
  const cyrillic = [...article].map((letter) => (/[0-9]/u.test(letter) ? letter : LATIN_TO_CYRILLIC_LOOKALIKE[letter] ?? null));
  return cyrillic.includes(null) ? [latin] : [...new Set([latin, cyrillic.join("")])];
}

/** WHERE clause for one pass (strict, or the any-word retry). */
export function catalogSearchFilter(p: SqlParameters, input: CatalogSearchInput, matchAny: boolean): string {
  const { query, identity } = input;
  const filters = [
    "product.is_active AND product.deleted_at IS NULL",
    "(product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))",
    "(product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))",
  ];
  if (query.category) filters.push("category.id IN (SELECT id FROM category_subtree)");
  if (query.brand.length > 0) filters.push(`brand.slug::text=ANY(${p.add(query.brand)}::text[])`);
  if (query.minPriceKopeks !== undefined) filters.push(`price.amount_kopeks >= ${p.add(query.minPriceKopeks)}`);
  if (query.maxPriceKopeks !== undefined) filters.push(`price.amount_kopeks <= ${p.add(query.maxPriceKopeks)}`);
  if (query.availability === "in_stock") filters.push("stock.available_quantity>0");
  if (query.availability === "out_of_stock") filters.push("stock.available_quantity=0");
  if (input.folded !== null) filters.push(searchHits(p, input, matchAny));
  // A concrete part number may use punctuation, case or brand aliases, but
  // must never turn into a fuzzy match for a neighbouring numeric article.
  if (identity.articleOnly) {
    filters.push(identity.article === ""
      ? "false"
      : `(product.sku_normalized LIKE ${p.add(`${escapeLike(identity.article)}%`)}
    ${identity.article.length >= 4 ? `OR product.sku_normalized LIKE ${p.add(`%${escapeLike(identity.article)}%`)}` : ""}
    ${codeWrittenInName(identity.article).map((spelling) => `OR product.search_text_folded ILIKE ${p.add(`%${escapeLike(spelling)}%`)}`).join("\n    ")}
    OR ${CROSS_FILTER})`);
  }
  if (identity.brandKeys.length > 0) filters.push(`app.normalize_brand(brand.name)=ANY(${p.add(identity.brandKeys)}::text[])`);
  return filters.join("\n  AND ");
}

/**
 * ORDER BY for a search sorted by relevance, plus the LATERAL join that
 * computes the fuzzy text score once per matched row.
 */
export function catalogSearchRelevanceOrder(p: SqlParameters, input: CatalogSearchInput, article: string): { join: string; order: string } {
  const q = p.add(input.folded ?? "");
  const alternates = p.add(input.alternates);
  const leads = p.add(input.plan.leads.map(escapeLike));
  // Fuzzy text relevance, used only after every exact article/cross/prefix
  // tier: trigram closeness of the name to the query or to a whole-query
  // recovery candidate, and word-level closeness of the query to the
  // article+name document. (Full-text ts_rank was dropped: re-parsing every
  // matched row's tsvector cost more than it added once words match.)
  const join = `CROSS JOIN LATERAL (SELECT GREATEST(
    similarity(product.name_folded, ${q}),
    COALESCE((SELECT max(similarity(product.name_folded, alt_query))
      FROM unnest(${alternates}::text[]) AS alt_query WHERE length(alt_query)>=3), 0),
    word_similarity(${q}, product.search_text_folded)) AS score) AS relevance`;
  const order = `(${article}<>'' AND product.sku_normalized=${article}) DESC,
    ${CROSS_MATCH} DESC,
    (${article}<>'' AND product.sku_normalized LIKE ${p.add(`${escapeLike(input.identity.article)}%`)}) DESC,
    -- The name starts with the product type the customer named ("диски
    -- тормозные" -> "Диск тормозной ..." before "Колодки тормозные
    -- дисковые"): 1C names lead with the part type.
    EXISTS (SELECT 1 FROM unnest(${leads}::text[]) AS lead(stem)
      WHERE product.name_folded ILIKE lead.stem || '%') DESC,
    -- Text relevance in coarse steps, so that what can be bought today comes
    -- first among equally relevant rows, then the exact score.
    floor(LEAST(relevance.score,1)*4) DESC,
    (stock.available_quantity>0) DESC,
    relevance.score DESC,
    lower(product.name) ASC`;
  return { join, order };
}
