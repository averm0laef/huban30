CREATE FUNCTION app.reject_demo_catalog_outside_development()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  deployment_environment text;
BEGIN
  IF NOT NEW.is_demo THEN
    RETURN NEW;
  END IF;

  SELECT environment
  INTO deployment_environment
  FROM app.deployment_settings
  WHERE singleton;

  IF deployment_environment IS DISTINCT FROM 'development' THEN
    RAISE EXCEPTION 'demo catalog records are forbidden outside development'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER products_reject_demo_outside_development
  BEFORE INSERT OR UPDATE OF is_demo ON app.products
  FOR EACH ROW EXECUTE FUNCTION app.reject_demo_catalog_outside_development();

COMMENT ON TRIGGER products_reject_demo_outside_development ON app.products IS
  'Database-level guard preventing demo catalog rows in staging and production.';
