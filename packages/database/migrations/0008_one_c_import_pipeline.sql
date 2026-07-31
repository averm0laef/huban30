ALTER TYPE app.inventory_event_type ADD VALUE 'import_rollback';

ALTER TABLE app.warehouses
  ADD COLUMN source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0);

ALTER TABLE app.product_prices
  ADD COLUMN source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0);

CREATE INDEX product_prices_source_version_idx
  ON app.product_prices (product_id, source_version DESC);

ALTER TABLE app.catalog_import_batches
  DROP CONSTRAINT catalog_import_counts,
  ADD COLUMN skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  ADD COLUMN validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT catalog_import_validation_report_object CHECK (
    jsonb_typeof(validation_report) = 'object'
  ),
  ADD CONSTRAINT catalog_import_counts CHECK (
    valid_rows + invalid_rows + skipped_rows = total_rows
    AND applied_rows <= valid_rows
  );

ALTER TABLE app.catalog_import_rows
  ADD COLUMN normalized_payload jsonb,
  ADD COLUMN change_kind text CHECK (change_kind IN ('insert', 'update', 'noop')),
  ADD COLUMN expected_source_version bigint CHECK (
    expected_source_version IS NULL OR expected_source_version >= 0
  ),
  ADD CONSTRAINT catalog_import_normalized_payload_object CHECK (
    normalized_payload IS NULL OR jsonb_typeof(normalized_payload) = 'object'
  ),
  ADD CONSTRAINT catalog_import_entity_type CHECK (
    entity_type IN ('brand', 'category', 'warehouse', 'product', 'price', 'stock', 'unknown')
  );

ALTER TABLE app.catalog_revision_changes
  ADD CONSTRAINT catalog_revision_change_entity_type CHECK (
    entity_type IN (
      'brand', 'category', 'warehouse', 'product', 'product_price', 'inventory_balance'
    )
  );

CREATE TABLE app.integration_request_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  integration_key text NOT NULL,
  operation text NOT NULL,
  external_request_id text,
  ip_address inet,
  succeeded boolean NOT NULL,
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  batch_id uuid REFERENCES app.catalog_import_batches(id) ON DELETE SET NULL,
  payload_checksum bytea,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT integration_request_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX integration_request_log_lookup_idx
  ON app.integration_request_log (integration_key, created_at DESC);
CREATE INDEX integration_request_log_external_idx
  ON app.integration_request_log (integration_key, external_request_id, created_at DESC)
  WHERE external_request_id IS NOT NULL;
CREATE INDEX integration_request_log_failures_idx
  ON app.integration_request_log (created_at DESC)
  WHERE NOT succeeded;

CREATE TRIGGER integration_request_log_append_only
  BEFORE UPDATE OR DELETE ON app.integration_request_log
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

COMMENT ON TABLE app.integration_request_log IS
  'Append-only journal for authenticated and rejected machine-to-machine integration requests.';
COMMENT ON COLUMN app.catalog_import_rows.normalized_payload IS
  'Validated canonical payload used by preview and apply; raw input remains in payload.';
