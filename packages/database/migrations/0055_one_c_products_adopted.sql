-- The first exchange with 1С names every product by the identifier 1С gives it, while a catalogue loaded before the
-- exchange knows the same products by their 1С code. The exchange now takes such products over instead of adding
-- the catalogue a second time and hiding the loaded one; the journal says how many it took over.

ALTER TABLE app.one_c_exchange_runs
  ADD COLUMN products_adopted integer NOT NULL DEFAULT 0 CHECK (products_adopted >= 0);

COMMENT ON COLUMN app.one_c_exchange_runs.products_adopted IS
  'Products already on the site under another identifier (their 1С code, or the same article and name) that this file took over.';
