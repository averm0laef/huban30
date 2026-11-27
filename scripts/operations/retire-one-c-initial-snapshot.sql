-- One-time removal from sale of the owner's initial LIST EXPORT, 23.11.2026.
-- Not a DROP/DELETE of the production database. Retains IDs, history and media
-- so the first real CommerceML exchange can adopt and revive the same products.
-- Run only after scripts/backup.sh and the isolated PostgreSQL verification.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
-- No new CommerceML run can be registered while the initial snapshot is retired.
LOCK TABLE app.one_c_exchange_runs IN SHARE MODE;
CREATE TEMP TABLE initial_snapshot_retirement_result (result jsonb) ON COMMIT DROP;

DO $retirement$
DECLARE
  operation_id constant uuid := 'cc8e1b89-a8cd-4c86-8e2b-97bf9b48fa28';
  operation_at timestamptz := clock_timestamp();
  catalog_run app.one_c_exchange_runs%ROWTYPE;
  offers_run app.one_c_exchange_runs%ROWTYPE;
  expected_products integer;
  actual_products integer;
  closed_prices integer;
  zeroed_balances integer;
  written_events integer;
  retired_products integer;
  before_state jsonb;
  after_state jsonb;
BEGIN
  IF current_database() <> 'an30'
    AND current_database() !~ '^an30_cleanup_scratch_' THEN
    RAISE EXCEPTION 'Wrong database for the initial AN30 snapshot retirement';
  END IF;
  IF EXISTS (SELECT 1 FROM app.audit_log
      WHERE action='integration.one_c.initial_snapshot_retired'
        AND entity_id=operation_id::text) THEN
    INSERT INTO initial_snapshot_retirement_result VALUES
      (jsonb_build_object('status','already_completed','operationId',operation_id));
    RETURN;
  END IF;
  IF (SELECT count(*) FROM app.one_c_exchange_runs WHERE source_key='one_c') <> 2 THEN
    RAISE EXCEPTION 'The primary exchange has new runs: do not retire live data';
  END IF;
  SELECT * INTO STRICT catalog_run FROM app.one_c_exchange_runs
    WHERE source_key='one_c' AND kind='catalog' AND filename='initial-catalog.xml'
      AND status='completed' AND created_at::date=DATE '2026-11-23';
  SELECT * INTO STRICT offers_run FROM app.one_c_exchange_runs
    WHERE source_key='one_c' AND kind='offers' AND filename='initial-offers.xml'
      AND status='completed' AND created_at::date=DATE '2026-11-23';
  CREATE TEMP TABLE initial_snapshot_product_ids ON COMMIT DROP AS
    SELECT DISTINCT item->>'externalId' AS external_id
    FROM jsonb_array_elements(catalog_run.body_rows) item
    WHERE item->>'entityType'='product';
  SELECT count(*) INTO expected_products FROM initial_snapshot_product_ids;
  IF expected_products=0 OR EXISTS (SELECT 1 FROM initial_snapshot_product_ids
      WHERE external_id IS NULL OR external_id !~ '^00-[0-9]+$') THEN
    RAISE EXCEPTION 'The initial list-export product identifiers are not recognised';
  END IF;
  CREATE TEMP TABLE initial_snapshot_products ON COMMIT DROP AS
    SELECT p.id FROM app.products p JOIN initial_snapshot_product_ids old
      ON old.external_id=p.external_id WHERE p.one_c_source='one_c';
  SELECT count(*) INTO actual_products FROM initial_snapshot_products;
  IF actual_products<>expected_products THEN
    RAISE EXCEPTION 'Initial product identities have changed: expected %, found %',
      expected_products,actual_products;
  END IF;
  PERFORM p.id FROM app.products p JOIN initial_snapshot_products old ON old.id=p.id
    ORDER BY p.id FOR UPDATE OF p;
  PERFORM b.product_id FROM app.inventory_balances b
    JOIN initial_snapshot_products old ON old.id=b.product_id
    ORDER BY b.product_id,b.warehouse_id FOR UPDATE OF b;
  IF EXISTS (SELECT 1 FROM app.products p JOIN initial_snapshot_products old ON old.id=p.id
      WHERE p.source_version<>1 OR NOT p.is_active OR p.deleted_at IS NOT NULL OR p.is_demo) THEN
    RAISE EXCEPTION 'Initial products have been changed; retirement cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM app.order_items i JOIN initial_snapshot_products old ON old.id=i.product_id)
    OR EXISTS (SELECT 1 FROM app.inventory_balances b JOIN initial_snapshot_products old ON old.id=b.product_id
      WHERE b.quantity_reserved<>0 OR b.source_version<>1
        OR b.updated_at>offers_run.updated_at+interval '1 minute') THEN
    RAISE EXCEPTION 'Orders, reservations or fresh inventory exist; retirement cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM app.product_prices p JOIN initial_snapshot_products old ON old.id=p.product_id
      WHERE p.valid_to IS NULL AND (p.source<>'1c' OR p.valid_from>=operation_at
        OR p.created_at>offers_run.updated_at+interval '1 minute')) THEN
    RAISE EXCEPTION 'Manual or fresh prices exist; retirement cancelled';
  END IF;
  SELECT jsonb_build_object(
    'products',actual_products,
    'currentPrices',(SELECT count(*) FROM app.product_prices p JOIN initial_snapshot_products old ON old.id=p.product_id WHERE p.valid_to IS NULL),
    'positiveBalances',(SELECT count(*) FROM app.inventory_balances b JOIN initial_snapshot_products old ON old.id=b.product_id WHERE b.quantity_on_hand>0),
    'catalogueCards',(SELECT count(*) FROM app.product_catalogue_cards),
    'crosses',(SELECT count(*) FROM app.article_crosses),
    'users',(SELECT count(*) FROM app.users)
  ) INTO before_state;
  UPDATE app.product_prices p SET valid_to=operation_at
    FROM initial_snapshot_products old WHERE old.id=p.product_id AND p.valid_to IS NULL;
  GET DIAGNOSTICS closed_prices=ROW_COUNT;
  INSERT INTO app.inventory_events(product_id,warehouse_id,event_type,
    delta_on_hand,delta_reserved,resulting_on_hand,resulting_reserved,reference_type,reference_id)
    SELECT b.product_id,b.warehouse_id,'manual_adjustment',-b.quantity_on_hand,0,0,0,
      'one_c_initial_snapshot_retirement',operation_id
    FROM app.inventory_balances b JOIN initial_snapshot_products old ON old.id=b.product_id
    WHERE b.quantity_on_hand>0;
  GET DIAGNOSTICS written_events=ROW_COUNT;
  UPDATE app.inventory_balances b SET quantity_on_hand=0,source_version=source_version+1
    FROM initial_snapshot_products old WHERE old.id=b.product_id AND b.quantity_on_hand>0;
  GET DIAGNOSTICS zeroed_balances=ROW_COUNT;
  IF zeroed_balances<>written_events THEN RAISE EXCEPTION 'Inventory ledger mismatch'; END IF;
  UPDATE app.products p SET is_active=false,deleted_at=operation_at,source_version=source_version+1
    FROM initial_snapshot_products old WHERE old.id=p.id;
  GET DIAGNOSTICS retired_products=ROW_COUNT;
  IF retired_products<>expected_products THEN RAISE EXCEPTION 'Product retirement count mismatch'; END IF;
  SELECT jsonb_build_object(
    'retiredProducts',retired_products,'closedPrices',closed_prices,'zeroedBalances',zeroed_balances,
    'catalogueCards',(SELECT count(*) FROM app.product_catalogue_cards),
    'crosses',(SELECT count(*) FROM app.article_crosses),'users',(SELECT count(*) FROM app.users)
  ) INTO after_state;
  IF before_state->'catalogueCards' IS DISTINCT FROM after_state->'catalogueCards'
    OR before_state->'crosses' IS DISTINCT FROM after_state->'crosses'
    OR before_state->'users' IS DISTINCT FROM after_state->'users' THEN
    RAISE EXCEPTION 'Unrelated data changed';
  END IF;
  INSERT INTO app.audit_log(action,entity_type,entity_id,before_state,after_state,metadata)
    VALUES ('integration.one_c.initial_snapshot_retired','one_c_initial_snapshot',operation_id::text,
      before_state,after_state,jsonb_build_object(
        'requestedBy','owner chat 2026-11-28','source','one_c',
        'catalogRunId',catalog_run.id,'offersRunId',offers_run.id,
        'method','soft deletion; close prices; inventory ledger adjustment',
        'preserved','IDs, history, media, crosses, vehicles, users, settings'));
  INSERT INTO initial_snapshot_retirement_result VALUES
    (jsonb_build_object('status','completed','operationId',operation_id,
      'at',operation_at,'before',before_state,'after',after_state));
END
$retirement$;
SELECT result FROM initial_snapshot_retirement_result;
COMMIT;
