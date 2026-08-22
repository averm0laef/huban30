// Deterministic query/article normalisation, shared by every app that needs
// to agree on "is this the same article number" -- apps/api (catalog search
// and 1C exchange slugs), apps/worker (article-cross ingestion) and,
// transitively, apps/web wherever it imports @an30/contracts types. Living
// here instead of inside apps/api avoids a second, drifting copy of this
// logic the moment a second app (the worker, ingesting Rossko crosses)
// needed the exact same fold. apps/api/src/catalog/catalog-search-normalize.ts
// re-exports this module verbatim so its existing importers and tests did
// not need to change.
//
// Two separate concerns:
//
//   - normalizeSearchQuery: general text cleanup (trim, collapse whitespace)
//     used for the free-text/trigram side of a search -- product names.
//   - normalizeArticleNumber: a stricter fold used to compare article/SKU
//     numbers, where "W 914/2", "w914-2" and "W914/2" must all resolve to the
//     same key. This mirrors app.normalize_article(text) in migration 0016
//     exactly (case fold, then the same Cyrillic/Latin homoglyph table, then
//     strip the same punctuation set) -- the stored app.products.sku_normalized
//     column and this function must always agree, or an article that matches
//     at query time could fail to match the stored row and vice versa.
//   - normalizeBrand: mirrors app.normalize_brand(text) in migration 0018
//     (upper-case, strip whitespace/hyphens) -- the other half of the
//     "normalised article + normalised brand" matching key docs/CATALOG_MATCHING.md
//     specifies for crosses. Deliberately does not resolve brand-name
//     synonyms (see that doc): that is a manually curated table, not a fold.
//
// The homoglyph table only needs to go one way (Cyrillic -> Latin): both the
// stored article and the incoming query are folded through the very same
// table, so it does not matter which script either side happens to use --
// "С" (Cyrillic Es) and "C" (Latin Cee) both end up as "C" on both sides.
// This is what "map the confusable set both ways" resolves to in practice.
const HOMOGLYPH_CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
};

const ARTICLE_PUNCTUATION_PATTERN = /[\s.\-/]+/gu;
const BRAND_PUNCTUATION_PATTERN = /[\s-]+/gu;

/** Trim + collapse internal whitespace. Safe to call on any free-text query. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/gu, " ");
}

/** Cyrillic-lookalike letters folded to their Latin equivalent; anything else passes through unchanged. */
export function foldHomoglyphs(value: string): string {
  return [...value].map((character) => HOMOGLYPH_CYRILLIC_TO_LATIN[character] ?? character).join("");
}

/**
 * Canonical article-number key: case-folded, homoglyph-folded, then stripped
 * of the punctuation that varies between how a customer types an article and
 * how 1C stores it (spaces, hyphens, dots, slashes). Must be kept in sync
 * with app.normalize_article in migration 0016.
 */
export function normalizeArticleNumber(raw: string): string {
  const upper = normalizeSearchQuery(raw).toUpperCase();
  return foldHomoglyphs(upper).replace(ARTICLE_PUNCTUATION_PATTERN, "");
}

/**
 * Canonical brand key: case-folded, whitespace/hyphen-stripped ("MANN",
 * "MANN-FILTER", "MANN FILTER" -> "MANNFILTER"). Must be kept in sync with
 * app.normalize_brand in migration 0018. Unlike normalizeArticleNumber this
 * does not fold Cyrillic homoglyphs or resolve brand-name synonyms -- see
 * docs/CATALOG_MATCHING.md: synonym resolution is a manually curated table
 * that does not exist yet, so two spellings that survive this fold
 * differently are simply treated as different brands. That only ever makes
 * matching stricter, never looser, which is the safe direction to fail in.
 */
export function normalizeBrand(raw: string): string {
  return normalizeSearchQuery(raw).toUpperCase().replace(BRAND_PUNCTUATION_PATTERN, "");
}
