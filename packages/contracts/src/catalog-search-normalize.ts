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
//   - foldYo: mirrors app.fold_yo(text) in migration 0025 (ё/Ё -> е/Е, see
//     that function's doc) -- the free-text/trigram/full-text side's
//     equivalent of what the homoglyph table does for articles. Applied to
//     the query in catalog-public.service.ts; the stored side is folded the
//     same way by the generated app.products.name_folded/search_text_folded
//     columns migration 0025 adds, so a query and a stored name that differ
//     only in ё-vs-е always compare equal regardless of which side (or
//     neither, or both) actually used ё.
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

// -- Search recovery for a mistyped Russian query (AN30-013 search-gap fix) -
//
// Two independent, unrelated ways a customer's search for a Cyrillic word
// ends up typed in Latin letters:
//
//   - Phonetic transliteration: they spell the word out by its sound
//     ("filtr" for "фильтр") -- common when a site or habit is Latin-first.
//   - A forgotten keyboard layout: they type the actual Cyrillic word, but
//     the OS layout is left on English, so every keystroke lands on
//     whichever Latin letter shares that key's *physical position* on a
//     standard ЙЦУКЕН layout ("фильтр" -> "abkmnh"; note this has nothing to
//     do with how the word sounds -- "ф" and "a" share a key, not a sound).
//
// Both recover the same way: produce a Cyrillic candidate string and let the
// caller (CatalogPublicService.products(), the shop's one search path) run
// it through the exact same substring/trigram/full-text matching it already
// applies to the raw query -- see alternateSearchQueries and
// catalog-public.service.ts's PUBLIC_PRODUCT_FILTERS.
const TRANSLITERATION_DIGRAPHS_LATIN_TO_CYRILLIC: ReadonlyArray<readonly [string, string]> = [
  // Checked longest-first so "shch" (4) is not shadowed by "sh" (2) matching first.
  ["shch", "щ"],
  ["sch", "щ"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["ch", "ч"],
  ["sh", "ш"],
  ["yu", "ю"],
  ["ya", "я"],
  ["yo", "е"],
];

const TRANSLITERATION_SINGLE_LATIN_TO_CYRILLIC: Record<string, string> = {
  a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и",
  j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р",
  s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "й", z: "з",
};

// Each Latin letter maps to the Cyrillic letter at the same physical key on
// a standard Windows ЙЦУКЕН layout (a<->ф, b<->и, ... -- e.g. verify against
// "фильтр": ф,и,л,ь,т,р -> a,b,k,m,n,h -> "abkmnh"). Deliberately letters
// only: digits and punctuation sit at the same keys on both layouts, so they
// already pass through a real layout mismatch unchanged and need no mapping.
const LAYOUT_SWAP_LATIN_TO_CYRILLIC: Record<string, string> = {
  a: "ф", b: "и", c: "с", d: "в", e: "у", f: "а", g: "п", h: "р", i: "ш",
  j: "о", k: "л", l: "д", m: "ь", n: "т", o: "щ", p: "з", q: "й", r: "к",
  s: "ы", t: "е", u: "г", v: "м", w: "ц", x: "ч", y: "н", z: "я",
};

const HAS_CYRILLIC_LETTER_PATTERN = /[а-яё]/iu;
const LATIN_LETTERS_PATTERN = /[a-z]/giu;
// Mirrors the length>=3 gate catalog-public.service.ts already applies to
// its own substring/trigram fallback: a 1-2 character candidate is too
// generic to be a useful signal and would just add noise, not recall.
const MIN_ALTERNATE_QUERY_LENGTH = 3;

/** Trim + collapse internal whitespace. Safe to call on any free-text query. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/gu, " ");
}

/** Cyrillic-lookalike letters folded to their Latin equivalent; anything else passes through unchanged. */
export function foldHomoglyphs(value: string): string {
  return [...value].map((character) => HOMOGLYPH_CYRILLIC_TO_LATIN[character] ?? character).join("");
}

/**
 * Folds ё -> е and Ё -> Е and nothing else -- case of the rest of the string
 * is untouched, unlike normalizeArticleNumber/normalizeBrand which
 * upper-case everything. Almost no customer types ё (a separate,
 * often-unlabeled key on a physical Russian keyboard, and autocorrect on
 * mobile drops it too), so a product name stored with a ё (as 1C exports it)
 * was unreachable by the near-universal plain spelling until this fold is
 * applied to both the query (here, in catalog-public.service.ts) and the
 * stored text it is compared against.
 *
 * Must be kept in sync with app.fold_yo in migration 0025, which applies the
 * identical fold to build app.products.name_folded and
 * .search_text_folded -- if the two folds ever disagree, a query folded one
 * way could still fail to match stored text folded another.
 */
export function foldYo(value: string): string {
  return value.replace(/ё/gu, "е").replace(/Ё/gu, "Е");
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

/** Phonetic Latin -> Cyrillic transliteration ("filtr" -> "филтр") -- see the module comment above for how this differs from swapKeyboardLayoutToCyrillic. Case-insensitive; anything not a recognised Latin letter (digits, punctuation, already-Cyrillic text) passes through unchanged. */
export function transliterateLatinToCyrillic(raw: string): string {
  const input = raw.toLowerCase();
  let result = "";
  let index = 0;
  while (index < input.length) {
    const digraph = TRANSLITERATION_DIGRAPHS_LATIN_TO_CYRILLIC.find(([latin]) => input.startsWith(latin, index));
    if (digraph) {
      result += digraph[1];
      index += digraph[0].length;
      continue;
    }
    const character = input[index]!;
    result += TRANSLITERATION_SINGLE_LATIN_TO_CYRILLIC[character] ?? character;
    index += 1;
  }
  return result;
}

/** Physical-key-position Latin -> Cyrillic swap ("abkmnh" -> "фильтр") -- recovers a Cyrillic word typed with the wrong keyboard layout active. See the module comment above for how this differs from transliterateLatinToCyrillic. Case-insensitive; anything outside LAYOUT_SWAP_LATIN_TO_CYRILLIC (digits, punctuation, already-Cyrillic text) passes through unchanged. */
export function swapKeyboardLayoutToCyrillic(raw: string): string {
  return [...raw.toLowerCase()].map((character) => LAYOUT_SWAP_LATIN_TO_CYRILLIC[character] ?? character).join("");
}

/**
 * Recovery candidates for a search query that looks like a Cyrillic word
 * mistyped in Latin -- see the module comment above. Returns 0-2 distinct
 * Cyrillic strings (transliteration, then layout-swap, in that order) for
 * the caller to match the same way it already matches the raw query.
 *
 * Only attempted when the query has no Cyrillic letters at all and at least
 * three Latin letters: an already-Cyrillic query needs neither recovery, and
 * a short or mostly-numeric query (an article number like "W914/2", already
 * handled by normalizeArticleNumber above) is left alone rather than being
 * reinterpreted as a misspelled word. A candidate shorter than three
 * characters, or identical to one already produced, is dropped for the same
 * low-precision reason -- see MIN_ALTERNATE_QUERY_LENGTH.
 */
export function alternateSearchQueries(raw: string): string[] {
  const trimmed = normalizeSearchQuery(raw);
  if (HAS_CYRILLIC_LETTER_PATTERN.test(trimmed)) return [];
  const latinLetterCount = trimmed.match(LATIN_LETTERS_PATTERN)?.length ?? 0;
  if (latinLetterCount < MIN_ALTERNATE_QUERY_LENGTH) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of [transliterateLatinToCyrillic(trimmed), swapKeyboardLayoutToCyrillic(trimmed)]) {
    if (candidate.length < MIN_ALTERNATE_QUERY_LENGTH || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}
