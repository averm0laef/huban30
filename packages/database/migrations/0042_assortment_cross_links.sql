-- How a customer's number reaches our product (docs/CATALOG_MATCHING.md):
--  1. one identity per brand: «MANN» in 1С and «MANN-FILTER» in a supplier
--     catalogue are the same brand, and Toyota and Lexus share OE numbers;
--  2. every product of ours is linked ahead of time to its OE numbers,
--     replacements and analogs (apps/api PartsFinderAssortmentService);
--     parts_finder_product_links remembers which products were looked up;
--  3. the shop lookup walks app.article_crosses one step from the requested
--     number, or two steps through a shared vehicle-maker (OE) number;
--  4. a pair only one source asserted is shown as a «возможный аналог» until
--     a second source or a staff member confirms it; a rejected pair is
--     never shown again.

CREATE TABLE app.brand_identities (
  alias text PRIMARY KEY CHECK (alias = app.normalize_brand(alias)),
  canonical text NOT NULL CHECK (canonical <> ''),
  is_vehicle_make boolean NOT NULL DEFAULT false
);
CREATE INDEX brand_identities_canonical_idx ON app.brand_identities (canonical);

INSERT INTO app.brand_identities (alias, canonical, is_vehicle_make) VALUES
  ('TOYOTA', 'TOYOTA', true),
  ('LEXUS', 'TOYOTA', true),
  ('TOYOTA/LEXUS', 'TOYOTA', true),
  ('ТОЙОТА', 'TOYOTA', true),
  ('ТОЙОТА/ЛЕКСУС', 'TOYOTA', true),
  ('ЛЕКСУС', 'TOYOTA', true),
  ('NISSAN', 'NISSAN', true),
  ('INFINITI', 'NISSAN', true),
  ('NISSAN/INFINITI', 'NISSAN', true),
  ('НИССАН', 'NISSAN', true),
  ('ИНФИНИТИ', 'NISSAN', true),
  ('HONDA', 'HONDA', true),
  ('ACURA', 'HONDA', true),
  ('HONDA/ACURA', 'HONDA', true),
  ('ХОНДА', 'HONDA', true),
  ('АКУРА', 'HONDA', true),
  ('MITSUBISHI', 'MITSUBISHI', true),
  ('MMC', 'MITSUBISHI', true),
  ('МИТСУБИСИ', 'MITSUBISHI', true),
  ('МИЦУБИСИ', 'MITSUBISHI', true),
  ('МИТСУБИШИ', 'MITSUBISHI', true),
  ('MAZDA', 'MAZDA', true),
  ('МАЗДА', 'MAZDA', true),
  ('SUBARU', 'SUBARU', true),
  ('СУБАРУ', 'SUBARU', true),
  ('SUZUKI', 'SUZUKI', true),
  ('СУЗУКИ', 'SUZUKI', true),
  ('DAIHATSU', 'DAIHATSU', true),
  ('ДАЙХАТСУ', 'DAIHATSU', true),
  ('ISUZU', 'ISUZU', true),
  ('ИСУЗУ', 'ISUZU', true),
  ('HYUNDAIKIA', 'HYUNDAIKIA', true),
  ('HYUNDAI', 'HYUNDAIKIA', true),
  ('KIA', 'HYUNDAIKIA', true),
  ('HYUNDAI/KIA', 'HYUNDAIKIA', true),
  ('KIA/HYUNDAI', 'HYUNDAIKIA', true),
  ('MOBIS', 'HYUNDAIKIA', true),
  ('HYUNDAIMOBIS', 'HYUNDAIKIA', true),
  ('ХЕНДАЙ', 'HYUNDAIKIA', true),
  ('ХУНДАЙ', 'HYUNDAIKIA', true),
  ('ХЁНДАЙ', 'HYUNDAIKIA', true),
  ('КИА', 'HYUNDAIKIA', true),
  ('ХЕНДАЙ/КИА', 'HYUNDAIKIA', true),
  ('VAG', 'VAG', true),
  ('VW', 'VAG', true),
  ('VOLKSWAGEN', 'VAG', true),
  ('AUDI', 'VAG', true),
  ('SKODA', 'VAG', true),
  ('ŠKODA', 'VAG', true),
  ('SEAT', 'VAG', true),
  ('VW/AUDI', 'VAG', true),
  ('AUDI/VW', 'VAG', true),
  ('ФОЛЬКСВАГЕН', 'VAG', true),
  ('АУДИ', 'VAG', true),
  ('ШКОДА', 'VAG', true),
  ('BMW', 'BMW', true),
  ('MINI', 'BMW', true),
  ('BMW/MINI', 'BMW', true),
  ('БМВ', 'BMW', true),
  ('MERCEDESBENZ', 'MERCEDESBENZ', true),
  ('MERCEDES', 'MERCEDESBENZ', true),
  ('MB', 'MERCEDESBENZ', true),
  ('DAIMLER', 'MERCEDESBENZ', true),
  ('МЕРСЕДЕС', 'MERCEDESBENZ', true),
  ('МЕРСЕДЕСБЕНЦ', 'MERCEDESBENZ', true),
  ('GM', 'GM', true),
  ('GENERALMOTORS', 'GM', true),
  ('OPEL', 'GM', true),
  ('CHEVROLET', 'GM', true),
  ('DAEWOO', 'GM', true),
  ('VAUXHALL', 'GM', true),
  ('GM/OPEL', 'GM', true),
  ('OPEL/GM', 'GM', true),
  ('ОПЕЛЬ', 'GM', true),
  ('ШЕВРОЛЕ', 'GM', true),
  ('ДЭУ', 'GM', true),
  ('FORD', 'FORD', true),
  ('ФОРД', 'FORD', true),
  ('RENAULT', 'RENAULT', true),
  ('DACIA', 'RENAULT', true),
  ('RENAULT/DACIA', 'RENAULT', true),
  ('РЕНО', 'RENAULT', true),
  ('PSA', 'PSA', true),
  ('PEUGEOT', 'PSA', true),
  ('CITROEN', 'PSA', true),
  ('CITROËN', 'PSA', true),
  ('PEUGEOT/CITROEN', 'PSA', true),
  ('CITROEN/PEUGEOT', 'PSA', true),
  ('ПЕЖО', 'PSA', true),
  ('СИТРОЕН', 'PSA', true),
  ('FIAT', 'FIAT', true),
  ('LANCIA', 'FIAT', true),
  ('ALFAROMEO', 'FIAT', true),
  ('ФИАТ', 'FIAT', true),
  ('VOLVO', 'VOLVO', true),
  ('ВОЛЬВО', 'VOLVO', true),
  ('LANDROVER', 'LANDROVER', true),
  ('JAGUAR', 'JAGUAR', true),
  ('PORSCHE', 'PORSCHE', true),
  ('CHRYSLER', 'CHRYSLER', true),
  ('DODGE', 'CHRYSLER', true),
  ('JEEP', 'CHRYSLER', true),
  ('MOPAR', 'CHRYSLER', true),
  ('SSANGYONG', 'SSANGYONG', true),
  ('KGM', 'SSANGYONG', true),
  ('LADA', 'LADA', true),
  ('ВАЗ', 'LADA', true),
  ('VAZ', 'LADA', true),
  ('АВТОВАЗ', 'LADA', true),
  ('AVTOVAZ', 'LADA', true),
  ('ЛАДА', 'LADA', true),
  ('UAZ', 'UAZ', true),
  ('УАЗ', 'UAZ', true),
  ('GAZ', 'GAZ', true),
  ('ГАЗ', 'GAZ', true),
  ('CHERY', 'CHERY', true),
  ('EXEED', 'CHERY', true),
  ('OMODA', 'CHERY', true),
  ('JAECOO', 'CHERY', true),
  ('ЧЕРИ', 'CHERY', true),
  ('GEELY', 'GEELY', true),
  ('ДЖИЛИ', 'GEELY', true),
  ('HAVAL', 'HAVAL', true),
  ('GREATWALL', 'HAVAL', true),
  ('GWM', 'HAVAL', true),
  ('ХАВАЛ', 'HAVAL', true),
  ('CHANGAN', 'CHANGAN', true),
  ('LIFAN', 'LIFAN', true),
  ('BYD', 'BYD', true),
  ('FAW', 'FAW', true),
  ('DONGFENG', 'DONGFENG', true),
  ('JAC', 'JAC', true),
  ('GAC', 'GAC', true),
  ('MANN', 'MANN', false),
  ('MANNFILTER', 'MANN', false),
  ('MANNHUMMEL', 'MANN', false),
  ('МАНН', 'MANN', false),
  ('МАННФИЛЬТР', 'MANN', false),
  ('MAHLE', 'MAHLE', false),
  ('MAHLEORIGINAL', 'MAHLE', false),
  ('KNECHT', 'MAHLE', false),
  ('MAHLE/KNECHT', 'MAHLE', false),
  ('KNECHT/MAHLE', 'MAHLE', false),
  ('МАХЛЕ', 'MAHLE', false),
  ('FEBI', 'FEBI', false),
  ('FEBIBILSTEIN', 'FEBI', false),
  ('ФЕБИ', 'FEBI', false),
  ('KYB', 'KYB', false),
  ('KAYABA', 'KYB', false),
  ('КАЯБА', 'KYB', false),
  ('LEMFORDER', 'LEMFORDER', false),
  ('LEMFÖRDER', 'LEMFORDER', false),
  ('BOSCH', 'BOSCH', false),
  ('ROBERTBOSCH', 'BOSCH', false),
  ('БОШ', 'BOSCH', false),
  ('CONTITECH', 'CONTITECH', false),
  ('CONTINENTAL', 'CONTITECH', false),
  ('DENSO', 'DENSO', false),
  ('NIPPONDENSO', 'DENSO', false),
  ('ДЕНСО', 'DENSO', false),
  ('SANGSIN', 'SANGSIN', false),
  ('SANGSINBRAKE', 'SANGSIN', false),
  ('SAKURA', 'SAKURA', false),
  ('SAKURAFILTER', 'SAKURA', false),
  ('LYNX', 'LYNX', false),
  ('LYNXAUTO', 'LYNX', false),
  ('555', '555', false),
  ('SANKEI555', '555', false),
  ('SANKEI', '555', false),
  ('LUKOIL', 'LUKOIL', false),
  ('ЛУКОЙЛ', 'LUKOIL', false),
  ('LIQUIMOLY', 'LIQUIMOLY', false),
  ('ЛИКВИМОЛИ', 'LIQUIMOLY', false);

-- STABLE (reads the table): for comparisons, never for an index expression.
CREATE FUNCTION app.canonical_brand(value text) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $function$
  SELECT COALESCE(
    (SELECT identity.canonical FROM app.brand_identities AS identity WHERE identity.alias = app.normalize_brand(value)),
    app.normalize_brand(value))
$function$;

CREATE FUNCTION app.is_vehicle_make(brand_key text) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $function$
  SELECT EXISTS (SELECT 1 FROM app.brand_identities AS identity
    WHERE identity.alias = app.normalize_brand(brand_key) AND identity.is_vehicle_make)
$function$;

CREATE TABLE app.parts_finder_product_links (
  product_id uuid PRIMARY KEY REFERENCES app.products(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('linked', 'no_data', 'brand_mismatch')),
  crosses integer NOT NULL DEFAULT 0 CHECK (crosses >= 0),
  -- What the catalogue calls the brands of this number when ours is not among them.
  note text,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX parts_finder_product_links_checked_idx ON app.parts_finder_product_links (checked_at);

-- The second side of a pair is read for every status now, not only confirmed.
CREATE INDEX article_crosses_article_b_idx ON app.article_crosses (article_b, brand_b);

-- Which sources asserted a pair. Two independent sources agreeing on a
-- brand-qualified pair (FAPI analogs and the supplier's cross table) confirm
-- it without a staff click; one source alone stays presumptive.
ALTER TABLE app.article_crosses ADD COLUMN evidence text[] NOT NULL DEFAULT '{}';
UPDATE app.article_crosses SET evidence = ARRAY[source];

-- What the pair says. 'oe_a' / 'oe_b': that side is the vehicle maker's own
-- number for the other part -- the only pairs followed for a second step.
-- 'replacement': one number superseded the other. 'analog': two aftermarket
-- parts are interchangeable. NULL when not classified.
ALTER TABLE app.article_crosses
  ADD COLUMN relation text CHECK (relation IN ('oe_a', 'oe_b', 'replacement', 'analog'));

-- A staff member may reject a pair for good.
ALTER TABLE app.article_crosses DROP CONSTRAINT article_crosses_status_check;
ALTER TABLE app.article_crosses
  ADD CONSTRAINT article_crosses_status_check CHECK (status IN ('confirmed', 'unconfirmed', 'rejected'));
ALTER TABLE app.article_crosses ADD COLUMN rejected_by uuid REFERENCES app.users(id) ON DELETE SET NULL;
CREATE INDEX article_crosses_rejected_by_idx ON app.article_crosses (rejected_by) WHERE rejected_by IS NOT NULL;

-- One rule for every writer (apps/api PartsFinderCrossStore, apps/worker
-- article-cross-ingest). A staff decision is final; a trusted sighting
-- confirms; a second, different source confirms a pair whose both brands are
-- known; otherwise the pair stays as it was.
CREATE FUNCTION app.article_cross_merged_status(
  old_status text, old_evidence text[], brand_a text, brand_b text, new_status text, new_source text
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT CASE
    WHEN old_status IN ('rejected', 'confirmed') THEN old_status
    WHEN new_status = 'confirmed' THEN 'confirmed'
    WHEN NOT new_source = ANY(old_evidence) AND cardinality(old_evidence) >= 1 AND brand_a <> '' AND brand_b <> '' THEN 'confirmed'
    ELSE old_status
  END
$function$;

-- What a pair says, from the brands of its two sides (see `relation` above).
CREATE FUNCTION app.article_cross_relation(brand_a text, brand_b text) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $function$
  SELECT CASE
    WHEN app.is_vehicle_make(brand_a) AND NOT app.is_vehicle_make(brand_b) THEN 'oe_a'
    WHEN app.is_vehicle_make(brand_b) AND NOT app.is_vehicle_make(brand_a) THEN 'oe_b'
    WHEN app.is_vehicle_make(brand_a) AND app.is_vehicle_make(brand_b) THEN 'replacement'
    ELSE 'analog'
  END
$function$;

UPDATE app.article_crosses SET relation = app.article_cross_relation(brand_a, brand_b);
