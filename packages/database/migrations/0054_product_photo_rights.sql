-- Where every product photo came from, and how one is taken down (docs/PRODUCT_PHOTOS.md).
--
-- A photo on a product card is someone's copyright (ГК РФ ст. 1259): the shop may show only a photo it made itself,
-- one its own 1С carries, or one a manufacturer or supplier allowed in writing. Until now a photo row said nothing
-- about that, so a claim could not be answered and a photo taken down could come back with the next exchange.
--
-- Additive only: existing rows become 'one_c' (the only way a photo could get in so far), and the exchange, which
-- names no source, keeps writing 'one_c'.

CREATE TYPE app.product_image_source AS ENUM ('one_c', 'own_photo', 'licensed');

-- Who allowed the shop to publish their pictures, and on what paper.
CREATE TABLE app.image_rights_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  basis text NOT NULL CHECK (length(btrim(basis)) BETWEEN 5 AND 1000),
  created_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_reason text
);
CREATE UNIQUE INDEX image_rights_sources_name_uidx ON app.image_rights_sources (lower(btrim(name)));

ALTER TABLE app.product_images
  ADD COLUMN source app.product_image_source NOT NULL DEFAULT 'one_c',
  ADD COLUMN rights_source_id uuid REFERENCES app.image_rights_sources(id) ON DELETE RESTRICT,
  ADD COLUMN uploaded_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  -- The file as staff sent it, before it was reshaped: the same file may also sit in 1С, which sends it untouched.
  ADD COLUMN upload_sha256 bytea CHECK (upload_sha256 IS NULL OR octet_length(upload_sha256) = 32),
  ADD COLUMN upload_byte_size bigint,
  ADD CONSTRAINT product_images_upload_hash_is_whole
    CHECK ((upload_sha256 IS NULL) = (upload_byte_size IS NULL)),
  ADD CONSTRAINT product_images_licensed_names_its_source
    CHECK ((source = 'licensed') = (rights_source_id IS NOT NULL));
CREATE INDEX product_images_rights_source_idx ON app.product_images (rights_source_id) WHERE rights_source_id IS NOT NULL;
CREATE INDEX product_images_source_idx ON app.product_images (source, created_at DESC);

-- Photos taken down, by content. The row outlives the picture: it is the record of what was shown, where it came
-- from, who asked and who removed it, and it keeps the same file from being attached again by any route.
CREATE TABLE app.product_image_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 bytea NOT NULL,
  byte_size bigint NOT NULL,
  upload_sha256 bytea,
  upload_byte_size bigint,
  product_id uuid REFERENCES app.products(id) ON DELETE SET NULL,
  product_external_id text,
  source app.product_image_source NOT NULL,
  rights_source_id uuid REFERENCES app.image_rights_sources(id) ON DELETE SET NULL,
  original_name text,
  published_at timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  withdrawn_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  withdrawn_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX product_image_withdrawals_content_idx ON app.product_image_withdrawals (sha256, byte_size);
CREATE INDEX product_image_withdrawals_upload_idx ON app.product_image_withdrawals (upload_sha256, upload_byte_size)
  WHERE upload_sha256 IS NOT NULL;
CREATE INDEX product_image_withdrawals_time_idx ON app.product_image_withdrawals (withdrawn_at DESC);

-- A withdrawn file is not attached again, whoever tries: the 1С exchange sends the same picture every night until
-- someone removes it in 1С, and it must not undo a takedown. The insert is dropped silently so the exchange goes on.
CREATE FUNCTION app.refuse_withdrawn_product_image() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.storage_objects AS storage
    JOIN app.product_image_withdrawals AS withdrawal
      ON (withdrawal.sha256 = storage.sha256 AND withdrawal.byte_size = storage.byte_size)
      OR (withdrawal.upload_sha256 = storage.sha256 AND withdrawal.upload_byte_size = storage.byte_size)
    WHERE storage.id = NEW.storage_object_id
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER product_images_refuse_withdrawn
  BEFORE INSERT ON app.product_images
  FOR EACH ROW EXECUTE FUNCTION app.refuse_withdrawn_product_image();
