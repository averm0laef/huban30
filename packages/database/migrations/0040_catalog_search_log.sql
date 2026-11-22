-- Search log for the staff dashboard («Интенсивность поиска», «Ищут, но
-- не находят»). One row per first-page catalog search: the cleaned text
-- (apps/api dashboard-logic searchLogQuery: lower case, no phones or
-- e-mails, a VIN reduced to its manufacturer code) and how many products
-- came back. No user, IP or session is stored. Rows older than 180 days are
-- removed by apps/api CatalogSearchLogService as it writes.

CREATE TABLE app.catalog_search_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query text NOT NULL CHECK (char_length(query) BETWEEN 2 AND 120),
  result_count integer NOT NULL CHECK (result_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX catalog_search_log_created_idx ON app.catalog_search_log (created_at);
CREATE INDEX catalog_search_log_zero_idx ON app.catalog_search_log (created_at, query) WHERE result_count = 0;

COMMENT ON TABLE app.catalog_search_log IS
  'Anonymous catalog search log for the staff dashboard. Cleaned query text and result count only; kept 180 days.';
