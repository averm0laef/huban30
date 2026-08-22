-- Cross-reference ("кроссы") index: which article numbers identify the same
-- physical part, so a customer searching an OEM number (or any aftermarket
-- brand's number) finds the shop's own product even when 1C only ever
-- carries one of those numbers. See docs/CATALOG_MATCHING.md for the
-- matching philosophy this reuses (normalised article + brand, homoglyph
-- folding, exact-only auto-apply, manual confirmation for anything weaker).
--
-- Reuses app.normalize_article (migration 0016) rather than a second
-- article normaliser. app.normalize_brand below is new: no brand normaliser
-- existed yet anywhere in the schema.
CREATE FUNCTION app.normalize_brand(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- docs/CATALOG_MATCHING.md's brand rule: upper-case, strip whitespace and
  -- hyphens ("MANN", "MANN-FILTER", "MANN FILTER" -> "MANNFILTER"). The docs
  -- also call for a manually-curated synonym table for brand names that
  -- don't share a common substring at all (e.g. two different transliterations)
  -- -- that table does not exist yet anywhere in this schema and is
  -- deliberately not invented here (the docs say it must be filled by hand as
  -- real mismatches are found, not guessed at). Until it exists, two spellings
  -- of a brand that survive this fold differently are simply treated as
  -- different brands, which only ever makes matching stricter, never looser.
  SELECT regexp_replace(upper(coalesce(value, '')), '[\s\-]+', '', 'g')
$$;

COMMENT ON FUNCTION app.normalize_brand(text) IS
  'Case-folded, whitespace/hyphen-stripped brand key, mirrored by the TypeScript normalizeBrand() in packages/contracts/src/catalog-search-normalize.ts. Deliberately does not resolve brand-name synonyms (see docs/CATALOG_MATCHING.md) -- that is a manually curated table this migration does not add.';

-- One row per equivalence pair, not one row per direction.
--
-- A cross is symmetric (A<->B implies B<->A), and this table stores exactly
-- one row per pair rather than two mirrored rows, for two reasons:
--   1. Correctness: two independent rows for the same pair could drift --
--      one confirmed, one not, or one re-ingested with a fresher
--      last_seen_at than the other -- and a drifted pair is exactly the kind
--      of silent inconsistency a safety-critical "does this part actually
--      fit" feature cannot afford. One row cannot drift from itself.
--   2. Cost: crosses are a small table relative to app.products (tens of
--      thousands of products, a much smaller multiple of cross pairs), so
--      storing one row and reading it back with an OR/UNION across both
--      (article_a, article_b) is cheap, and the reverse-direction lookup
--      gets its own partial index below rather than a second table scan.
--
-- The pair is stored in a canonical order -- whichever side sorts first by
-- (article, brand) becomes "_a" -- purely so the UNIQUE constraint can
-- de-duplicate a pair regardless of which side ingestion happened to see
-- first; "_a" carries no semantic meaning ("first-seen", "preferred", etc).
CREATE TABLE app.article_crosses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Matching key, both sides: app.normalize_article() + app.normalize_brand().
  -- brand_a/brand_b may be '' when the source did not supply a brand at all
  -- (see `status` below -- a blank brand on either side means the pair can
  -- never be confirmed automatically).
  article_a text NOT NULL CHECK (article_a <> ''),
  brand_a text NOT NULL,
  article_b text NOT NULL CHECK (article_b <> ''),
  brand_b text NOT NULL,

  -- Original, unnormalised strings, kept only so a human review queue or a
  -- "found via cross to X" label can show the article the way the source
  -- actually spelled it, instead of the stripped matching key.
  article_a_raw text NOT NULL,
  brand_a_raw text NOT NULL,
  article_b_raw text NOT NULL,
  brand_b_raw text NOT NULL,

  -- Trust differs by source: a supplier's own cross-reference table is not
  -- the same kind of evidence as a staff member typing in a known pair.
  source text NOT NULL CHECK (source IN ('rossko', 'one_c', 'manual')),

  -- The correctness bar this table exists to enforce: only a human-confirmed
  -- pair may widen search (see catalog-public.service.ts and
  -- docs/CATALOG_MATCHING.md). A supplier/1C assertion is still presumptive,
  -- even when both sides carry brand+article, so background ingestion stores
  -- it as 'unconfirmed'. An explicitly manual source may create a confirmed
  -- pair; anything incomplete also remains in the review queue.
  status text NOT NULL DEFAULT 'unconfirmed' CHECK (status IN ('confirmed', 'unconfirmed')),
  confirmed_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  -- confirmed_at is set if and only if status is 'confirmed' -- keeps the
  -- two columns from silently disagreeing (e.g. a confirmed row whose
  -- timestamp was never set).
  CONSTRAINT article_crosses_confirmed_at_matches_status CHECK (
    (status = 'confirmed') = (confirmed_at IS NOT NULL)
  ),
  -- Canonical ordering AND the anti-self-pair guard in one constraint: a row
  -- where both sides normalise to the exact same (article, brand) -- "this
  -- part is a cross of itself" -- fails this strict inequality and is
  -- rejected by the database, not by application code.
  CONSTRAINT article_crosses_ordered_pair CHECK ((article_a, brand_a) < (article_b, brand_b)),
  -- Never a duplicate pair: the same (normalised) equivalence ingested a
  -- hundred times, from one source or several, is one row. Re-ingestion is
  -- therefore an ON CONFLICT DO UPDATE against exactly this constraint (see
  -- apps/worker/src/article-cross-ingest.ts).
  CONSTRAINT article_crosses_pair_uidx UNIQUE (article_a, brand_a, article_b, brand_b)
);

COMMENT ON TABLE app.article_crosses IS
  'Symmetric article-number equivalence pairs ("кроссы"): one row per confirmed-or-pending pair, read back in both directions by catalog search. See docs/CATALOG_MATCHING.md for the matching philosophy and the table-level comment above for why one row rather than two.';
COMMENT ON COLUMN app.article_crosses.status IS
  'confirmed = a human has approved the equivalence and search may widen through it. unconfirmed = supplier/1C evidence awaiting review; catalog search must never use it to return a different part than the one searched for.';

-- The unique constraint above already gives article_a a leading-column
-- index for free (covers "give me every pair where article_a=$1"). This is
-- the other direction search actually needs (article_b=$1), scoped to the
-- only rows a query is ever allowed to use so the index stays small and the
-- planner never has to look at a pending, unconfirmed pair to answer a
-- customer's search.
CREATE INDEX article_crosses_article_b_confirmed_idx
  ON app.article_crosses (article_b) WHERE status = 'confirmed';

-- Staff review queue lookup: "show me what's waiting", oldest first.
CREATE INDEX article_crosses_unconfirmed_idx
  ON app.article_crosses (last_seen_at) WHERE status = 'unconfirmed';
