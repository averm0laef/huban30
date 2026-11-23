-- The owner runs the 1С exchange once a day. The expected interval of a base
-- only drives the freshness check ("the exchange is late" in the staff
-- settings and the alert the worker sends); 1С itself starts every exchange.
-- 60 minutes was the column default nobody had chosen: with a daily schedule
-- it marks a healthy base as late 22 hours a day.
ALTER TABLE app.integration_endpoints ALTER COLUMN expected_sync_minutes SET DEFAULT 1440;

UPDATE app.integration_endpoints
SET expected_sync_minutes = 1440
WHERE integration_key IN ('one_c', 'one_c_secondary') AND expected_sync_minutes = 60;

COMMENT ON COLUMN app.integration_endpoints.expected_sync_minutes IS
  'Expected interval of 1C push updates, a day by default; a freshness indicator and the threshold of the late-exchange alert, not a server-side pull scheduler.';

-- What a full catalogue did to the products it no longer lists. A full file
-- that names less than half of the live products hides nothing (protection
-- against a cut-off export); until now the journal did not say so, and a
-- first real exchange that failed to replace the trial upload looked fine.
ALTER TABLE app.one_c_exchange_runs
  ADD COLUMN products_hidden integer NOT NULL DEFAULT 0 CHECK (products_hidden >= 0),
  ADD COLUMN hiding_skipped boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN app.one_c_exchange_runs.products_hidden IS
  'Products of this base a full catalogue file no longer lists and therefore hid from the shop.';
COMMENT ON COLUMN app.one_c_exchange_runs.hiding_skipped IS
  'True when a full catalogue file listed less than half of the live products and so hid none of the missing ones.';
