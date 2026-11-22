-- The exchange journal says which 1С price type an offers file's prices were
-- taken from («Оптовая цена»), so staff can see at a glance that the site is
-- not showing a cost price. NULL for catalog files (they carry no prices) and
-- for offers files that named no price type or only cost types.

ALTER TABLE app.one_c_exchange_runs
  ADD COLUMN price_type_name text CHECK (price_type_name IS NULL OR char_length(price_type_name) <= 200);
