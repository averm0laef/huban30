-- Our own accounting of calls to the UMAPI API (docs/UMAPI_INTEGRATION.md):
-- how many per store day were sent, answered from the short-lived display
-- cache, refused by our limits, failed. Nothing UMAPI answers is stored here
-- or anywhere else in this database: crosses, applicability and photos are
-- shown to the visitor who asked and kept at most in the Redis display cache.
CREATE TABLE app.umapi_usage_daily (
  day date PRIMARY KEY,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  cache_hits integer NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  refused integer NOT NULL DEFAULT 0 CHECK (refused >= 0),
  errors integer NOT NULL DEFAULT 0 CHECK (errors >= 0)
);
