-- An article is something a product has, not what a product is.
--
-- The owner's 1С base (42,723 items, looked at on 2026-11-22) holds 997
-- articles shared by two to ten different items: the belt size «4PK820» is
-- the article of belts by ten brands, «ГАЗ53» of a clutch cover, a clutch
-- disc and a piston set. The unique index on (one_c_source, sku) made the
-- exchange drop every item after the first one — 1,150 items, 162 of them in
-- stock — and, before the per-row savepoint existed, failed the whole
-- import.xml (the 2026-08-23 exchange).
--
-- A product's identity is its 1С id (products_external_id_uidx) and its slug
-- (products_slug_key); both stay unique. Article lookups use
-- products_sku_normalized_idx and the trigram indexes, none of which needs
-- uniqueness.

DROP INDEX app.products_source_sku_active_uidx;
