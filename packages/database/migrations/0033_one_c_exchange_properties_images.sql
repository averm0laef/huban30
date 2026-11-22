-- 1C property definitions and product photos for the CommerceML exchange.
--
-- A goods file of a split 1C export can arrive without
-- <Классификатор><Свойства>; the definitions (property id -> name and
-- reference value id -> text) from an earlier file of the same information
-- base are kept here so brands and car makes given as properties still
-- resolve to text instead of GUIDs. Per base: two databases never share it.
ALTER TABLE app.integration_endpoints
  ADD COLUMN one_c_property_dictionary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT integration_endpoints_property_dictionary_object
    CHECK (jsonb_typeof(one_c_property_dictionary) = 'object');

-- <Картинка> files uploaded with mode=file are attached in a separate,
-- resumable 'images' phase after the products, a few per poll, because each
-- one is malware-scanned and probed before it can become public.
ALTER TABLE app.one_c_exchange_runs
  ADD COLUMN images_attached integer NOT NULL DEFAULT 0 CHECK (images_attached >= 0),
  ADD COLUMN images_skipped integer NOT NULL DEFAULT 0 CHECK (images_skipped >= 0),
  DROP CONSTRAINT one_c_exchange_runs_phase_check,
  ADD CONSTRAINT one_c_exchange_runs_phase_check
    CHECK (phase IN ('header', 'body', 'tail', 'images', 'done'));

COMMENT ON COLUMN app.integration_endpoints.one_c_property_dictionary IS
  'Last known 1C Классификатор/Свойства of this base: {propertyId: {name, values: {valueId: text}}}. Catalog metadata only, no credentials.';
