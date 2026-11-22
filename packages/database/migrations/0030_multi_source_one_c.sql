-- Existing catalog IDs and URLs stay attached to the primary information base.
ALTER TABLE app.integration_endpoints
  ADD COLUMN display_name text NOT NULL DEFAULT '',
  ADD COLUMN expected_sync_minutes integer NOT NULL DEFAULT 60 CHECK(expected_sync_minutes BETWEEN 5 AND 10080),
  ADD COLUMN last_catalog_exchange_at timestamptz,
  ADD COLUMN last_offers_exchange_at timestamptz;
INSERT INTO app.integration_endpoints(integration_key,is_enabled,display_name)
VALUES('one_c',false,'Основная база 1С') ON CONFLICT(integration_key)
DO UPDATE SET display_name=CASE WHEN app.integration_endpoints.display_name='' THEN EXCLUDED.display_name ELSE app.integration_endpoints.display_name END;
INSERT INTO app.integration_endpoints(integration_key,is_enabled,display_name)
VALUES('one_c_secondary',false,'Дополнительная база 1С') ON CONFLICT(integration_key) DO NOTHING;

ALTER TABLE app.products ADD COLUMN one_c_source text NOT NULL DEFAULT 'one_c'
  REFERENCES app.integration_endpoints(integration_key);
CREATE INDEX products_one_c_source_idx ON app.products(one_c_source,external_id) WHERE deleted_at IS NULL;
-- Two independent information bases may legitimately reuse a SKU. Their
-- records retain separate IDs/prices/warehouses; no identity is guessed.
DROP INDEX app.products_sku_active_uidx;
CREATE UNIQUE INDEX products_source_sku_active_uidx ON app.products(one_c_source,sku) WHERE deleted_at IS NULL;

ALTER TABLE app.one_c_exchange_runs ADD COLUMN source_key text NOT NULL DEFAULT 'one_c'
  REFERENCES app.integration_endpoints(integration_key);
ALTER TABLE app.one_c_exchange_runs DROP CONSTRAINT one_c_exchange_runs_kind_checksum_uidx;
ALTER TABLE app.one_c_exchange_runs ADD CONSTRAINT one_c_exchange_runs_source_kind_checksum_uidx UNIQUE(source_key,kind,content_checksum);
CREATE INDEX one_c_exchange_runs_source_status_idx ON app.one_c_exchange_runs(source_key,status,created_at DESC);

COMMENT ON COLUMN app.products.one_c_source IS 'Owning 1C information base. Full snapshots can hide or zero stock only within this source.';
COMMENT ON COLUMN app.integration_endpoints.expected_sync_minutes IS 'Expected interval of 1C push updates; a freshness indicator, not an invented server-side pull scheduler.';
