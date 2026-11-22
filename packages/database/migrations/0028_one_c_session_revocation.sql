-- Session cookies bind to a generation changed only by security policy
-- updates. Usage timestamps and exchange summaries must not revoke a sync.
ALTER TABLE app.integration_endpoints
  ADD COLUMN auth_revision bigint NOT NULL DEFAULT 1
  CHECK (auth_revision > 0);

CREATE FUNCTION app.advance_integration_auth_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.is_enabled IS DISTINCT FROM OLD.is_enabled
    OR NEW.username IS DISTINCT FROM OLD.username
    OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash
    OR NEW.allowed_networks IS DISTINCT FROM OLD.allowed_networks THEN
    NEW.auth_revision := OLD.auth_revision + 1;
  ELSE
    NEW.auth_revision := OLD.auth_revision;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER integration_endpoints_auth_revision
BEFORE UPDATE ON app.integration_endpoints
FOR EACH ROW EXECUTE FUNCTION app.advance_integration_auth_revision();

COMMENT ON COLUMN app.integration_endpoints.auth_revision IS
  'Security generation bound into 1C exchange sessions; changes on enabled, username, password hash or CIDR changes.';
