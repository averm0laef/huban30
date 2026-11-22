-- FAPI part cards (oe, analogs, replaced_by, replaces) feed the shop's own
-- cross table, so every paid lookup grows the base that catalog search and
-- the parts finder read for free afterwards (apps/api parts-finder
-- PartsFinderCrossStore). Only manufacturer numbers, replacements and
-- manufacturer-verified analogs arrive confirmed; other analogs stay
-- 'unconfirmed' for staff review, as with supplier crosses.

ALTER TABLE app.article_crosses DROP CONSTRAINT article_crosses_source_check;
ALTER TABLE app.article_crosses
  ADD CONSTRAINT article_crosses_source_check CHECK (source IN ('rossko', 'one_c', 'manual', 'fapi'));
