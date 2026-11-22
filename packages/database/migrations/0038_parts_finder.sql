-- «Подбор по автомобилю» (docs/PARTS_FINDER.md), native part of the API.
-- Replaces the SQLite files of the owner's original Python module: the shop's
-- own fitment rows, the shared FAPI ledger and cache, VIN / chassis caches,
-- provider quotas and the make -> model -> modification picker catalogue.

-- Fitment supplied by the shop or a licensed source (CSV import CLI). The
-- import replaces the whole set in one transaction.
CREATE TABLE app.parts_fitment (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make text NOT NULL CHECK (make <> ''),
  model text NOT NULL CHECK (model <> ''),
  category text NOT NULL CHECK (category <> ''),
  configuration text NOT NULL CHECK (configuration <> ''),
  engine text NOT NULL DEFAULT '',
  liters numeric(4, 1) CHECK (liters IS NULL OR (liters > 0 AND liters < 30)),
  year_from integer CHECK (year_from IS NULL OR year_from BETWEEN 1900 AND 2100),
  year_to integer CHECK (year_to IS NULL OR year_to BETWEEN 1900 AND 2100),
  -- Text, never numeric: leading zeros are part of an article number.
  article text NOT NULL CHECK (article <> '' AND length(article) <= 64),
  brand text NOT NULL CHECK (brand <> ''),
  oem boolean NOT NULL,
  source text NOT NULL CHECK (source <> ''),
  make_key text NOT NULL,
  model_key text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);
CREATE INDEX parts_fitment_lookup_idx ON app.parts_fitment (category, make_key, model_key);

-- FAPI ledger. `scope` is a SHA-256 of the key, never the key itself.
CREATE TABLE app.parts_finder_fapi_accounts (
  scope text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  usage jsonb NOT NULL
);

-- Remaining package credits as reserved locally (min with FAPI's own figure).
CREATE TABLE app.parts_finder_fapi_packages (
  period text PRIMARY KEY,
  remaining integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Credits reserved per Moscow day (FAPI_DAILY_CREDIT_LIMIT).
CREATE TABLE app.parts_finder_fapi_daily (
  scope text NOT NULL,
  day date NOT NULL,
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (scope, day)
);

-- Shared cache: a repeated request costs no credits while it is valid.
CREATE TABLE app.parts_finder_fapi_cache (
  period text NOT NULL,
  cache_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (period, cache_key)
);
CREATE INDEX parts_finder_fapi_cache_expires_idx ON app.parts_finder_fapi_cache (expires_at);

-- Decoded VINs (NHTSA vPIC) and chassis lookups (VINROKU).
CREATE TABLE app.parts_finder_vehicle_cache (
  kind text NOT NULL CHECK (kind IN ('vpic', 'vinroku')),
  identifier text NOT NULL CHECK (identifier <> '' AND length(identifier) <= 64),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (kind, identifier)
);
CREATE INDEX parts_finder_vehicle_cache_expires_idx ON app.parts_finder_vehicle_cache (expires_at);

CREATE TABLE app.parts_finder_provider_quotas (
  provider text PRIMARY KEY,
  quota_limit integer,
  remaining integer NOT NULL,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Picker catalogue. Seed rows (hand-made list of makes and models) give an
-- instant typeahead with FAPI off; FAPI ids and years are added on demand.
CREATE TABLE app.parts_finder_vehicle_makes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name text NOT NULL CHECK (name <> ''),
  name_ru text,
  country text,
  popular_rank integer,
  fapi_id integer UNIQUE,
  models_checked_at timestamptz
);

CREATE TABLE app.parts_finder_vehicle_models (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make_id integer NOT NULL REFERENCES app.parts_finder_vehicle_makes(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name text NOT NULL CHECK (name <> ''),
  name_ru text,
  year_from integer,
  year_to integer,
  fapi_id integer UNIQUE,
  fapi_title text,
  modifications_checked_at timestamptz,
  UNIQUE (make_id, slug)
);

CREATE TABLE app.parts_finder_vehicle_modifications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id integer NOT NULL REFERENCES app.parts_finder_vehicle_models(id) ON DELETE CASCADE,
  fapi_id integer NOT NULL UNIQUE,
  label text NOT NULL,
  engine text,
  capacity text,
  year_from integer,
  year_to integer,
  body text,
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX parts_finder_vehicle_modifications_model_idx ON app.parts_finder_vehicle_modifications (model_id);

COMMENT ON TABLE app.parts_fitment IS
  'Shop or licensed fitment rows for «Подбор по автомобилю»; replaced as a whole by the parts-fitment-import CLI.';
COMMENT ON TABLE app.parts_finder_fapi_cache IS
  'Shared FAPI answers; while valid a repeated request costs no credits.';
