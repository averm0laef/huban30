-- AN30-013 fix: category assignment for products imported from 1С must not
-- depend on 1С's own grouping being present, resolvable and specific. A real
-- import against staging showed three of four representative products
-- ending up with no usable category at all -- see
-- apps/api/src/one-c-exchange/one-c-exchange.service.ts's module doc for the
-- measured cases and apps/api/src/catalog/catalog-known-categories.ts for
-- the full rule set. Two independent additions:
--
--   1. Seeds the shop's twelve known catalog sections plus an explicit
--      "Без категории" bucket as real, always-present app.categories rows.
--      applyProduct's fallback resolves a product's category to one of
--      these (by slug) whenever 1С's own group is missing, dangling or a
--      junk catch-all name -- see catalog-known-categories.ts's
--      KNOWN_CATALOG_CATEGORIES / UNCATEGORIZED_CATEGORY_SLUG, which this
--      seed data must stay in sync with (slug + label, both directions).
--      The twelve slugs also match `categoryTiles` in
--      apps/web/app/(store)/_components/home-sections.tsx, so once a
--      product actually lands in one of them the home page tile starts
--      resolving to a real category page instead of degrading to a search
--      link -- previously impossible, since a 1С-imported category's slug
--      always carries a hash suffix (see one-c-exchange-slug.ts's
--      buildSlug) and could therefore never equal one of these exactly.
--      external_id is left NULL on every row here (they are not sourced
--      from 1С); app.categories.external_id's uniqueness constraint is a
--      partial index (WHERE external_id IS NOT NULL, see migration 0001) so
--      any number of NULLs coexist safely.
--   2. Adds app.one_c_exchange_runs.rows_uncategorized, counted the same
--      way rows_touched/rows_rejected already are, so a run's owner-facing
--      summary (app.integration_endpoints.last_exchange_summary, see
--      migration 0016) can report how many products this run could not
--      confidently place and filed under "Без категории" instead of
--      guessing.
--
-- Sort order: real 1С categories collectCategories() assigns start at 1 per
-- sibling level (commerce-ml.parser.ts), so a high sort_order here keeps
-- these seeded sections listed after a shop's real merchandised categories
-- by default rather than jumping ahead of them.

INSERT INTO app.categories (external_id, parent_id, name, slug, description, sort_order, is_active)
VALUES
  (NULL, NULL, 'Моторные масла', 'motornye-masla', NULL, 9001, true),
  (NULL, NULL, 'Фильтры', 'filtry', NULL, 9002, true),
  (NULL, NULL, 'Тормозная система', 'tormoznaya-sistema', NULL, 9003, true),
  (NULL, NULL, 'Аккумуляторы', 'akkumulyatory', NULL, 9004, true),
  (NULL, NULL, 'Трансмиссионные масла', 'transmissionnye-masla', NULL, 9005, true),
  (NULL, NULL, 'Антифриз', 'antifriz', NULL, 9006, true),
  (NULL, NULL, 'Автолампы', 'avtolampy', NULL, 9007, true),
  (NULL, NULL, 'Щётки стеклоочистителя', 'shchetki', NULL, 9008, true),
  (NULL, NULL, 'Гидравлическая жидкость', 'gidravlicheskaya-zhidkost', NULL, 9009, true),
  (NULL, NULL, 'Автохимия', 'avtohimiya', NULL, 9010, true),
  (NULL, NULL, 'Инструменты', 'instrumenty', NULL, 9011, true),
  (NULL, NULL, 'Товары для техосмотра', 'tehosmotr', NULL, 9012, true),
  -- The explicit "could not confidently categorise" bucket -- kept active
  -- (not hidden) so a product filed here is still reachable by browsing,
  -- which is the whole point of this fix, and so the owner can find and
  -- re-file it. UNCATEGORIZED_CATEGORY_SLUG/LABEL in
  -- catalog-known-categories.ts must keep matching this row's slug/name.
  (NULL, NULL, 'Без категории', 'bez-kategorii', NULL, 9999, true)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE app.one_c_exchange_runs
  ADD COLUMN rows_uncategorized integer NOT NULL DEFAULT 0 CHECK (rows_uncategorized >= 0);

COMMENT ON COLUMN app.one_c_exchange_runs.rows_uncategorized IS
  'How many product rows this run filed under the "Без категории" bucket (see catalog-known-categories.ts) instead of a confidently determined category. Always 0 for an offers run.';

COMMENT ON COLUMN app.integration_endpoints.last_exchange_summary IS
  'Non-sensitive summary of the last completed 1C exchange run: {kind, filename, containsOnlyChanges, rowsTouched, rowsRejected, rowsUncategorized}. No credentials or personal data.';
