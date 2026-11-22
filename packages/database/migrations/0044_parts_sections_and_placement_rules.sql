-- The shop's own catalogue grows beyond the first twelve sections: parts
-- sections for the full 1С assortment (packages/contracts
-- storefront-taxonomy.ts; rows are generated from that file, keep them in
-- step). It is the shop's own hand-written classification, independent of any
-- external parts catalogue.

INSERT INTO app.categories (external_id, parent_id, name, slug, description, sort_order, is_active)
VALUES
  (NULL, NULL, 'Подвеска', 'podveska', NULL, 9013, true),
  (NULL, NULL, 'Рулевое управление', 'rulevoe-upravlenie', NULL, 9014, true),
  (NULL, NULL, 'Двигатель', 'dvigatel', NULL, 9015, true),
  (NULL, NULL, 'Система зажигания', 'zazhiganie', NULL, 9016, true),
  (NULL, NULL, 'Охлаждение и отопление', 'ohlazhdenie', NULL, 9017, true),
  (NULL, NULL, 'Сцепление и привод', 'transmissiya', NULL, 9018, true),
  (NULL, NULL, 'Электрооборудование', 'elektrika', NULL, 9019, true),
  (NULL, NULL, 'Топливная система', 'toplivnaya-sistema', NULL, 9020, true),
  (NULL, NULL, 'Выхлопная система', 'vyhlopnaya-sistema', NULL, 9021, true),
  (NULL, NULL, 'Кузов и оптика', 'kuzov-i-optika', NULL, 9022, true),
  (NULL, NULL, 'Крепёж', 'krepezh', NULL, 9023, true),
  (NULL, NULL, 'Аксессуары', 'aksessuary', NULL, 9024, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.categories (external_id, parent_id, name, slug, description, sort_order, is_active)
SELECT NULL, parent.id, seed.name, seed.slug, NULL, seed.sort_order, true
FROM (VALUES
  ('podveska', 'amortizatory', 'Амортизаторы и стойки', 1),
  ('podveska', 'pruzhiny', 'Пружины', 2),
  ('podveska', 'rychagi', 'Рычаги и тяги', 3),
  ('podveska', 'sharovye-opory', 'Шаровые опоры', 4),
  ('podveska', 'saylentbloki', 'Сайлентблоки и втулки', 5),
  ('podveska', 'stabilizator', 'Стойки и втулки стабилизатора', 6),
  ('podveska', 'stupitsy-i-podshipniki', 'Ступицы и подшипники', 7),
  ('podveska', 'opory-i-pylniki', 'Опоры, пыльники, отбойники', 8),
  ('rulevoe-upravlenie', 'rulevye-nakonechniki', 'Рулевые наконечники', 1),
  ('rulevoe-upravlenie', 'rulevye-tyagi', 'Рулевые тяги', 2),
  ('rulevoe-upravlenie', 'rulevye-reyki-i-gur', 'Рейки и насосы ГУР', 3),
  ('dvigatel', 'remni', 'Ремни', 1),
  ('dvigatel', 'roliki-i-natyazhiteli', 'Ролики и натяжители', 2),
  ('dvigatel', 'grm', 'Комплекты и цепи ГРМ', 3),
  ('dvigatel', 'prokladki-i-salniki', 'Прокладки и сальники', 4),
  ('dvigatel', 'opory-dvigatelya', 'Опоры двигателя', 5),
  ('dvigatel', 'porshnevaya-i-klapany', 'Поршневая и клапаны', 6),
  ('zazhiganie', 'svechi-zazhiganiya', 'Свечи зажигания', 1),
  ('zazhiganie', 'svechi-nakala', 'Свечи накаливания', 2),
  ('zazhiganie', 'katushki-zazhiganiya', 'Катушки зажигания', 3),
  ('zazhiganie', 'vysokovoltnye-provoda', 'Высоковольтные провода', 4),
  ('ohlazhdenie', 'radiatory', 'Радиаторы', 1),
  ('ohlazhdenie', 'termostaty', 'Термостаты', 2),
  ('ohlazhdenie', 'vodyanye-nasosy', 'Водяные насосы', 3),
  ('ohlazhdenie', 'patrubki-i-shlangi', 'Патрубки и шланги', 4),
  ('ohlazhdenie', 'ventilyatory', 'Вентиляторы и моторы отопителя', 5),
  ('transmissiya', 'stseplenie', 'Сцепление', 1),
  ('transmissiya', 'shrusy-i-privody', 'ШРУСы и приводы', 2),
  ('transmissiya', 'pylniki-shrus', 'Пыльники ШРУС', 3),
  ('transmissiya', 'krestoviny-i-podshipniki', 'Крестовины и подшипники', 4),
  ('elektrika', 'generatory-i-startery', 'Генераторы и стартеры', 1),
  ('elektrika', 'datchiki', 'Датчики', 2),
  ('elektrika', 'predohraniteli-i-rele', 'Предохранители и реле', 3),
  ('elektrika', 'vyklyuchateli-i-provodka', 'Выключатели и проводка', 4),
  ('toplivnaya-sistema', 'toplivnye-nasosy', 'Топливные насосы', 1),
  ('toplivnaya-sistema', 'forsunki', 'Форсунки', 2),
  ('vyhlopnaya-sistema', 'glushiteli', 'Глушители и резонаторы', 1),
  ('vyhlopnaya-sistema', 'gofry-i-krepleniya', 'Гофры и крепления', 2),
  ('kuzov-i-optika', 'fary-i-fonari', 'Фары и фонари', 1),
  ('kuzov-i-optika', 'zerkala', 'Зеркала', 2),
  ('kuzov-i-optika', 'bryzgoviki-i-podkrylki', 'Брызговики и подкрылки', 3),
  ('kuzov-i-optika', 'gazovye-upory', 'Газовые упоры', 4),
  ('krepezh', 'bolty-i-gayki', 'Болты, гайки, шпильки', 1),
  ('krepezh', 'homuty', 'Хомуты', 2),
  ('krepezh', 'klipsy', 'Клипсы и пистоны', 3),
  ('aksessuary', 'kovriki', 'Коврики', 1),
  ('aksessuary', 'chehly', 'Чехлы и накидки', 2),
  ('aksessuary', 'kompressory', 'Компрессоры и насосы', 3),
  ('aksessuary', 'aromatizatory', 'Ароматизаторы', 4)
) AS seed(parent_slug, slug, name, sort_order)
JOIN app.categories AS parent ON parent.slug = seed.parent_slug AND parent.external_id IS NULL
ON CONFLICT (slug) DO NOTHING;

-- Staff rules that sort products the built-in dictionary does not know:
-- «название начинается со слова …», optionally a brand and an article
-- prefix → a section. Checked before everything else, most specific first.
CREATE TABLE app.catalog_placement_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The noun the product name leads with, lower case («хомут»); matched as a word start.
  head_stem text CHECK (head_stem IS NULL OR head_stem ~ '^[a-zа-я0-9]{2,40}$'),
  -- Further word starts that must all be present in the name.
  name_stems text[] NOT NULL DEFAULT '{}',
  -- app.normalize_brand form; NULL = any brand.
  brand_key text CHECK (brand_key IS NULL OR brand_key <> ''),
  -- Normalised article prefix (app.normalize_article form); NULL = any article.
  sku_prefix text CHECK (sku_prefix IS NULL OR sku_prefix ~ '^[A-Z0-9]{1,32}$'),
  category_id uuid NOT NULL REFERENCES app.categories(id) ON DELETE CASCADE,
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalog_placement_rules_condition CHECK (
    head_stem IS NOT NULL OR brand_key IS NOT NULL OR sku_prefix IS NOT NULL OR cardinality(name_stems) > 0
  )
);
CREATE INDEX catalog_placement_rules_category_idx ON app.catalog_placement_rules (category_id);
CREATE INDEX catalog_placement_rules_created_by_idx ON app.catalog_placement_rules (created_by) WHERE created_by IS NOT NULL;

-- A section a staff member chose for one product by hand: imports and
-- re-sorting leave it where it was put.
ALTER TABLE app.products ADD COLUMN category_pinned boolean NOT NULL DEFAULT false;
