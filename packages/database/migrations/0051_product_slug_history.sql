-- Former page addresses of products. The slug is made from the name, so a
-- product renamed in 1С gets a new address; every link a search engine or a
-- customer kept used to die with it. The storefront answers a former address
-- with a permanent redirect to the product's address of today.
--
-- Kept by a trigger, whoever changes the slug (the exchange, a batch apply,
-- the staff). A live address always wins: a product that takes a former
-- address of another product owns it from then on.

CREATE TABLE app.product_slug_history (
  slug citext PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  replaced_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX product_slug_history_product_idx ON app.product_slug_history (product_id);

CREATE FUNCTION app.remember_product_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    INSERT INTO app.product_slug_history (slug, product_id) VALUES (OLD.slug, OLD.id)
    ON CONFLICT (slug) DO UPDATE SET product_id = EXCLUDED.product_id, replaced_at = clock_timestamp();
  END IF;
  DELETE FROM app.product_slug_history WHERE slug = NEW.slug;
  RETURN NEW;
END
$$;

CREATE TRIGGER products_remember_slug
AFTER INSERT OR UPDATE OF slug ON app.products
FOR EACH ROW EXECUTE FUNCTION app.remember_product_slug();
