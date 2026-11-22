\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  application_table_count integer;
  invalid_money_column_count integer;
  missing_foreign_key_index_count integer;
  order_states text[];
  roles text[];
BEGIN
  SELECT count(*)
  INTO application_table_count
  FROM information_schema.tables
  WHERE table_schema = 'app' AND table_type = 'BASE TABLE';

  IF application_table_count < 50 THEN
    RAISE EXCEPTION 'Expected at least 50 application tables, found %', application_table_count;
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
        AND index_record.indnkeyatts >= cardinality(constraint_record.conkey)
        AND NOT EXISTS (
          SELECT 1
          FROM generate_subscripts(constraint_record.conkey,1) AS key_position(position)
          WHERE index_record.indkey[key_position.position-1]
            IS DISTINCT FROM constraint_record.conkey[key_position.position]
        )
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
    'awaiting_confirmation',
    'processing',
    'awaiting_delivery_terms',
    'ready',
    'completed',
    'cancelled'
  ] THEN
    RAISE EXCEPTION 'Unexpected order state contract: %', order_states;
  END IF;
END;
$$;

DO $$
DECLARE
  invalid_money_bound_count integer;
BEGIN
  SELECT count(*)
  INTO invalid_money_bound_count
  FROM pg_attribute AS money_column
  JOIN pg_class AS money_table ON money_table.oid=money_column.attrelid
  JOIN pg_namespace AS money_namespace ON money_namespace.oid=money_table.relnamespace
  WHERE money_namespace.nspname='app'
    AND money_table.relkind IN ('r','p')
    AND money_column.attnum>0
    AND NOT money_column.attisdropped
    AND money_column.attname LIKE '%\_kopeks' ESCAPE '\'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS money_constraint
      WHERE money_constraint.conrelid=money_table.oid
        AND money_constraint.contype='c'
        AND money_constraint.convalidated
        AND money_column.attnum=ANY(money_constraint.conkey)
        AND pg_get_constraintdef(money_constraint.oid) LIKE '%9007199254740991%'
    );

  IF invalid_money_bound_count<>0 THEN
    RAISE EXCEPTION '% money columns lack a validated JavaScript-safe upper bound',
      invalid_money_bound_count;
  END IF;
END;
$$;

DO $$
DECLARE
  contact_request_id uuid;
  retained_status text;
  anonymized_count integer;
  remaining_pii_count integer;
BEGIN
  INSERT INTO app.contact_requests (
    idempotency_key,
    request_hash,
    source,
    status,
    customer_name,
    customer_email,
    message,
    consent_at,
    retention_until
  ) VALUES (
    gen_random_uuid(),
    decode(repeat('ef',32),'hex'),
    'contacts',
    'in_progress',
    'Schema Smoke Customer',
    'schema-smoke@example.test',
    'PII must be cleared',
    clock_timestamp()-interval '2 days',
    clock_timestamp()-interval '1 day'
  ) RETURNING id INTO contact_request_id;

  SELECT app.anonymize_expired_contact_requests(1) INTO anonymized_count;

  SELECT status,
         ((customer_name<>'' OR customer_email IS NOT NULL OR customer_phone IS NOT NULL OR message<>''))::integer
  INTO retained_status,remaining_pii_count
  FROM app.contact_requests
  WHERE id=contact_request_id AND anonymized_at IS NOT NULL;

  IF anonymized_count<>1 OR retained_status<>'in_progress' OR remaining_pii_count<>0 THEN
    RAISE EXCEPTION 'Expired contact request was not safely anonymized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.audit_log
    WHERE action='contact_request.anonymized'
      AND entity_type='contact_request'
      AND entity_id=contact_request_id::text
      AND before_state IS NULL
      AND NOT metadata ? 'customerEmail'
      AND NOT metadata ? 'customerPhone'
  ) THEN
    RAISE EXCEPTION 'Contact request anonymization audit event is missing or unsafe';
  END IF;
END;
$$;

DO $$
DECLARE
  waitlist_id uuid;
  anonymized_count integer;
  remaining_pii_count integer;
BEGIN
  INSERT INTO app.supplier_waitlist_requests (
    idempotency_key,
    request_hash,
    part_guid,
    part_brand,
    part_number,
    part_name,
    stock_id,
    price_kopeks,
    quantity,
    customer_name,
    customer_email,
    consent_at,
    consent_policy_version,
    retention_until
  ) VALUES (
    gen_random_uuid(),
    decode(repeat('ab',32),'hex'),
    'schema-smoke-part',
    'Schema Smoke Brand',
    'SCHEMA-SMOKE-PART',
    'Schema smoke waitlist product',
    'schema-smoke-stock',
    10000,
    1,
    'Schema Smoke Waitlist Customer',
    'schema-smoke-waitlist@example.test',
    clock_timestamp()-interval '2 days',
    'supplier-waitlist-personal-data-2026-08-15-v2',
    clock_timestamp()-interval '1 day'
  ) RETURNING id INTO waitlist_id;

  SELECT app.anonymize_expired_supplier_waitlist_requests(500) INTO anonymized_count;

  SELECT (
    customer_name<>''
    OR customer_email IS NOT NULL
    OR customer_phone IS NOT NULL
    OR user_id IS NOT NULL
  )::integer
  INTO remaining_pii_count
  FROM app.supplier_waitlist_requests
  WHERE id=waitlist_id AND anonymized_at IS NOT NULL;

  IF anonymized_count<1 OR remaining_pii_count<>0 THEN
    RAISE EXCEPTION 'Expired supplier waitlist request was not safely anonymized';
  END IF;
END;
$$;

DO $$
DECLARE
  checkout_order_id uuid := gen_random_uuid();
  legal_version text;
BEGIN
  FOREACH legal_version IN ARRAY ARRAY[
    'checkout-terms-v1',
    'checkout-terms-2026-08-15-v2',
    'checkout-terms-2026-08-30-v3'
  ] LOOP
  checkout_order_id := gen_random_uuid();
  INSERT INTO app.orders (
    id,
    public_number,
    idempotency_key,
    customer_email,
    customer_phone,
    customer_name,
    contact_snapshot,
    delivery_snapshot,
    subtotal_kopeks,
    total_amount_kopeks,
    terms_accepted_at,
    legal_policy_version,
    personal_data_consent_at,
    personal_data_consent_policy_version,
    personal_data_consent_document_path,
    personal_data_consent_text,
    personal_data_consent_ip_address,
    personal_data_consent_user_agent
  ) VALUES (
    checkout_order_id,
    'AN-SCHEMA-CONSENT-' || replace(checkout_order_id::text,'-',''),
    'schema-consent:' || checkout_order_id::text,
    'schema-smoke-checkout@example.test',
    '+79141234567',
    'Schema Smoke Checkout Customer',
    '{"email":"schema-smoke-checkout@example.test"}'::jsonb,
    '{"method":"pickup"}'::jsonb,
    0,
    0,
    clock_timestamp(),
    legal_version,
    CASE WHEN legal_version<>'checkout-terms-v1' THEN clock_timestamp() END,
    CASE WHEN legal_version<>'checkout-terms-v1' THEN 'checkout-personal-data-2026-08-15-v1' END,
    CASE WHEN legal_version<>'checkout-terms-v1' THEN '/checkout-personal-data-consent' END,
    CASE WHEN legal_version<>'checkout-terms-v1' THEN 'Schema smoke exact checkout consent text' END,
    CASE WHEN legal_version<>'checkout-terms-v1' THEN '127.0.0.1'::inet END,
    CASE WHEN legal_version<>'checkout-terms-v1' THEN 'schema-smoke' END
  );

  BEGIN
    UPDATE app.orders
    SET personal_data_consent_text='Changed consent text'
    WHERE id=checkout_order_id;
    RAISE EXCEPTION 'Checkout consent evidence mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  END LOOP;

  BEGIN
    INSERT INTO app.orders (
      public_number,idempotency_key,customer_email,customer_phone,customer_name,
      contact_snapshot,delivery_snapshot,subtotal_kopeks,total_amount_kopeks,
      terms_accepted_at,legal_policy_version
    ) VALUES (
      'AN-SCHEMA-MISSING-CONSENT','schema-missing-consent','schema-smoke@example.test',
      '+79141234567','Schema Smoke','{}'::jsonb,'{"method":"pickup"}'::jsonb,0,0,
      clock_timestamp(),'checkout-terms-2026-08-30-v3'
    );
    RAISE EXCEPTION 'Current checkout unexpectedly accepted missing consent evidence';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  integration_id uuid;
  previous_revision bigint;
  current_revision bigint;
  statement text;
BEGIN
  INSERT INTO app.integration_endpoints (integration_key)
  VALUES ('schema_smoke_session_revision')
  RETURNING id,auth_revision INTO integration_id,previous_revision;

  FOR statement IN SELECT unnest(ARRAY[
    'username=''schema-smoke-user''',
    'secret_hash=decode(''ab'',''hex'')',
    'allowed_networks=ARRAY[''127.0.0.1/32''::cidr]',
    'is_enabled=true',
    'is_enabled=false'
  ]) LOOP
    EXECUTE 'UPDATE app.integration_endpoints SET ' || statement || ' WHERE id=$1'
      USING integration_id;
    SELECT auth_revision INTO current_revision FROM app.integration_endpoints WHERE id=integration_id;
    IF current_revision<>previous_revision+1 THEN
      RAISE EXCEPTION 'Integration security change did not advance session generation: %', statement;
    END IF;
    previous_revision := current_revision;
  END LOOP;

  UPDATE app.integration_endpoints
  SET last_used_at=clock_timestamp(),last_exchange_at=clock_timestamp(),username=username,
      auth_revision=auth_revision+100
  WHERE id=integration_id
  RETURNING auth_revision INTO current_revision;
  IF current_revision<>previous_revision THEN
    RAISE EXCEPTION 'Usage updates changed security generation or allowed it to be overwritten';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'app.order_items'::regclass
      AND tgname = 'order_items_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Order item snapshots are not immutable';
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
  version_columns integer;
BEGIN
  SELECT count(*) INTO version_columns
  FROM information_schema.columns
  WHERE table_schema = 'app'
    AND table_name IN ('chat_threads', 'invoices')
    AND column_name = 'version'
    AND data_type = 'integer';

  IF version_columns <> 2 THEN
    RAISE EXCEPTION 'Staff workspace optimistic version columns are missing';
  END IF;

  IF to_regclass('app.invoice_number_seq') IS NULL THEN
    RAISE EXCEPTION 'Invoice number sequence is missing';
  END IF;
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

DO $$
DECLARE
  version_columns integer;
BEGIN
  SELECT count(*) INTO version_columns
  FROM information_schema.columns
  WHERE table_schema = 'app'
    AND table_name IN ('warehouses', 'product_prices')
    AND column_name = 'source_version'
    AND data_type = 'bigint';

  IF version_columns <> 2 THEN
    RAISE EXCEPTION '1C source version columns are missing or use the wrong type';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum AS value
    JOIN pg_type AS type ON type.oid = value.enumtypid
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'app'
      AND type.typname = 'inventory_event_type'
      AND value.enumlabel = 'import_rollback'
  ) THEN
    RAISE EXCEPTION 'Inventory rollback event type is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'app.integration_request_log'::regclass
      AND tgname = 'integration_request_log_append_only'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '1C integration request journal is not append-only';
  END IF;
END;
$$;

DO $$
DECLARE
  thread_id uuid;
  message_id uuid;
  message_sequence bigint;
  storage_id uuid;
  attachment_id uuid;
BEGIN
  INSERT INTO app.chat_threads (guest_token_hash,subject)
  VALUES (decode(repeat('ab',32),'hex'),'Schema smoke chat')
  RETURNING id INTO thread_id;

  INSERT INTO app.chat_messages
    (thread_id,sender_kind,message_type,body,client_message_id)
  VALUES (thread_id,'guest','text','immutable message',gen_random_uuid()::text)
  RETURNING id,sequence_number INTO message_id,message_sequence;

  IF message_sequence IS NULL THEN
    RAISE EXCEPTION 'Chat reconnect sequence was not generated';
  END IF;

  BEGIN
    UPDATE app.chat_messages SET body='changed' WHERE id=message_id;
    RAISE EXCEPTION 'Immutable chat payload unexpectedly changed';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE app.chat_messages SET edited_at=clock_timestamp() WHERE id=message_id;
    RAISE EXCEPTION 'Immutable chat edit marker unexpectedly changed';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    INSERT INTO app.chat_guest_message_receipts (message_id,read_at)
    VALUES (message_id,clock_timestamp());
    RAISE EXCEPTION 'Guest read receipt unexpectedly omitted delivery';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO app.storage_objects
    (storage_key,original_name,mime_type,byte_size,sha256,status)
  VALUES ('chat/2026-08/00000000-0000-0000-0000-000000000001.png','pixel.png','image/png',1,
          decode(repeat('cd',32),'hex'),'available')
  RETURNING id INTO storage_id;

  INSERT INTO app.chat_attachments (message_id,storage_object_id,scan_status)
  VALUES (message_id,storage_id,'clean') RETURNING id INTO attachment_id;

  BEGIN
    DELETE FROM app.chat_attachments WHERE id=attachment_id;
    RAISE EXCEPTION 'Immutable chat attachment link unexpectedly deleted';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$$;

SELECT
  'schema_smoke=ok' AS result,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app') AS app_tables,
  (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'app'::regnamespace) AS foreign_keys,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'app') AS indexes;

ROLLBACK;
