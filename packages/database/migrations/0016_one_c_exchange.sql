-- CommerceML 2 ("Обмен с сайтом") 1C exchange endpoint, plus the search
-- normalisation this same request touches.
--
-- Three independent additions:
--   1. app.integration_endpoints gains a small summary of the last completed
--      exchange, so the owner-facing settings panel can show it without a
--      second table.
--   2. app.one_c_exchange_runs tracks a chunked, resumable, idempotent import
--      run for one uploaded file (import.xml or offers.xml). A 30-40k SKU
--      catalog cannot be validated and applied in a single transaction
--      without holding locks for minutes, so a run is processed in bounded
--      chunks across repeated `mode=import` polls (see
--      one-c-exchange-run.service.ts). The parsed rows are staged here
--      between polls rather than being re-parsed from the source XML on every
--      call, and rather than being buffered in server memory only (a process
--      restart mid-run must still be resumable from the database).
--   3. Deterministic, punctuation- and homoglyph-insensitive article
--      matching for catalog search (AN30 search recall work): a generated,
--      indexed `sku_normalized` column so "W 914/2", "w914-2" and "W914/2"
--      compare equal without re-normalising on every query.

ALTER TABLE app.integration_endpoints
  ADD COLUMN last_exchange_at timestamptz,
  ADD COLUMN last_exchange_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT integration_last_exchange_summary_object CHECK (
    jsonb_typeof(last_exchange_summary) = 'object'
  );

COMMENT ON COLUMN app.integration_endpoints.last_exchange_summary IS
  'Non-sensitive summary of the last completed 1C exchange run: {kind, filename, containsOnlyChanges, rowsTouched, rowsRejected}. No credentials or personal data.';

CREATE TABLE app.one_c_exchange_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('catalog', 'offers')),
  filename text NOT NULL,
  content_checksum bytea NOT NULL CHECK (octet_length(content_checksum) = 32),
  contains_only_changes boolean NOT NULL,
  exported_at timestamptz NOT NULL,
  batch_size integer NOT NULL CHECK (batch_size > 0),
  -- Fully parsed, not-yet-applied rows, staged so a poll never has to
  -- re-parse the source XML. header_rows are brand/category (catalog) or the
  -- single synthetic warehouse (offers) rows, always applied first so later
  -- product/price/stock chunks can reference them. tail_rows are the
  -- deactivation rows computed once the full catalog snapshot has been seen
  -- (see phase below); NULL until that computation happens.
  header_rows jsonb NOT NULL,
  body_rows jsonb NOT NULL,
  tail_rows jsonb,
  phase text NOT NULL DEFAULT 'header' CHECK (phase IN ('header', 'body', 'tail', 'done')),
  cursor_index integer NOT NULL DEFAULT 0 CHECK (cursor_index >= 0),
  rows_touched integer NOT NULL DEFAULT 0 CHECK (rows_touched >= 0),
  rows_rejected integer NOT NULL DEFAULT 0 CHECK (rows_rejected >= 0),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT one_c_exchange_runs_header_rows_array CHECK (jsonb_typeof(header_rows) = 'array'),
  CONSTRAINT one_c_exchange_runs_body_rows_array CHECK (jsonb_typeof(body_rows) = 'array'),
  CONSTRAINT one_c_exchange_runs_tail_rows_array CHECK (
    tail_rows IS NULL OR jsonb_typeof(tail_rows) = 'array'
  ),
  -- The unique key an identical re-upload replays idempotently against: same
  -- file content for the same file kind always resumes (or short-circuits)
  -- the same run instead of starting a duplicate one.
  CONSTRAINT one_c_exchange_runs_kind_checksum_uidx UNIQUE (kind, content_checksum)
);

CREATE INDEX one_c_exchange_runs_status_idx
  ON app.one_c_exchange_runs (kind, status, created_at DESC);

CREATE TRIGGER one_c_exchange_runs_set_updated_at BEFORE UPDATE ON app.one_c_exchange_runs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMENT ON TABLE app.one_c_exchange_runs IS
  'Chunked-import progress for one uploaded CommerceML file. Lets mode=import answer progress and be polled again instead of validating and applying 30-40k rows inside a single transaction.';
COMMENT ON COLUMN app.one_c_exchange_runs.contains_only_changes IS
  'CommerceML СодержитТолькоИзменения. true (or the flag being absent) means a delta: only rows present are touched. false means a full catalog snapshot, where products absent from the file may be deactivated (see tail_rows).';

-- Deterministic article-number normalisation shared by the stored column
-- below and the TypeScript normaliser used at query time
-- (catalog-search-normalize.ts): fold case, fold the Cyrillic letters a
-- careless keyboard swaps in for a visually identical Latin one (СATCH ->
-- CATCH and back — both sides run through the same fold, so it does not
-- matter which script either the stored article or the query happens to use),
-- then drop the punctuation that varies between "W 914/2", "w914-2" and
-- "W914/2". IMMUTABLE so it is usable in a generated column and indexable.
CREATE FUNCTION app.normalize_article(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(
    translate(
      upper(coalesce(value, '')),
      'АВЕКМНОРСТУХ',
      'ABEKMHOPCTYX'
    ),
    '[\s.\-/]+', '', 'g'
  )
$$;

ALTER TABLE app.products
  ADD COLUMN sku_normalized text GENERATED ALWAYS AS (app.normalize_article(sku::text)) STORED;

CREATE INDEX products_sku_normalized_idx ON app.products (sku_normalized text_pattern_ops);

COMMENT ON COLUMN app.products.sku_normalized IS
  'app.normalize_article(sku): case-folded, homoglyph-folded, punctuation-stripped article key. Compared against the same normalisation applied to the search query so "W 914/2", "w914-2" and "W914/2" all match.';
