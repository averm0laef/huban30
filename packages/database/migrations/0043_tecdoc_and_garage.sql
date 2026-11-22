-- TecDoc (tecdoc.site) is used strictly request–response for what a visitor
-- is looking at (docs/TECDOC.md, offer clauses 2.6–2.7): nothing of its
-- catalogue is ever written to this database. The two tables below hold only
-- data of our own.

-- Our own accounting of calls made to the provider: how many per day were
-- sent, answered from the short-lived cache, refused by our limits, failed.
CREATE TABLE app.tecdoc_usage_daily (
  day date PRIMARY KEY,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  cache_hits integer NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  refused integer NOT NULL DEFAULT 0 CHECK (refused >= 0),
  errors integer NOT NULL DEFAULT 0 CHECK (errors >= 0)
);

-- «Гараж»: the cars a customer saved in the account. The text is what the
-- customer chose and sees; the ids only let the site repeat the customer's
-- own selection without asking again.
CREATE TABLE app.customer_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  details text CHECK (details IS NULL OR char_length(details) <= 200),
  source text NOT NULL CHECK (source IN ('tecdoc', 'catalog', 'manual')),
  tecdoc_mfa_id integer CHECK (tecdoc_mfa_id > 0),
  tecdoc_ms_id integer CHECK (tecdoc_ms_id > 0),
  tecdoc_gen_id integer CHECK (tecdoc_gen_id > 0),
  catalog_model_id integer CHECK (catalog_model_id > 0),
  catalog_modification_id integer CHECK (catalog_modification_id > 0),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX customer_vehicles_user_idx ON app.customer_vehicles (user_id, created_at);
-- One «основной» car per customer.
CREATE UNIQUE INDEX customer_vehicles_primary_idx ON app.customer_vehicles (user_id) WHERE is_primary;
