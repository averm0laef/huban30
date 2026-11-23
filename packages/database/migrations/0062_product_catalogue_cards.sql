-- The maker's photo and characteristics of a product, kept after a customer asked for them (owner, 24.11.2026:
-- «нажимает кнопку и оно у него хранится — и в маленьком формате, и в большом»). One row per product, written only
-- when a visitor pressed «Показать фото и характеристики» and the catalogue named this very part (our maker and
-- number, not an analogue standing in for it). Nothing is fetched in bulk. The row is ignored once the product's
-- article changes (product_sku no longer matches), and goes with the product.
CREATE TABLE app.product_catalogue_cards (
  product_id uuid PRIMARY KEY REFERENCES app.products(id) ON DELETE CASCADE,
  product_sku text NOT NULL,
  catalogue_brand text NOT NULL CHECK (char_length(catalogue_brand) BETWEEN 1 AND 80),
  catalogue_article text NOT NULL CHECK (char_length(catalogue_article) BETWEEN 1 AND 64),
  catalogue_article_id integer NOT NULL CHECK (catalogue_article_id > 0),
  title text CHECK (title IS NULL OR char_length(title) <= 200),
  photos text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photos) <= 8),
  specs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(specs) = 'array' AND jsonb_array_length(specs) <= 30),
  found_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (cardinality(photos) > 0 OR jsonb_array_length(specs) > 0)
);

COMMENT ON TABLE app.product_catalogue_cards IS 'UMAPI photo links and characteristics of a product, kept after a customer asked (docs/UMAPI_INTEGRATION.md)';
