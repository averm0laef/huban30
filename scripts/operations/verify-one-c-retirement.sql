\set ON_ERROR_STOP on
DO $verify$
BEGIN
  IF current_database() !~ '^an30_cleanup_scratch_' THEN
    RAISE EXCEPTION 'This verification is forbidden outside a scratch database';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM app.products WHERE external_id='00-00001'
      AND NOT is_active AND deleted_at IS NOT NULL AND source_version=2) THEN
    RAISE EXCEPTION 'Initial product was not retired';
  END IF;
  IF (SELECT count(*) FROM app.products)<>3
    OR (SELECT count(*) FROM app.products WHERE is_active AND deleted_at IS NULL)<>2
    OR (SELECT count(*) FROM app.product_prices WHERE valid_to IS NULL)<>2
    OR (SELECT count(*) FROM app.inventory_balances WHERE quantity_on_hand=7)<>2
    OR (SELECT count(*) FROM app.product_catalogue_cards)<>1
    OR (SELECT count(*) FROM app.audit_log WHERE action='integration.one_c.initial_snapshot_retired')<>1
    OR (SELECT count(*) FROM app.inventory_events WHERE reference_type='one_c_initial_snapshot_retirement')<>1 THEN
    RAISE EXCEPTION 'Retirement touched the wrong scope or lost related data';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.inventory_events WHERE
    product_id='10000000-0000-4000-8000-000000000001'
    AND delta_on_hand=-7 AND resulting_on_hand=0) THEN
    RAISE EXCEPTION 'Retirement did not preserve the inventory ledger';
  END IF;
END
$verify$;
SELECT 'scope, history, related photo, other source, fresh product and idempotency verified' AS result;
