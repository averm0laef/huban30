-- Transactional outbox for the optional external search engine (OpenSearch,
-- see docs/SEARCH_ENGINE.md). PostgreSQL stays the source of truth and the
-- default search; this queue only tells apps/worker which products to
-- re-send to the engine.
--
-- Triggers write the queue inside the same transaction that changes the
-- catalog, so a committed 1C apply (or a price/stock/visibility change from
-- any code path) is never missed and a rolled-back one never leaks. One row
-- per product (primary key + ON CONFLICT), so the queue is bounded by the
-- catalog size even while the engine is switched off and nobody drains it.
-- A full reindex (apps/worker search:reindex) empties it.

CREATE TABLE app.search_index_queue (
  product_id uuid PRIMARY KEY,
  enqueued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text
);
CREATE INDEX search_index_queue_enqueued_idx ON app.search_index_queue (enqueued_at);

COMMENT ON TABLE app.search_index_queue IS
  'Products to (re)index in the optional search engine. Filled by triggers on the catalog tables, drained by apps/worker. Not the source of truth.';

CREATE FUNCTION app.enqueue_search_index(product_ids uuid[])
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, app
AS $$
  INSERT INTO app.search_index_queue (product_id)
  SELECT DISTINCT unnest(product_ids)
  ON CONFLICT (product_id) DO UPDATE
    SET enqueued_at = clock_timestamp(), attempt_count = 0, last_error = NULL
$$;

CREATE FUNCTION app.search_index_product_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app.enqueue_search_index(ARRAY[OLD.id]);
    RETURN OLD;
  END IF;
  PERFORM app.enqueue_search_index(ARRAY[NEW.id]);
  RETURN NEW;
END;
$$;

CREATE FUNCTION app.search_index_product_child_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app.enqueue_search_index(ARRAY[OLD.product_id]);
    RETURN OLD;
  END IF;
  PERFORM app.enqueue_search_index(ARRAY[NEW.product_id]);
  RETURN NEW;
END;
$$;

-- A brand or category change affects every product under it (name,
-- visibility of the whole subtree).
CREATE FUNCTION app.search_index_brand_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  PERFORM app.enqueue_search_index(ARRAY(SELECT id FROM app.products WHERE brand_id = NEW.id));
  RETURN NEW;
END;
$$;

CREATE FUNCTION app.search_index_category_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  PERFORM app.enqueue_search_index(ARRAY(
    WITH RECURSIVE subtree AS (
      SELECT NEW.id AS id
      UNION
      SELECT child.id FROM app.categories AS child JOIN subtree ON child.parent_id = subtree.id
    )
    SELECT product.id FROM app.products AS product WHERE product.category_id IN (SELECT id FROM subtree)
  ));
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_search_index
  AFTER INSERT OR DELETE OR UPDATE OF sku, name, search_text, brand_id, category_id, is_active, deleted_at
  ON app.products FOR EACH ROW EXECUTE FUNCTION app.search_index_product_trigger();

CREATE TRIGGER product_prices_search_index
  AFTER INSERT OR DELETE OR UPDATE OF amount_kopeks, valid_to
  ON app.product_prices FOR EACH ROW EXECUTE FUNCTION app.search_index_product_child_trigger();

CREATE TRIGGER inventory_balances_search_index
  AFTER INSERT OR DELETE OR UPDATE OF quantity_on_hand, quantity_reserved
  ON app.inventory_balances FOR EACH ROW EXECUTE FUNCTION app.search_index_product_child_trigger();

CREATE TRIGGER brands_search_index
  AFTER UPDATE OF name, is_active, deleted_at
  ON app.brands FOR EACH ROW EXECUTE FUNCTION app.search_index_brand_trigger();

CREATE TRIGGER categories_search_index
  AFTER UPDATE OF name, parent_id, is_active, deleted_at
  ON app.categories FOR EACH ROW EXECUTE FUNCTION app.search_index_category_trigger();
