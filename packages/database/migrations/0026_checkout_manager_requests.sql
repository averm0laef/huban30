-- The owner's direction (repeated, explicit): "Пока без оплаты! просто
-- создания заявок для менеджеров!" -- no payment gateway, no reservation
-- held by a silently-expiring timer. Checkout now creates a manager
-- request ("заявка"): price and stock are still re-read and confirmed
-- server-side at submission, but nothing is charged and nothing is held
-- pending a timer. A human (the manager) confirms the order by phone and
-- only then moves it forward.
--
-- Nothing in app.orders can carry a payment-only status before this
-- migration runs: the public checkout has never been reachable outside a
-- development sandbox (ENABLE_PUBLIC_CHECKOUT defaults to false, and the
-- app refuses to boot with production + public checkout + the sandbox
-- provider -- see the removed PAYMENTS_PROVIDER gate in config.ts). A
-- developer's local database can still carry leftover rows from a manual
-- checkout-smoke.ts run; the enum swap below fails loudly on those rather
-- than guessing a replacement status, which is the correct outcome for a
-- disposable local dev database (recreate it with `docker compose down -v`).
ALTER TABLE app.orders ALTER COLUMN status DROP DEFAULT;

ALTER TYPE app.order_status RENAME TO order_status_with_payment_states;
CREATE TYPE app.order_status AS ENUM (
  'awaiting_confirmation',
  'processing',
  'awaiting_delivery_terms',
  'ready',
  'completed',
  'cancelled'
);

ALTER TABLE app.orders
  ALTER COLUMN status TYPE app.order_status USING status::text::app.order_status;
ALTER TABLE app.orders ALTER COLUMN status SET DEFAULT 'awaiting_confirmation';

ALTER TABLE app.order_status_history
  ALTER COLUMN from_status TYPE app.order_status USING from_status::text::app.order_status,
  ALTER COLUMN to_status TYPE app.order_status USING to_status::text::app.order_status;

DROP TYPE app.order_status_with_payment_states;

-- Guest checkout access used to ride on the stock reservation row (its
-- guest_token_hash). Now that checkout no longer creates a reservation,
-- the same opaque-token-as-HMAC pattern moves directly onto the order.
ALTER TABLE app.orders ADD COLUMN guest_token_hash bytea;
ALTER TABLE app.orders
  ADD CONSTRAINT orders_guest_token_hash_length
  CHECK (guest_token_hash IS NULL OR octet_length(guest_token_hash) = 32);

-- Drops the FK, its supporting unique index and the column in one step.
ALTER TABLE app.orders DROP COLUMN reservation_id;

-- The reservation-with-TTL machinery: no longer created by checkout, and
-- the owner explicitly rejected keeping a timer-based hold around "just in
-- case". Nothing else references these tables (see the FK sweep in
-- 0006/0010/0014 -- only orders.reservation_id and the payment webhook
-- pointed at them, both already gone).
DROP FUNCTION app.expire_stock_reservations(integer);
DROP TABLE app.stock_reservation_items;
DROP TABLE app.stock_reservations;
DROP TYPE app.reservation_status;

-- The sandbox payment path (provider, controllers, service) is removed in
-- this same change; these tables existed only to back it and nothing else
-- reads or writes them. Refunds and webhook events are payment-only, so
-- they go first, then payments itself.
DROP TABLE app.payment_webhook_events;
DROP TABLE app.refunds;
DROP TABLE app.payments;
DROP TYPE app.payment_kind;
DROP TYPE app.payment_status;
DROP TYPE app.refund_status;

COMMENT ON COLUMN app.orders.guest_token_hash IS
  'Purpose-separated HMAC of the opaque guest access token handed to the browser at checkout (see CryptoService.deriveOpaqueToken("guest-order-access", ...)). NULL for an order placed by a signed-in customer.';
