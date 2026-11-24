-- UMAPI analogs feed the shop's own cross base (owner's decision of 24.11.2026, docs/UMAPI_INTEGRATION.md
-- section 10): every analog answer a visitor's press brings is kept as pairs «the part ↔ each analog», source
-- 'umapi', unconfirmed. A pair Rossko (or 1С, FAPI, staff) also asserts with both brands known is confirmed by
-- app.article_cross_merged_status — two independent sources agreeing; only confirmed pairs widen the search.
-- TecDoc is not a source here and never may be (docs/TECDOC.md).

ALTER TABLE app.article_crosses DROP CONSTRAINT article_crosses_source_check;
ALTER TABLE app.article_crosses
  ADD CONSTRAINT article_crosses_source_check CHECK (source IN ('rossko', 'one_c', 'manual', 'fapi', 'umapi'));
