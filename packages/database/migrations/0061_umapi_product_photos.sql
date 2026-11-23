-- Internal 1С preparation. Public galleries never serve these links or files.
CREATE TABLE app.umapi_product_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  product_sku text NOT NULL,
  product_brand text NOT NULL,
  catalogue_article_id integer NOT NULL CHECK (catalogue_article_id > 0),
  catalogue_article text NOT NULL,
  catalogue_brand text NOT NULL,
  media_url text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  saved_at timestamptz,
  jpeg bytea CHECK (octet_length(jpeg) BETWEEN 1 AND 4194304),
  UNIQUE (product_id, product_sku, product_brand, catalogue_article_id, media_url),
  CHECK ((jpeg IS NULL) = (saved_at IS NULL))
);
CREATE INDEX umapi_product_photos_seen_idx ON app.umapi_product_photos (seen_at DESC, id);

-- The downloaded JPEG is for 1С's internal record. If the same file returns
-- in a commerce exchange or as a manual upload, it must stay out of the
-- public photo table.
CREATE INDEX umapi_product_photos_jpeg_sha_idx
  ON app.umapi_product_photos (digest(jpeg, 'sha256')) WHERE jpeg IS NOT NULL;

CREATE FUNCTION app.refuse_umapi_archive_photo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.umapi_product_photos AS photo
    JOIN app.storage_objects AS storage ON storage.id=NEW.storage_object_id
    WHERE photo.jpeg IS NOT NULL
      AND digest(photo.jpeg, 'sha256') IN (storage.sha256, NEW.upload_sha256)
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER product_images_refuse_umapi_archive
  BEFORE INSERT ON app.product_images
  FOR EACH ROW EXECUTE FUNCTION app.refuse_umapi_archive_photo();
