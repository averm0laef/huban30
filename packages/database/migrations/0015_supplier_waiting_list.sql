-- Rossko supplier integration (AN30-013): waiting-list requests ("в ожидание").
--
-- A customer's request for a specific supplier part/stock line. This is
-- deliberately its own table, structurally separate from app.contact_requests
-- and from the shop's own product/price tables: a supplier part is never a
-- catalog product, its price/delivery snapshot never touches
-- app.product_prices or app.inventory_events, and "под заказ" here must never
-- be confused with "в наличии" 1C stock.

CREATE TABLE app.supplier_waitlist_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash bytea NOT NULL,
  user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  supplier text NOT NULL DEFAULT 'rossko' CHECK (supplier IN ('rossko')),
  -- Opaque snapshot of the supplier part/stock line the request was created
  -- for. These are a point-in-time copy (never re-read from the supplier),
  -- exactly like app.order_items snapshots catalog data at checkout time.
  part_guid text NOT NULL,
  part_brand text NOT NULL,
  part_number text NOT NULL,
  part_name text NOT NULL,
  stock_id text NOT NULL,
  price_kopeks bigint NOT NULL CHECK (price_kopeks > 0),
  delivery_time text,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 100),
  customer_name text NOT NULL,
  customer_email citext,
  customer_phone text,
  consent_at timestamptz NOT NULL,
  consent_policy_version text NOT NULL DEFAULT 'supplier-waitlist-consent-v1',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_progress','fulfilled','cancelled')),
  assigned_staff_id uuid REFERENCES app.staff_members(user_id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT supplier_waitlist_requests_contact CHECK (
    customer_email IS NOT NULL OR customer_phone IS NOT NULL
  ),
  CONSTRAINT supplier_waitlist_requests_consent_policy_version CHECK (
    consent_policy_version=btrim(consent_policy_version)
    AND consent_policy_version<>''
  ),
  CONSTRAINT supplier_waitlist_requests_price_safe_integer CHECK (
    price_kopeks<=9007199254740991
  ),
  CONSTRAINT supplier_waitlist_requests_part_guid_trimmed CHECK (part_guid=btrim(part_guid) AND part_guid<>''),
  CONSTRAINT supplier_waitlist_requests_part_brand_trimmed CHECK (part_brand=btrim(part_brand)),
  CONSTRAINT supplier_waitlist_requests_part_number_trimmed CHECK (
    part_number=btrim(part_number) AND part_number<>''
  ),
  CONSTRAINT supplier_waitlist_requests_part_name_trimmed CHECK (part_name=btrim(part_name)),
  CONSTRAINT supplier_waitlist_requests_stock_id_trimmed CHECK (stock_id=btrim(stock_id) AND stock_id<>''),
  CONSTRAINT supplier_waitlist_requests_customer_name_trimmed CHECK (
    customer_name=btrim(customer_name) AND customer_name<>''
  ),
  CONSTRAINT supplier_waitlist_requests_customer_phone_trimmed CHECK (
    customer_phone IS NULL OR customer_phone=btrim(customer_phone)
  ),
  CONSTRAINT supplier_waitlist_requests_delivery_time_trimmed CHECK (
    delivery_time IS NULL OR delivery_time=btrim(delivery_time)
  ),
  CONSTRAINT supplier_waitlist_requests_hash_length CHECK (octet_length(request_hash)=32)
);

CREATE INDEX supplier_waitlist_requests_staff_queue_idx
  ON app.supplier_waitlist_requests (status,created_at DESC);
CREATE INDEX supplier_waitlist_requests_user_idx
  ON app.supplier_waitlist_requests (user_id,created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX supplier_waitlist_requests_assigned_staff_idx
  ON app.supplier_waitlist_requests (assigned_staff_id,created_at DESC)
  WHERE assigned_staff_id IS NOT NULL;

CREATE TRIGGER supplier_waitlist_requests_set_updated_at
BEFORE UPDATE ON app.supplier_waitlist_requests
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMENT ON TABLE app.supplier_waitlist_requests IS
  'A customer''s request for a supplier ("под заказ") part/stock line. Structurally separate from the shop''s own 1C-sourced catalog, prices and stock.';
COMMENT ON COLUMN app.supplier_waitlist_requests.part_guid IS
  'Opaque supplier part identifier, snapshotted at request time from the supplier search result.';
COMMENT ON COLUMN app.supplier_waitlist_requests.stock_id IS
  'Opaque supplier stock line identifier, snapshotted at request time.';
COMMENT ON COLUMN app.supplier_waitlist_requests.price_kopeks IS
  'Supplier price snapshot in integer kopeks, resolved server-side from the supplier lookup, never accepted from the browser.';
COMMENT ON COLUMN app.supplier_waitlist_requests.delivery_time IS
  'Supplier delivery estimate snapshot ("под заказ"); never a shelf-stock quantity.';
COMMENT ON COLUMN app.supplier_waitlist_requests.consent_policy_version IS
  'Version of the supplier-waitlist consent text accepted by the customer.';
