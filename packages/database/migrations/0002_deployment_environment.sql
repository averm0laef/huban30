CREATE TABLE app.deployment_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (
    environment IN ('unconfigured', 'development', 'staging', 'production')
  ),
  initialized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO app.deployment_settings (singleton, environment)
VALUES (true, 'unconfigured');

CREATE FUNCTION app.protect_deployment_environment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'app.deployment_settings cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.environment <> 'unconfigured' AND NEW.environment <> OLD.environment THEN
    RAISE EXCEPTION 'database environment cannot be changed after initialization'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER deployment_settings_protect
  BEFORE UPDATE OR DELETE ON app.deployment_settings
  FOR EACH ROW EXECUTE FUNCTION app.protect_deployment_environment();

COMMENT ON TABLE app.deployment_settings IS
  'Single immutable environment marker used to block development seed data in staging and production.';
