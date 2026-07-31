ALTER TABLE app.orders
  ADD CONSTRAINT orders_currency_rub CHECK (currency = 'RUB');

ALTER TABLE app.order_items
  ADD CONSTRAINT order_items_currency_rub CHECK (currency = 'RUB');

ALTER TABLE app.stock_reservation_items
  ADD CONSTRAINT stock_reservation_items_currency_rub CHECK (currency = 'RUB');

ALTER TABLE app.payments
  ADD CONSTRAINT payments_currency_rub CHECK (currency = 'RUB');

CREATE UNIQUE INDEX payments_one_live_goods_per_order_uidx
  ON app.payments (order_id)
  WHERE kind = 'goods'
    AND status IN ('pending', 'authorized', 'succeeded', 'partially_refunded', 'refunded');

CREATE FUNCTION app.reject_checkout_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  RAISE EXCEPTION '% is an immutable checkout snapshot', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER stock_reservation_items_immutable
  BEFORE UPDATE OR DELETE ON app.stock_reservation_items
  FOR EACH ROW EXECUTE FUNCTION app.reject_checkout_snapshot_mutation();

CREATE TRIGGER order_items_immutable
  BEFORE UPDATE OR DELETE ON app.order_items
  FOR EACH ROW EXECUTE FUNCTION app.reject_checkout_snapshot_mutation();

CREATE FUNCTION app.expire_stock_reservations(batch_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  balance_record record;
  expired_count integer := 0;
  item_record record;
  order_record record;
  reservation_record record;
BEGIN
  IF batch_limit < 1 OR batch_limit > 1000 THEN
    RAISE EXCEPTION 'batch_limit must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  FOR reservation_record IN
    SELECT reservation.id
    FROM app.stock_reservations AS reservation
    WHERE reservation.status = 'active'
      AND reservation.expires_at <= clock_timestamp()
    ORDER BY reservation.expires_at, reservation.id
    FOR UPDATE SKIP LOCKED
    LIMIT batch_limit
  LOOP
    FOR item_record IN
      SELECT item.product_id, item.warehouse_id, item.quantity
      FROM app.stock_reservation_items AS item
      WHERE item.reservation_id = reservation_record.id
      ORDER BY item.product_id, item.warehouse_id
    LOOP
      UPDATE app.inventory_balances
      SET quantity_reserved = quantity_reserved - item_record.quantity
      WHERE product_id = item_record.product_id
        AND warehouse_id = item_record.warehouse_id
        AND quantity_reserved >= item_record.quantity
      RETURNING quantity_on_hand, quantity_reserved
      INTO balance_record;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation % has an inconsistent inventory balance', reservation_record.id
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO app.inventory_events (
        product_id,
        warehouse_id,
        event_type,
        delta_reserved,
        resulting_on_hand,
        resulting_reserved,
        reference_type,
        reference_id
      ) VALUES (
        item_record.product_id,
        item_record.warehouse_id,
        'reservation_released',
        -item_record.quantity,
        balance_record.quantity_on_hand,
        balance_record.quantity_reserved,
        'reservation_expired',
        reservation_record.id
      );
    END LOOP;

    UPDATE app.stock_reservations
    SET status = 'expired', released_at = clock_timestamp()
    WHERE id = reservation_record.id;

    UPDATE app.payments AS payment
    SET status = 'cancelled',
        cancelled_at = COALESCE(payment.cancelled_at, clock_timestamp()),
        failure_code = COALESCE(payment.failure_code, 'reservation_expired'),
        failure_message = COALESCE(payment.failure_message, 'Stock reservation expired before payment')
    FROM app.orders AS checkout_order
    WHERE checkout_order.reservation_id = reservation_record.id
      AND payment.order_id = checkout_order.id
      AND payment.status IN ('pending', 'authorized');

    FOR order_record IN
      UPDATE app.orders
      SET status = 'cancelled',
          cancelled_at = COALESCE(cancelled_at, clock_timestamp()),
          version = version + 1
      WHERE reservation_id = reservation_record.id
        AND status = 'pending_payment'
      RETURNING id
    LOOP
      INSERT INTO app.order_status_history (order_id, from_status, to_status, reason)
      VALUES (order_record.id, 'pending_payment', 'cancelled', 'reservation_expired');
    END LOOP;

    expired_count := expired_count + 1;
  END LOOP;

  RETURN expired_count;
END;
$$;

COMMENT ON FUNCTION app.expire_stock_reservations(integer)
  IS 'Atomically releases expired reservations and cancels their pending order/payment.';
