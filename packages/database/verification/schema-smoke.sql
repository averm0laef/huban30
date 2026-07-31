\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  application_table_count integer;
  invalid_money_column_count integer;
  missing_foreign_key_index_count integer;
  order_states text[];
  payment_states text[];
  roles text[];
BEGIN
  SELECT count(*)
  INTO application_table_count
  FROM information_schema.tables
  WHERE table_schema = 'app' AND table_type = 'BASE TABLE';

  IF application_table_count < 48 THEN
    RAISE EXCEPTION 'Expected at least 48 application tables, found %', application_table_count;
  END IF;

  SELECT count(*)
  INTO invalid_money_column_count
  FROM information_schema.columns
  WHERE table_schema = 'app'
    AND column_name LIKE '%\_kopeks' ESCAPE '\'
    AND data_type <> 'bigint';

  IF invalid_money_column_count <> 0 THEN
    RAISE EXCEPTION 'All kopeks columns must use bigint';
  END IF;

  SELECT count(*)
  INTO missing_foreign_key_index_count
  FROM pg_constraint AS constraint_record
  WHERE constraint_record.contype = 'f'
    AND constraint_record.connamespace = 'app'::regnamespace
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index AS index_record
      WHERE index_record.indrelid = constraint_record.conrelid
        AND index_record.indisvalid
        AND index_record.indisready
        AND index_record.indkey::smallint[] @> constraint_record.conkey
    );

  IF missing_foreign_key_index_count <> 0 THEN
    RAISE EXCEPTION '% foreign keys are missing a supporting index', missing_foreign_key_index_count;
  END IF;

  SELECT array_agg(enumlabel ORDER BY enumsortorder)
  INTO roles
  FROM pg_enum
  WHERE enumtypid = 'app.app_role'::regtype;

  IF roles <> ARRAY['customer', 'manager', 'director', 'admin'] THEN
    RAISE EXCEPTION 'Unexpected role contract: %', roles;
  END IF;

  SELECT array_agg(enumlabel ORDER BY enumsortorder)
  INTO order_states
  FROM pg_enum
  WHERE enumtypid = 'app.order_status'::regtype;

  IF order_states <> ARRAY[
    'pending_payment',
    'paid',
    'processing',
    'awaiting_delivery_terms',
    'ready',
    'completed',
    'cancelled',
    'refunded'
  ] THEN
    RAISE EXCEPTION 'Unexpected order state contract: %', order_states;
  END IF;

  SELECT array_agg(enumlabel ORDER BY enumsortorder)
  INTO payment_states
  FROM pg_enum
  WHERE enumtypid = 'app.payment_status'::regtype;

  IF payment_states <> ARRAY[
    'pending',
    'authorized',
    'succeeded',
    'failed',
    'cancelled',
    'partially_refunded',
    'refunded'
  ] THEN
    RAISE EXCEPTION 'Unexpected payment state contract: %', payment_states;
  END IF;
END;
$$;

DO $$
DECLARE
  audit_id bigint;
BEGIN
  INSERT INTO app.audit_log (action, entity_type)
  VALUES ('schema.smoke', 'verification')
  RETURNING id INTO audit_id;

  BEGIN
    UPDATE app.audit_log SET action = 'schema.smoke.changed' WHERE id = audit_id;
    RAISE EXCEPTION 'Append-only audit update unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    DELETE FROM app.audit_log WHERE id = audit_id;
    RAISE EXCEPTION 'Append-only audit delete unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  product_id uuid := gen_random_uuid();
  warehouse_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO app.products (id, sku, name, slug)
  VALUES (product_id, 'SCHEMA-SMOKE', 'Schema smoke product', 'schema-smoke-product');

  INSERT INTO app.warehouses (id, code, name)
  VALUES (warehouse_id, 'SCHEMA-SMOKE', 'Schema smoke warehouse');

  BEGIN
    INSERT INTO app.inventory_balances (
      product_id,
      warehouse_id,
      quantity_on_hand,
      quantity_reserved
    ) VALUES (product_id, warehouse_id, 1, 2);
    RAISE EXCEPTION 'Oversell constraint unexpectedly accepted reserved quantity above stock';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  current_environment text;
  alternate_environment text;
BEGIN
  SELECT environment
  INTO current_environment
  FROM app.deployment_settings
  WHERE singleton;

  alternate_environment := CASE current_environment
    WHEN 'production' THEN 'staging'
    ELSE 'production'
  END;

  BEGIN
    UPDATE app.deployment_settings SET environment = alternate_environment WHERE singleton;
    RAISE EXCEPTION 'Deployment environment unexpectedly changed after initialization';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  current_environment text;
BEGIN
  SELECT environment
  INTO current_environment
  FROM app.deployment_settings
  WHERE singleton;

  IF current_environment = 'development' THEN
    INSERT INTO app.products (sku, name, slug, is_demo)
    VALUES ('SCHEMA-SMOKE-DEMO', 'Schema smoke demo', 'schema-smoke-demo', true);
  ELSE
    BEGIN
      INSERT INTO app.products (sku, name, slug, is_demo)
      VALUES ('SCHEMA-SMOKE-DEMO', 'Schema smoke demo', 'schema-smoke-demo', true);
      RAISE EXCEPTION 'Demo catalog row unexpectedly succeeded outside development';
    EXCEPTION
      WHEN SQLSTATE '55000' THEN NULL;
    END;
  END IF;
END;
$$;

SELECT
  'schema_smoke=ok' AS result,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app') AS app_tables,
  (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'app'::regnamespace) AS foreign_keys,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'app') AS indexes;

ROLLBACK;
