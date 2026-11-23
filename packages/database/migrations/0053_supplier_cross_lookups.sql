-- Which of our own products the shop has already asked the supplier about
-- while filling its cross base in the background (docs/CATALOG_MATCHING.md,
-- «Наполнение от поставщика»). One row per product: a run continues where
-- the last one stopped and never spends a supplier call on the same number
-- twice. The crosses themselves live in app.article_crosses; this table only
-- remembers that the question was asked and what the answer allowed.
-- sku_normalized and brand_id are the number and brand that were asked: 1С
-- can change either on the same card, and the old answer then no longer
-- counts for it.
--
--   found          the supplier knows the number under our brand and named analogs
--   no_crosses     known under our brand, no analogs stated
--   not_found      the supplier does not know the number
--   brand_mismatch known, but only under other brands: nothing is stored
CREATE TABLE app.supplier_cross_lookups (
  product_id uuid PRIMARY KEY REFERENCES app.products (id) ON DELETE CASCADE,
  sku_normalized text NOT NULL,
  brand_id uuid NOT NULL,
  supplier text NOT NULL DEFAULT 'rossko' CHECK (supplier IN ('rossko')),
  status text NOT NULL CHECK (status IN ('found', 'no_crosses', 'not_found', 'brand_mismatch')),
  pairs integer NOT NULL DEFAULT 0 CHECK (pairs >= 0),
  note text,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX supplier_cross_lookups_status_idx ON app.supplier_cross_lookups (status, checked_at);
