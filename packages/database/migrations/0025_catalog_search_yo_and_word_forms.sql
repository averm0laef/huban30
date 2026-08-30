-- AN30-013 search-gap fix: two recall gaps in catalog search measured
-- against live staging (see catalog-public.service.ts's PUBLIC_PRODUCT_FILTERS
-- comment for the query this backs). Neither is touched by the punctuation/
-- homoglyph article fold (migration 0016) or the transliteration/
-- layout-swap recovery (catalog-search-normalize.ts): both of those operate
-- on the article-number side or a Latin-typed query, not on plain Cyrillic
-- free text.
--
--   1. "ё" was never folded to "е" anywhere on the free-text search path.
--      Almost no customer types ё (a separate, often-unlabeled key), so a
--      product stored as "Щётка стеклоочистителя ..." (1C exports names
--      with the ё) was unreachable by the near-universal plain spelling
--      "щетка" -- ILIKE, trigram similarity() and to_tsvector('simple', ...)
--      all compare literal characters, and ё <> е to all three.
--
--      app.fold_yo folds ё->е and Ё->Е and nothing else, mirroring
--      app.normalize_article (migration 0016): an IMMUTABLE SQL function
--      used to build two generated, indexed columns so the *stored* text is
--      folded, while catalog-public.service.ts folds the *query* the same
--      way (foldYo in catalog-search-normalize.ts) before it ever reaches
--      this statement -- see that function's doc for why both sides must
--      agree, and this migration's function comment for why a query typed
--      one way must still find a name stored the other.
--
--      Being STORED generated columns, ADD COLUMN below computes them for
--      every existing row as part of this migration -- not just future
--      rows -- so this is the backfill, not a separate step.
--
--   2. Search matches substrings/trigrams/lexemes of the *exact* text
--      typed, never a Russian word form: "щёток" (genitive plural) does not
--      share enough trigrams with a multi-word product name to clear the
--      0.25 similarity floor, and to_tsvector('simple', ...) never stems
--      ("щеток" and "щетка" are unrelated lexemes to the 'simple' config).
--      Real morphological analysis (a pymorphy2/hunspell-style dictionary)
--      is a large dependency this fix does not take on.
--
--      Instead, PUBLIC_PRODUCT_FILTERS gets one more OR-branch/GREATEST()
--      term reusing PostgreSQL's built-in 'russian' text-search
--      configuration, which already ships a real (Snowball) Russian
--      stemmer -- no extension, no external dictionary, same
--      tsvector/GIN-index/websearch_to_tsquery idiom the 'simple' branch
--      already uses. Being additive, it can only add recall, never remove
--      an existing match or narrow one.
--
--      This recovers *regular* suffix-based word-form variation for free:
--      plural "фильтры" now finds "Фильтр масляный" (both stem to
--      "фильтр" -- "ы" is a recognised noun-suffix the stemmer strips;
--      "фильтр" itself has no suffix to strip, so it is already its own
--      stem), and adjective case/gender agreement the same way.
--
--      It does NOT fix "щёток" itself, the example that motivated this
--      migration: that form's "о" is an epenthetic ("fleeting") vowel
--      Russian inserts into a genitive plural that otherwise has no case
--      ending of its own ("щётка" -> "щёт" + "о" + "к"), not a suffix --
--      there is no suffix left for a suffix-stripping stemmer to strip, so
--      'russian' stems "щеток" (already ё-folded) to itself, not to "щетк"
--      (what it gives "щетка"). Catching this specific, common-in-practice
--      case would need a real morphological dictionary, not a stemmer --
--      see catalog-public.service.test.ts for the test documenting this as
--      a known, deliberate gap rather than an oversight.
--
-- Both fixes only ever add an OR-branch/GREATEST() term -- the exact-article
-- and prefix tiers (sku_normalized, unaffected by any of this), the
-- length>=3 low-precision guards, and every existing branch are otherwise
-- untouched, so "W 914/2"/"w914-2" and the transliteration/layout-swap
-- recovery keep working exactly as before.

CREATE FUNCTION app.fold_yo(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT replace(replace(coalesce(value, ''), 'ё', 'е'), 'Ё', 'Е')
$$;

COMMENT ON FUNCTION app.fold_yo(text) IS
  'ё->е and Ё->Е only, case of everything else left untouched. Mirrors foldYo in catalog-search-normalize.ts -- both the stored, generated *_folded columns below and the query (folded in catalog-public.service.ts before it is sent) must run through an equivalent fold, or a customer typing the plain, near-universal spelling of a ё-word will not find a product named with the ё.';

ALTER TABLE app.products
  ADD COLUMN name_folded text GENERATED ALWAYS AS (app.fold_yo(name)) STORED,
  ADD COLUMN search_text_folded text GENERATED ALWAYS AS (app.fold_yo(coalesce(search_text, name))) STORED;

COMMENT ON COLUMN app.products.name_folded IS
  'app.fold_yo(name): ё/Ё folded to е/Е. Backs the ILIKE substring and trigram similarity() branches in PUBLIC_PRODUCT_FILTERS, matched against a query folded the same way.';
COMMENT ON COLUMN app.products.search_text_folded IS
  'app.fold_yo(coalesce(search_text, name)): the same fold applied to the wider full-text source (search_text already folds in sku -- see commerce-ml.parser.ts). Backs the ''simple'' and ''russian'' to_tsvector branches in PUBLIC_PRODUCT_FILTERS.';

CREATE INDEX products_name_folded_trgm_idx ON app.products USING gin (name_folded gin_trgm_ops);
CREATE INDEX products_search_folded_simple_idx ON app.products USING gin (to_tsvector('simple', search_text_folded));
CREATE INDEX products_search_folded_russian_idx ON app.products USING gin (to_tsvector('russian', search_text_folded));
