-- Four gaps of the catalogue tree, found on the owner's 1С base (42,723
-- items): about 750 hoses, fittings and hydraulic lines, 45 parking heaters
-- and their parts, 25 engine pre-heaters, 34 engine blankets and 40 garden
-- machines had no shelf and sat in «Без категории»
-- (packages/contracts storefront-taxonomy.ts; rows are generated from that
-- file, keep them in step). The tree is the shop's own hand-written
-- classification.
--
-- Slugs of existing rows never change: they are public URLs.

INSERT INTO app.categories (external_id, parent_id, name, slug, description, sort_order, is_active)
VALUES
  (NULL, NULL, 'Шланги, фитинги, РВД', 'shlangi-i-fitingi', NULL, 9025, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.categories (external_id, parent_id, name, slug, description, sort_order, is_active)
SELECT NULL, parent.id, seed.name, seed.slug, NULL, seed.sort_order, true
FROM (VALUES
  ('shlangi-i-fitingi', 'fitingi-pvh', 'Фитинги для трубок ПВХ', 1),
  ('shlangi-i-fitingi', 'fitingi-metallicheskie', 'Фитинги, штуцеры, угольники', 2),
  ('shlangi-i-fitingi', 'soediniteli-shlangov', 'Соединители и переходники шлангов', 3),
  ('shlangi-i-fitingi', 'trubki-i-shlangi-na-metrazh', 'Трубки и шланги на метраж', 4),
  ('shlangi-i-fitingi', 'rvd', 'РВД, рукава и муфты', 5),
  ('shlangi-i-fitingi', 'bystrosemy', 'Быстросъёмы и пневморазъёмы', 6),
  ('ohlazhdenie', 'avtonomnye-otopiteli', 'Автономные отопители', 9),
  ('ohlazhdenie', 'podogrevateli-dvigatelya', 'Подогреватели двигателя', 10),
  ('ohlazhdenie', 'utepliteli-dvigatelya', 'Утеплители двигателя', 11),
  ('moto-i-sadovaya-tehnika', 'sadovaya-tehnika', 'Садовая техника', 4)
) AS seed(parent_slug, slug, name, sort_order)
JOIN app.categories AS parent ON parent.slug = seed.parent_slug AND parent.external_id IS NULL
ON CONFLICT (slug) DO NOTHING;

-- The new section stands after «Крепёж» in the catalogue menu.
UPDATE app.categories AS category SET sort_order = seed.sort_order, updated_at = clock_timestamp()
FROM (VALUES
  ('tehosmotr', 9026),
  ('moto-i-sadovaya-tehnika', 9027)
) AS seed(slug, sort_order)
WHERE category.slug = seed.slug AND category.external_id IS NULL AND category.parent_id IS NULL
  AND category.sort_order <> seed.sort_order;
