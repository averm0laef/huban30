-- One storefront section tree; 1С groups are mapped into it.
--
-- 1. Seeds every subsection of packages/contracts/src/storefront-taxonomy.ts
--    (STOREFRONT_TAXONOMY) under its top-level section from migration 0024.
--    Rows are generated from that file; keep them in step if it changes.
-- 2. 1С groups (Классификатор/Группы) no longer become public categories.
--    They are kept per base in app.one_c_group_mappings with an optional
--    staff override (category_id); products remember their 1С group in
--    app.products.one_c_group_external_id for reference and re-sorting.
-- 3. Backfills both from the categories earlier exchanges created from 1С
--    groups (external_id IS NOT NULL), so re-sorting existing products can
--    still use their 1С group names. Nothing is deleted.

INSERT INTO app.categories (external_id, parent_id, name, slug, description, sort_order, is_active)
SELECT NULL, parent.id, seed.name, seed.slug, NULL, seed.sort_order, true
FROM (VALUES
  ('motornye-masla', 'sinteticheskie-motornye-masla', 'Синтетические', 1),
  ('motornye-masla', 'polusinteticheskie-motornye-masla', 'Полусинтетические', 2),
  ('motornye-masla', 'mineralnye-motornye-masla', 'Минеральные', 3),
  ('motornye-masla', 'masla-dlya-moto-i-sadovoy-tekhniki', 'Для мото- и садовой техники', 4),
  ('filtry', 'maslyanye-filtry', 'Масляные', 1),
  ('filtry', 'vozdushnye-filtry', 'Воздушные', 2),
  ('filtry', 'salonnye-filtry', 'Салонные', 3),
  ('filtry', 'toplivnye-filtry', 'Топливные', 4),
  ('tormoznaya-sistema', 'tormoznye-kolodki', 'Тормозные колодки', 1),
  ('tormoznaya-sistema', 'tormoznye-diski', 'Тормозные диски', 2),
  ('tormoznaya-sistema', 'tormoznye-barabany', 'Тормозные барабаны', 3),
  ('tormoznaya-sistema', 'tormoznaya-zhidkost', 'Тормозная жидкость', 4),
  ('tormoznaya-sistema', 'supporty-i-remkomplekty', 'Суппорты и ремкомплекты', 5),
  ('akkumulyatory', 'akkumulyatory-legkovye', 'Для легковых', 1),
  ('akkumulyatory', 'akkumulyatory-gruzovye', 'Для грузовых', 2),
  ('akkumulyatory', 'akkumulyatory-moto', 'Мото', 3),
  ('akkumulyatory', 'zaryadnye-ustroystva', 'Зарядные устройства', 4),
  ('akkumulyatory', 'provoda-i-klemmy', 'Провода и клеммы', 5),
  ('transmissionnye-masla', 'masla-dlya-mkpp', 'Для МКПП и мостов', 1),
  ('transmissionnye-masla', 'masla-dlya-akpp', 'Для АКПП (ATF)', 2),
  ('transmissionnye-masla', 'masla-dlya-variatora', 'Для вариатора (CVT)', 3),
  ('antifriz', 'antifriz-gotovyy', 'Готовый к применению', 1),
  ('antifriz', 'antifriz-kontsentrat', 'Концентраты', 2),
  ('antifriz', 'distillirovannaya-voda', 'Дистиллированная вода', 3),
  ('avtolampy', 'galogennye-lampy', 'Галогенные', 1),
  ('avtolampy', 'ksenonovye-lampy', 'Ксеноновые', 2),
  ('avtolampy', 'svetodiodnye-lampy', 'Светодиодные', 3),
  ('avtolampy', 'signalnye-lampy', 'Сигнальные и габаритные', 4),
  ('shchetki', 'shchetki-karkasnye', 'Каркасные', 1),
  ('shchetki', 'shchetki-beskarkasnye', 'Бескаркасные', 2),
  ('shchetki', 'shchetki-gibridnye', 'Гибридные', 3),
  ('shchetki', 'shchetki-zadnie', 'Задние', 4),
  ('gidravlicheskaya-zhidkost', 'zhidkosti-gur', 'Для ГУР', 1),
  ('gidravlicheskaya-zhidkost', 'gidravlicheskie-masla', 'Гидравлические масла', 2),
  ('avtohimiya', 'dlya-kuzova-i-stekol', 'Для кузова и стёкол', 1),
  ('avtohimiya', 'dlya-salona', 'Для салона', 2),
  ('avtohimiya', 'dlya-moyki', 'Для мойки', 3),
  ('avtohimiya', 'dlya-shin-i-diskov', 'Для шин и дисков', 4),
  ('avtohimiya', 'zhidkost-omyvatelya', 'Жидкость омывателя', 5),
  ('avtohimiya', 'prisadki', 'Присадки', 6),
  ('avtohimiya', 'smazki', 'Смазки', 7),
  ('avtohimiya', 'dlya-remonta', 'Для ремонта', 8),
  ('instrumenty', 'klyuchi-i-golovki', 'Ключи и головки', 1),
  ('instrumenty', 'nabory-instrumentov', 'Наборы инструментов', 2),
  ('instrumenty', 'domkraty', 'Домкраты и подставки', 3),
  ('instrumenty', 'semniki', 'Съёмники', 4),
  ('instrumenty', 'diagnostika', 'Диагностика и измерения', 5),
  ('tehosmotr', 'aptechki', 'Аптечки', 1),
  ('tehosmotr', 'ognetushiteli', 'Огнетушители', 2),
  ('tehosmotr', 'znaki-avariynoy-ostanovki', 'Знаки аварийной остановки', 3),
  ('tehosmotr', 'zhilety-i-buksirnye-trosy', 'Жилеты и буксировочные тросы', 4)
) AS seed(parent_slug, slug, name, sort_order)
JOIN app.categories AS parent ON parent.slug = seed.parent_slug AND parent.external_id IS NULL
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE app.one_c_group_mappings (
  source_key text NOT NULL REFERENCES app.integration_endpoints(integration_key),
  group_external_id text NOT NULL,
  group_name text NOT NULL,
  parent_group_external_id text,
  is_active boolean NOT NULL DEFAULT true,
  -- Staff override: the storefront section this 1С group goes to. NULL means
  -- automatic (the group's name, then the product's name decide).
  category_id uuid REFERENCES app.categories(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_key, group_external_id)
);
CREATE INDEX one_c_group_mappings_category_idx ON app.one_c_group_mappings (category_id)
  WHERE category_id IS NOT NULL;
CREATE TRIGGER one_c_group_mappings_set_updated_at BEFORE UPDATE ON app.one_c_group_mappings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.products ADD COLUMN one_c_group_external_id text;
CREATE INDEX products_one_c_group_idx ON app.products (one_c_source, one_c_group_external_id)
  WHERE one_c_group_external_id IS NOT NULL;

INSERT INTO app.one_c_group_mappings (source_key, group_external_id, group_name, parent_group_external_id, is_active)
SELECT CASE WHEN category.external_id LIKE '1c-secondary:%' THEN 'one_c_secondary' ELSE 'one_c' END,
       category.external_id, category.name, parent.external_id,
       category.is_active AND category.deleted_at IS NULL
FROM app.categories AS category
LEFT JOIN app.categories AS parent ON parent.id = category.parent_id
WHERE category.external_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE app.products AS product
SET one_c_group_external_id = category.external_id
FROM app.categories AS category
WHERE category.id = product.category_id AND category.external_id IS NOT NULL
  AND product.one_c_group_external_id IS NULL;

COMMENT ON TABLE app.one_c_group_mappings IS
  '1С groups of each base and the storefront section they map to. category_id NULL = automatic by name.';
COMMENT ON COLUMN app.products.one_c_group_external_id IS
  'The 1С group (Классификатор/Группы Ид, namespaced for the secondary base) the product came in; reference only, the public section is category_id.';
