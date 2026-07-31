CREATE TABLE app.catalog_revision_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revision_id bigint NOT NULL REFERENCES app.catalog_revisions(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (revision_id, sequence_number),
  CONSTRAINT catalog_revision_change_shape CHECK (
    (operation = 'insert' AND before_state IS NULL AND after_state IS NOT NULL)
    OR (operation = 'update' AND before_state IS NOT NULL AND after_state IS NOT NULL)
    OR (operation = 'delete' AND before_state IS NOT NULL AND after_state IS NULL)
  )
);

CREATE INDEX catalog_revision_changes_entity_idx
  ON app.catalog_revision_changes (entity_type, entity_id, id DESC);

CREATE TRIGGER catalog_revision_changes_append_only
  BEFORE UPDATE OR DELETE ON app.catalog_revision_changes
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

COMMENT ON TABLE app.catalog_revision_changes IS
  'Ordered immutable before/after journal used to preview and safely reverse an applied 1C catalog revision.';
