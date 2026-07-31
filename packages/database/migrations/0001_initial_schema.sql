CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA app;

CREATE TYPE app.app_role AS ENUM ('customer', 'manager', 'director', 'admin');
CREATE TYPE app.user_status AS ENUM ('pending_email', 'active', 'suspended', 'disabled');
CREATE TYPE app.staff_status AS ENUM ('invited', 'active', 'suspended', 'terminated');
CREATE TYPE app.order_status AS ENUM (
  'pending_payment',
  'paid',
  'processing',
  'awaiting_delivery_terms',
  'ready',
  'completed',
  'cancelled',
  'refunded'
);
CREATE TYPE app.payment_status AS ENUM (
  'pending',
  'authorized',
  'succeeded',
  'failed',
  'cancelled',
  'partially_refunded',
  'refunded'
);
CREATE TYPE app.payment_kind AS ENUM ('goods', 'delivery', 'manual_adjustment');
CREATE TYPE app.refund_status AS ENUM ('pending', 'succeeded', 'failed', 'cancelled');
CREATE TYPE app.reservation_status AS ENUM ('active', 'consumed', 'expired', 'released', 'cancelled');
CREATE TYPE app.inventory_event_type AS ENUM (
  'import_set',
  'manual_adjustment',
  'reservation_created',
  'reservation_released',
  'order_consumed',
  'return_received'
);
CREATE TYPE app.chat_thread_status AS ENUM ('open', 'waiting_customer', 'waiting_staff', 'closed');
CREATE TYPE app.chat_message_type AS ENUM ('text', 'system', 'attachment');
CREATE TYPE app.storage_status AS ENUM ('pending', 'available', 'quarantined', 'deleted');
CREATE TYPE app.scan_status AS ENUM ('pending', 'clean', 'rejected', 'failed');
CREATE TYPE app.import_status AS ENUM (
  'uploaded',
  'validating',
  'validated',
  'applying',
  'applied',
  'failed',
  'rolled_back'
);
CREATE TYPE app.import_row_status AS ENUM ('pending', 'valid', 'invalid', 'applied', 'skipped');
CREATE TYPE app.job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE app.outbox_status AS ENUM ('pending', 'processing', 'delivered', 'failed');
CREATE TYPE app.invoice_status AS ENUM ('draft', 'issued', 'cancelled');

CREATE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION app.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  phone text,
  display_name text,
  password_hash text,
  status app.user_status NOT NULL DEFAULT 'pending_email',
  email_verified_at timestamptz,
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
  session_invalid_before timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT users_email_trimmed CHECK (email::text = btrim(email::text)),
  CONSTRAINT users_phone_trimmed CHECK (phone IS NULL OR phone = btrim(phone))
);
CREATE UNIQUE INDEX users_phone_active_uidx ON app.users (phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX users_status_idx ON app.users (status) WHERE deleted_at IS NULL;

CREATE TABLE app.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  recipient_name text NOT NULL,
  phone text NOT NULL,
  postal_code text,
  region text NOT NULL,
  city text NOT NULL,
  street text NOT NULL,
  house text NOT NULL,
  apartment text,
  delivery_note text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX customer_addresses_one_default_uidx ON app.customer_addresses (user_id)
  WHERE is_default AND deleted_at IS NULL;
CREATE INDEX customer_addresses_user_idx ON app.customer_addresses (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE app.staff_members (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE RESTRICT,
  role app.app_role NOT NULL CHECK (role <> 'customer'),
  status app.staff_status NOT NULL DEFAULT 'invited',
  employee_code text UNIQUE,
  position_title text,
  invited_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  hired_at date,
  terminated_at date,
  totp_secret_ciphertext bytea,
  totp_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT staff_totp_pair CHECK (
    (totp_secret_ciphertext IS NULL AND totp_confirmed_at IS NULL)
    OR totp_secret_ciphertext IS NOT NULL
  )
);
CREATE INDEX staff_members_role_status_idx ON app.staff_members (role, status);

CREATE TABLE app.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  role app.app_role NOT NULL CHECK (role <> 'customer'),
  token_hash bytea NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT staff_invitations_expiry CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX staff_invitations_pending_email_uidx ON app.staff_invitations (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE app.staff_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.staff_members(user_id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, code_hash)
);
CREATE INDEX staff_recovery_codes_unused_idx ON app.staff_recovery_codes (user_id)
  WHERE used_at IS NULL;

CREATE TABLE app.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  session_hash bytea NOT NULL UNIQUE,
  csrf_token_hash bytea NOT NULL,
  rotated_from_id uuid REFERENCES app.auth_sessions(id) ON DELETE SET NULL,
  ip_address inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT auth_sessions_expiry CHECK (
    expires_at > created_at AND idle_expires_at <= expires_at
  )
);
CREATE INDEX auth_sessions_user_active_idx ON app.auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expiry_idx ON app.auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE app.email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT email_verification_expiry CHECK (expires_at > created_at)
);
CREATE INDEX email_verification_tokens_user_idx ON app.email_verification_tokens (user_id, expires_at DESC)
  WHERE used_at IS NULL;

CREATE TABLE app.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip inet,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT password_reset_expiry CHECK (expires_at > created_at)
);
CREATE INDEX password_reset_tokens_user_idx ON app.password_reset_tokens (user_id, expires_at DESC)
  WHERE used_at IS NULL;

CREATE TABLE app.auth_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email citext,
  ip_address inet,
  purpose text NOT NULL,
  succeeded boolean NOT NULL,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX auth_attempts_rate_limit_idx ON app.auth_attempts (purpose, ip_address, created_at DESC);
CREATE INDEX auth_attempts_email_idx ON app.auth_attempts (email, created_at DESC) WHERE email IS NOT NULL;

CREATE TABLE app.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX brands_external_id_uidx ON app.brands (external_id) WHERE external_id IS NOT NULL;

CREATE TABLE app.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  parent_id uuid REFERENCES app.categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT categories_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX categories_external_id_uidx ON app.categories (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX categories_parent_sort_idx ON app.categories (parent_id, sort_order, name)
  WHERE deleted_at IS NULL AND is_active;

CREATE TABLE app.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  sku citext NOT NULL,
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  brand_id uuid REFERENCES app.brands(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES app.categories(id) ON DELETE RESTRICT,
  description text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_text text,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT products_attributes_object CHECK (jsonb_typeof(attributes) = 'object')
);
CREATE UNIQUE INDEX products_sku_active_uidx ON app.products (sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_external_id_uidx ON app.products (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX products_catalog_idx ON app.products (category_id, is_active, name) WHERE deleted_at IS NULL;
CREATE INDEX products_brand_idx ON app.products (brand_id, name) WHERE deleted_at IS NULL;
CREATE INDEX products_search_idx ON app.products USING gin (to_tsvector('simple', coalesce(search_text, name)));

CREATE TABLE app.storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'local',
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 bytea NOT NULL,
  status app.storage_status NOT NULL DEFAULT 'pending',
  owner_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (provider, sha256, byte_size)
);
CREATE INDEX storage_objects_owner_idx ON app.storage_objects (owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE app.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  storage_object_id uuid NOT NULL REFERENCES app.storage_objects(id) ON DELETE RESTRICT,
  alt_text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (product_id, storage_object_id)
);
CREATE UNIQUE INDEX product_images_primary_uidx ON app.product_images (product_id) WHERE is_primary;
CREATE INDEX product_images_sort_idx ON app.product_images (product_id, sort_order, created_at);

CREATE TABLE app.catalog_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT '1c',
  external_batch_id text NOT NULL,
  payload_checksum bytea NOT NULL,
  status app.import_status NOT NULL DEFAULT 'uploaded',
  uploaded_object_id uuid REFERENCES app.storage_objects(id) ON DELETE RESTRICT,
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  invalid_rows integer NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  applied_rows integer NOT NULL DEFAULT 0 CHECK (applied_rows >= 0),
  error_summary jsonb,
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  validated_at timestamptz,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source, external_batch_id),
  UNIQUE (source, payload_checksum),
  CONSTRAINT catalog_import_counts CHECK (valid_rows + invalid_rows <= total_rows AND applied_rows <= valid_rows)
);
CREATE INDEX catalog_import_batches_status_idx ON app.catalog_import_batches (status, uploaded_at DESC);

CREATE TABLE app.catalog_import_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES app.catalog_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  entity_type text NOT NULL,
  external_id text,
  payload jsonb NOT NULL,
  payload_checksum bytea NOT NULL,
  status app.import_row_status NOT NULL DEFAULT 'pending',
  validation_errors jsonb,
  applied_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (batch_id, row_number),
  CONSTRAINT catalog_import_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX catalog_import_rows_batch_status_idx ON app.catalog_import_rows (batch_id, status, row_number);
CREATE INDEX catalog_import_rows_external_idx ON app.catalog_import_rows (entity_type, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE app.catalog_import_conflicts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES app.catalog_import_batches(id) ON DELETE CASCADE,
  import_row_id bigint REFERENCES app.catalog_import_rows(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  external_id text,
  conflict_code text NOT NULL,
  current_value jsonb,
  incoming_value jsonb,
  resolution text,
  resolved_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX catalog_import_conflicts_open_idx ON app.catalog_import_conflicts (batch_id, conflict_code)
  WHERE resolved_at IS NULL;

CREATE TABLE app.catalog_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL UNIQUE REFERENCES app.catalog_import_batches(id) ON DELETE RESTRICT,
  revision_number bigint NOT NULL UNIQUE CHECK (revision_number > 0),
  applied_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rolled_back_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  rolled_back_at timestamptz
);

CREATE TABLE app.product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  amount_kopeks bigint NOT NULL CHECK (amount_kopeks >= 0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_to timestamptz,
  source text NOT NULL DEFAULT '1c',
  import_batch_id uuid REFERENCES app.catalog_import_batches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT product_prices_period CHECK (valid_to IS NULL OR valid_to > valid_from),
  UNIQUE (product_id, valid_from)
);
CREATE UNIQUE INDEX product_prices_current_uidx ON app.product_prices (product_id, currency)
  WHERE valid_to IS NULL;
CREATE INDEX product_prices_history_idx ON app.product_prices (product_id, valid_from DESC);

CREATE TABLE app.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX warehouses_external_id_uidx ON app.warehouses (external_id) WHERE external_id IS NOT NULL;

CREATE TABLE app.inventory_balances (
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id) ON DELETE RESTRICT,
  quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved integer NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (product_id, warehouse_id),
  CONSTRAINT inventory_reserved_available CHECK (quantity_reserved <= quantity_on_hand)
);
CREATE INDEX inventory_available_idx ON app.inventory_balances (warehouse_id, product_id)
  WHERE quantity_on_hand > quantity_reserved;

CREATE TABLE app.inventory_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id) ON DELETE RESTRICT,
  event_type app.inventory_event_type NOT NULL,
  delta_on_hand integer NOT NULL DEFAULT 0,
  delta_reserved integer NOT NULL DEFAULT 0,
  resulting_on_hand integer NOT NULL CHECK (resulting_on_hand >= 0),
  resulting_reserved integer NOT NULL CHECK (resulting_reserved >= 0),
  reference_type text,
  reference_id uuid,
  import_batch_id uuid REFERENCES app.catalog_import_batches(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_event_result CHECK (resulting_reserved <= resulting_on_hand),
  CONSTRAINT inventory_event_delta CHECK (delta_on_hand <> 0 OR delta_reserved <> 0)
);
CREATE INDEX inventory_events_product_idx ON app.inventory_events (product_id, warehouse_id, created_at DESC);
CREATE INDEX inventory_events_reference_idx ON app.inventory_events (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE TABLE app.stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  guest_token_hash bytea,
  idempotency_key text NOT NULL UNIQUE,
  status app.reservation_status NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT stock_reservations_owner CHECK (user_id IS NOT NULL OR guest_token_hash IS NOT NULL),
  CONSTRAINT stock_reservations_expiry CHECK (expires_at > created_at)
);
CREATE INDEX stock_reservations_expiry_idx ON app.stock_reservations (expires_at)
  WHERE status = 'active';
CREATE INDEX stock_reservations_user_idx ON app.stock_reservations (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TABLE app.stock_reservation_items (
  reservation_id uuid NOT NULL REFERENCES app.stock_reservations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_kopeks bigint NOT NULL CHECK (unit_price_kopeks >= 0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (reservation_id, product_id, warehouse_id)
);

CREATE TABLE app.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  public_number text NOT NULL UNIQUE,
  user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  reservation_id uuid UNIQUE REFERENCES app.stock_reservations(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  status app.order_status NOT NULL DEFAULT 'pending_payment',
  customer_email citext NOT NULL,
  customer_phone text NOT NULL,
  customer_name text NOT NULL,
  contact_snapshot jsonb NOT NULL,
  delivery_snapshot jsonb,
  currency char(3) NOT NULL DEFAULT 'RUB',
  subtotal_kopeks bigint NOT NULL CHECK (subtotal_kopeks >= 0),
  discount_kopeks bigint NOT NULL DEFAULT 0 CHECK (discount_kopeks >= 0),
  delivery_amount_kopeks bigint NOT NULL DEFAULT 0 CHECK (delivery_amount_kopeks >= 0),
  total_amount_kopeks bigint NOT NULL CHECK (total_amount_kopeks >= 0),
  paid_amount_kopeks bigint NOT NULL DEFAULT 0 CHECK (paid_amount_kopeks >= 0),
  customer_note text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT orders_total_math CHECK (
    total_amount_kopeks = subtotal_kopeks - discount_kopeks + delivery_amount_kopeks
  ),
  CONSTRAINT orders_discount_limit CHECK (discount_kopeks <= subtotal_kopeks),
  CONSTRAINT orders_paid_limit CHECK (paid_amount_kopeks <= total_amount_kopeks),
  CONSTRAINT orders_contact_object CHECK (jsonb_typeof(contact_snapshot) = 'object'),
  CONSTRAINT orders_delivery_object CHECK (delivery_snapshot IS NULL OR jsonb_typeof(delivery_snapshot) = 'object')
);
CREATE INDEX orders_user_created_idx ON app.orders (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX orders_staff_queue_idx ON app.orders (status, created_at);
CREATE INDEX orders_customer_email_idx ON app.orders (customer_email, created_at DESC);

CREATE TABLE app.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES app.products(id) ON DELETE RESTRICT,
  sku_snapshot text NOT NULL,
  name_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_kopeks bigint NOT NULL CHECK (unit_price_kopeks >= 0),
  line_total_kopeks bigint GENERATED ALWAYS AS (quantity::bigint * unit_price_kopeks) STORED,
  currency char(3) NOT NULL DEFAULT 'RUB',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX order_items_order_idx ON app.order_items (order_id);
CREATE INDEX order_items_product_idx ON app.order_items (product_id) WHERE product_id IS NOT NULL;

CREATE TABLE app.order_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  from_status app.order_status,
  to_status app.order_status NOT NULL,
  reason text,
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT order_status_changed CHECK (from_status IS NULL OR from_status <> to_status)
);
CREATE INDEX order_status_history_order_idx ON app.order_status_history (order_id, created_at);

CREATE TABLE app.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  kind app.payment_kind NOT NULL DEFAULT 'goods',
  provider text NOT NULL,
  external_payment_id text,
  idempotency_key text NOT NULL,
  status app.payment_status NOT NULL DEFAULT 'pending',
  amount_kopeks bigint NOT NULL CHECK (amount_kopeks > 0),
  refunded_amount_kopeks bigint NOT NULL DEFAULT 0 CHECK (refunded_amount_kopeks >= 0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_code text,
  failure_message text,
  authorized_at timestamptz,
  succeeded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, idempotency_key),
  CONSTRAINT payments_refund_limit CHECK (refunded_amount_kopeks <= amount_kopeks),
  CONSTRAINT payments_metadata_object CHECK (jsonb_typeof(provider_metadata) = 'object')
);
CREATE UNIQUE INDEX payments_provider_external_uidx ON app.payments (provider, external_payment_id)
  WHERE external_payment_id IS NOT NULL;
CREATE INDEX payments_order_idx ON app.payments (order_id, created_at DESC);
CREATE INDEX payments_status_idx ON app.payments (status, created_at);

CREATE TABLE app.payment_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  payment_id uuid REFERENCES app.payments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload_checksum bytea NOT NULL,
  signature_valid boolean NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, external_event_id),
  CONSTRAINT payment_webhook_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX payment_webhook_unprocessed_idx ON app.payment_webhook_events (received_at)
  WHERE processed_at IS NULL;

CREATE TABLE app.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES app.payments(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  external_refund_id text,
  idempotency_key text NOT NULL,
  status app.refund_status NOT NULL DEFAULT 'pending',
  amount_kopeks bigint NOT NULL CHECK (amount_kopeks > 0),
  reason text NOT NULL,
  requested_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  succeeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, idempotency_key)
);
CREATE UNIQUE INDEX refunds_provider_external_uidx ON app.refunds (provider, external_refund_id)
  WHERE external_refund_id IS NOT NULL;
CREATE INDEX refunds_payment_idx ON app.refunds (payment_id, created_at DESC);

CREATE TABLE app.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb,
  resource_type text,
  resource_id uuid,
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (scope, key),
  CONSTRAINT idempotency_expiry CHECK (expires_at > created_at)
);
CREATE INDEX idempotency_keys_expiry_idx ON app.idempotency_keys (expires_at);

CREATE TABLE app.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  guest_token_hash bytea,
  order_id uuid REFERENCES app.orders(id) ON DELETE SET NULL,
  assigned_staff_id uuid REFERENCES app.staff_members(user_id) ON DELETE SET NULL,
  status app.chat_thread_status NOT NULL DEFAULT 'open',
  subject text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT chat_threads_customer CHECK (customer_user_id IS NOT NULL OR guest_token_hash IS NOT NULL)
);
CREATE INDEX chat_threads_staff_queue_idx ON app.chat_threads (status, last_message_at DESC NULLS LAST);
CREATE INDEX chat_threads_customer_idx ON app.chat_threads (customer_user_id, created_at DESC)
  WHERE customer_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE app.chat_participants (
  thread_id uuid NOT NULL REFERENCES app.chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  left_at timestamptz,
  last_read_at timestamptz,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE app.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES app.chat_threads(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  sender_kind text NOT NULL CHECK (sender_kind IN ('customer', 'staff', 'system')),
  message_type app.chat_message_type NOT NULL DEFAULT 'text',
  body text,
  client_message_id text,
  reply_to_id uuid REFERENCES app.chat_messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chat_message_sender CHECK (
    (sender_kind = 'system' AND sender_user_id IS NULL)
    OR (sender_kind <> 'system' AND sender_user_id IS NOT NULL)
  ),
  CONSTRAINT chat_message_body CHECK (message_type <> 'text' OR nullif(btrim(body), '') IS NOT NULL)
);
CREATE UNIQUE INDEX chat_messages_client_uidx ON app.chat_messages (thread_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX chat_messages_thread_idx ON app.chat_messages (thread_id, created_at, id);

CREATE TABLE app.chat_message_receipts (
  message_id uuid NOT NULL REFERENCES app.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  delivered_at timestamptz,
  read_at timestamptz,
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT chat_receipt_order CHECK (read_at IS NULL OR delivered_at IS NOT NULL)
);
CREATE INDEX chat_receipts_unread_idx ON app.chat_message_receipts (user_id, message_id)
  WHERE read_at IS NULL;

CREATE TABLE app.chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES app.chat_messages(id) ON DELETE CASCADE,
  storage_object_id uuid NOT NULL REFERENCES app.storage_objects(id) ON DELETE RESTRICT,
  scan_status app.scan_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (message_id, storage_object_id)
);
CREATE INDEX chat_attachments_scan_idx ON app.chat_attachments (scan_status, created_at)
  WHERE scan_status IN ('pending', 'failed');

CREATE TABLE app.content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug citext NOT NULL UNIQUE,
  title text NOT NULL,
  body jsonb NOT NULL,
  seo_title text,
  seo_description text,
  is_published boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  published_at timestamptz,
  created_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT content_pages_body_object CHECK (jsonb_typeof(body) IN ('object', 'array'))
);
CREATE INDEX content_pages_public_idx ON app.content_pages (slug)
  WHERE is_published AND deleted_at IS NULL;

CREATE TABLE app.banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement text NOT NULL,
  title text NOT NULL,
  body text,
  image_object_id uuid REFERENCES app.storage_objects(id) ON DELETE RESTRICT,
  target_url text,
  sort_order integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT banners_period CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX banners_active_idx ON app.banners (placement, sort_order)
  WHERE is_active AND deleted_at IS NULL;

CREATE TABLE app.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.integration_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT false,
  username text,
  secret_ciphertext bytea,
  allowed_networks cidr[] NOT NULL DEFAULT ARRAY[]::cidr[],
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT integration_settings_object CHECK (jsonb_typeof(settings) = 'object')
);

CREATE TABLE app.attendance_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_user_id uuid NOT NULL REFERENCES app.staff_members(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('clock_in', 'clock_out', 'break_start', 'break_end', 'correction')),
  occurred_at timestamptz NOT NULL,
  note text,
  recorded_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX attendance_events_staff_idx ON app.attendance_events (staff_user_id, occurred_at DESC);

CREATE TABLE app.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES app.orders(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  status app.invoice_status NOT NULL DEFAULT 'draft',
  amount_kopeks bigint NOT NULL CHECK (amount_kopeks >= 0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  document_object_id uuid REFERENCES app.storage_objects(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX invoices_order_idx ON app.invoices (order_id, created_at DESC) WHERE order_id IS NOT NULL;

CREATE TABLE app.report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status app.job_status NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  result_object_id uuid REFERENCES app.storage_objects(id) ON DELETE RESTRICT,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT report_parameters_object CHECK (jsonb_typeof(parameters) = 'object')
);
CREATE INDEX report_runs_queue_idx ON app.report_runs (status, created_at);
CREATE INDEX report_runs_requester_idx ON app.report_runs (requested_by, created_at DESC);

CREATE TABLE app.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status app.outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  CONSTRAINT outbox_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX outbox_delivery_idx ON app.outbox_events (available_at, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX outbox_aggregate_idx ON app.outbox_events (aggregate_type, aggregate_id, created_at);

CREATE TABLE app.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  actor_role app.app_role,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  request_id uuid,
  ip_address inet,
  user_agent text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_log_entity_idx ON app.audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_actor_idx ON app.audit_log (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_log_request_idx ON app.audit_log (request_id) WHERE request_id IS NOT NULL;

CREATE VIEW app.current_product_prices
WITH (security_invoker = true)
AS
SELECT product_id, amount_kopeks, currency, valid_from, source, import_batch_id
FROM app.product_prices
WHERE valid_to IS NULL;

CREATE VIEW app.available_inventory
WITH (security_invoker = true)
AS
SELECT
  product_id,
  warehouse_id,
  quantity_on_hand,
  quantity_reserved,
  quantity_on_hand - quantity_reserved AS quantity_available,
  source_version,
  updated_at
FROM app.inventory_balances;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER customer_addresses_set_updated_at BEFORE UPDATE ON app.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER staff_members_set_updated_at BEFORE UPDATE ON app.staff_members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON app.brands
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON app.categories
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON app.products
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER storage_objects_set_updated_at BEFORE UPDATE ON app.storage_objects
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER catalog_import_batches_set_updated_at BEFORE UPDATE ON app.catalog_import_batches
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER warehouses_set_updated_at BEFORE UPDATE ON app.warehouses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER inventory_balances_set_updated_at BEFORE UPDATE ON app.inventory_balances
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER stock_reservations_set_updated_at BEFORE UPDATE ON app.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refunds_set_updated_at BEFORE UPDATE ON app.refunds
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER chat_threads_set_updated_at BEFORE UPDATE ON app.chat_threads
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER content_pages_set_updated_at BEFORE UPDATE ON app.content_pages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER banners_set_updated_at BEFORE UPDATE ON app.banners
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER site_settings_set_updated_at BEFORE UPDATE ON app.site_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER integration_endpoints_set_updated_at BEFORE UPDATE ON app.integration_endpoints
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER report_runs_set_updated_at BEFORE UPDATE ON app.report_runs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER inventory_events_append_only
  BEFORE UPDATE OR DELETE ON app.inventory_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON app.order_status_history
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
CREATE TRIGGER attendance_events_append_only
  BEFORE UPDATE OR DELETE ON app.attendance_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

COMMENT ON SCHEMA app IS 'Autonomous AN-30 application data. No production Supabase data is migrated here.';
COMMENT ON COLUMN app.products.is_demo IS 'Must be true only for records created by the development seed.';
COMMENT ON COLUMN app.orders.contact_snapshot IS 'Immutable order-time contact snapshot; never trust browser totals.';
COMMENT ON COLUMN app.order_items.unit_price_kopeks IS 'Immutable server-side price snapshot in integer kopeks.';
COMMENT ON TABLE app.audit_log IS 'Append-only audit trail. UPDATE and DELETE are rejected by trigger.';
