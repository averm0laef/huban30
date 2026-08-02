-- Storefront enquiries and private customer browsing history.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX products_name_trgm_idx
  ON app.products USING gin (name gin_trgm_ops)
  WHERE is_active AND deleted_at IS NULL;
CREATE INDEX products_sku_trgm_idx
  ON app.products USING gin ((sku::text) gin_trgm_ops)
  WHERE is_active AND deleted_at IS NULL;

ALTER TABLE app.products
  ADD COLUMN public_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT products_public_attributes_object
    CHECK (jsonb_typeof(public_attributes)='object');

COMMENT ON COLUMN app.products.public_attributes IS
  'Explicitly approved storefront specifications. Raw 1C attributes remain private.';

ALTER TABLE app.orders
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN legal_policy_version text,
  ADD CONSTRAINT orders_legal_acceptance_pair CHECK (
    (terms_accepted_at IS NULL AND legal_policy_version IS NULL)
    OR (terms_accepted_at IS NOT NULL AND legal_policy_version='checkout-terms-v1')
  );

COMMENT ON COLUMN app.orders.terms_accepted_at IS
  'Immutable checkout acceptance timestamp for orders created by the public API.';
COMMENT ON COLUMN app.orders.legal_policy_version IS
  'Version of the terms and privacy notice accepted during checkout.';

CREATE FUNCTION app.preserve_order_legal_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at
    OR NEW.legal_policy_version IS DISTINCT FROM OLD.legal_policy_version THEN
    RAISE EXCEPTION 'order legal acceptance is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_preserve_legal_acceptance
BEFORE UPDATE ON app.orders
FOR EACH ROW EXECUTE FUNCTION app.preserve_order_legal_acceptance();

CREATE TABLE app.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash bytea NOT NULL,
  user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'contacts'
    CHECK (source IN ('contacts','expert_help','vin_request')),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_progress','resolved','closed')),
  customer_name text NOT NULL,
  customer_email citext,
  customer_phone text,
  message text NOT NULL,
  consent_at timestamptz NOT NULL,
  consent_policy_version text NOT NULL DEFAULT 'contact-consent-v1',
  purpose text NOT NULL DEFAULT 'respond_to_customer_request',
  retention_until timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '365 days'),
  anonymized_at timestamptz,
  assigned_staff_id uuid REFERENCES app.staff_members(user_id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT contact_requests_contact CHECK (
    anonymized_at IS NOT NULL OR customer_email IS NOT NULL OR customer_phone IS NOT NULL
  ),
  CONSTRAINT contact_requests_consent_policy_version CHECK (
    consent_policy_version=btrim(consent_policy_version)
    AND consent_policy_version<>''
  ),
  CONSTRAINT contact_requests_purpose CHECK (
    purpose='respond_to_customer_request'
  ),
  CONSTRAINT contact_requests_retention_period CHECK (
    retention_until>consent_at
  ),
  CONSTRAINT contact_requests_anonymized_at_valid CHECK (
    anonymized_at IS NULL OR anonymized_at>=consent_at
  ),
  CONSTRAINT contact_requests_personal_data_state CHECK (
    (
      anonymized_at IS NULL
      AND customer_name<>''
      AND message<>''
    )
    OR (
      anonymized_at IS NOT NULL
      AND user_id IS NULL
      AND customer_name=''
      AND customer_email IS NULL
      AND customer_phone IS NULL
      AND message=''
    )
  ),
  CONSTRAINT contact_requests_hash_length CHECK (octet_length(request_hash)=32),
  CONSTRAINT contact_requests_name_trimmed CHECK (customer_name=btrim(customer_name)),
  CONSTRAINT contact_requests_message_trimmed CHECK (message=btrim(message)),
  CONSTRAINT contact_requests_phone_trimmed CHECK (
    customer_phone IS NULL OR customer_phone=btrim(customer_phone)
  )
);

CREATE INDEX contact_requests_staff_queue_idx
  ON app.contact_requests (status,created_at DESC);
CREATE INDEX contact_requests_user_idx
  ON app.contact_requests (user_id,created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX contact_requests_assigned_staff_idx
  ON app.contact_requests (assigned_staff_id,created_at DESC)
  WHERE assigned_staff_id IS NOT NULL;

CREATE INDEX contact_requests_retention_idx
  ON app.contact_requests (retention_until,id)
  WHERE anonymized_at IS NULL;

CREATE TABLE app.product_views (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  view_count integer NOT NULL DEFAULT 1 CHECK (view_count > 0),
  first_viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id,product_id)
);

CREATE INDEX product_views_recent_idx
  ON app.product_views (user_id,last_viewed_at DESC);
CREATE INDEX product_views_product_idx
  ON app.product_views (product_id);

-- A foreign key needs its columns as the ordered left prefix. The indexes below
-- cover relationships that were previously hidden behind a composite index whose
-- first column belonged to a different foreign key.
CREATE INDEX wishlist_items_product_idx
  ON app.wishlist_items (product_id,user_id);
CREATE INDEX product_images_storage_object_idx
  ON app.product_images (storage_object_id,product_id);
CREATE INDEX inventory_events_warehouse_idx
  ON app.inventory_events (warehouse_id,product_id,created_at DESC);
CREATE INDEX stock_reservation_items_product_idx
  ON app.stock_reservation_items (product_id,warehouse_id);
CREATE INDEX stock_reservation_items_warehouse_idx
  ON app.stock_reservation_items (warehouse_id,product_id);
CREATE INDEX chat_participants_user_idx
  ON app.chat_participants (user_id,thread_id);
CREATE INDEX chat_attachments_storage_object_idx
  ON app.chat_attachments (storage_object_id,message_id);

-- PostgreSQL bigint exceeds JavaScript's exact integer range. Keep every money
-- value that crosses the JSON boundary within Number.MAX_SAFE_INTEGER.
ALTER TABLE app.product_prices
  ADD CONSTRAINT product_prices_amount_safe_integer
    CHECK (amount_kopeks<=9007199254740991) NOT VALID;
ALTER TABLE app.stock_reservation_items
  ADD CONSTRAINT stock_reservation_items_unit_price_safe_integer
    CHECK (unit_price_kopeks<=9007199254740991) NOT VALID;
ALTER TABLE app.orders
  ADD CONSTRAINT orders_money_safe_integer CHECK (
    subtotal_kopeks<=9007199254740991
    AND discount_kopeks<=9007199254740991
    AND delivery_amount_kopeks<=9007199254740991
    AND total_amount_kopeks<=9007199254740991
    AND paid_amount_kopeks<=9007199254740991
  ) NOT VALID;
ALTER TABLE app.order_items
  ADD CONSTRAINT order_items_money_safe_integer CHECK (
    unit_price_kopeks<=9007199254740991
    AND line_total_kopeks<=9007199254740991
  ) NOT VALID;
ALTER TABLE app.payments
  ADD CONSTRAINT payments_money_safe_integer CHECK (
    amount_kopeks<=9007199254740991
    AND refunded_amount_kopeks<=9007199254740991
  ) NOT VALID;
ALTER TABLE app.refunds
  ADD CONSTRAINT refunds_amount_safe_integer
    CHECK (amount_kopeks<=9007199254740991) NOT VALID;
ALTER TABLE app.invoices
  ADD CONSTRAINT invoices_amount_safe_integer
    CHECK (amount_kopeks<=9007199254740991) NOT VALID;

ALTER TABLE app.product_prices VALIDATE CONSTRAINT product_prices_amount_safe_integer;
ALTER TABLE app.stock_reservation_items
  VALIDATE CONSTRAINT stock_reservation_items_unit_price_safe_integer;
ALTER TABLE app.orders VALIDATE CONSTRAINT orders_money_safe_integer;
ALTER TABLE app.order_items VALIDATE CONSTRAINT order_items_money_safe_integer;
ALTER TABLE app.payments VALIDATE CONSTRAINT payments_money_safe_integer;
ALTER TABLE app.refunds VALIDATE CONSTRAINT refunds_amount_safe_integer;
ALTER TABLE app.invoices VALIDATE CONSTRAINT invoices_amount_safe_integer;

CREATE FUNCTION app.anonymize_expired_contact_requests(batch_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  anonymized_count integer;
BEGIN
  IF batch_limit IS NULL OR batch_limit<1 OR batch_limit>5000 THEN
    RAISE EXCEPTION 'batch_limit must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT contact_request.id
    FROM app.contact_requests AS contact_request
    WHERE contact_request.anonymized_at IS NULL
      AND contact_request.retention_until<=clock_timestamp()
    ORDER BY contact_request.retention_until,contact_request.id
    FOR UPDATE SKIP LOCKED
    LIMIT batch_limit
  ), anonymized AS (
    UPDATE app.contact_requests AS contact_request
    SET user_id=NULL,
        customer_name='',
        customer_email=NULL,
        customer_phone=NULL,
        message='',
        request_hash=public.digest(
          'anonymized:' || contact_request.id::text || ':' || clock_timestamp()::text,
          'sha256'
        ),
        anonymized_at=clock_timestamp(),
        version=contact_request.version+1
    FROM candidates
    WHERE contact_request.id=candidates.id
    RETURNING contact_request.id,
              contact_request.source,
              contact_request.status,
              contact_request.consent_policy_version,
              contact_request.purpose,
              contact_request.retention_until,
              contact_request.anonymized_at,
              contact_request.version
  ), audit_rows AS (
    INSERT INTO app.audit_log (
      action,entity_type,entity_id,after_state,metadata
    )
    SELECT
      'contact_request.anonymized',
      'contact_request',
      anonymized.id::text,
      jsonb_build_object(
        'anonymizedAt',anonymized.anonymized_at,
        'status',anonymized.status,
        'version',anonymized.version
      ),
      jsonb_build_object(
        'consentPolicyVersion',anonymized.consent_policy_version,
        'purpose',anonymized.purpose,
        'retentionUntil',anonymized.retention_until,
        'source',anonymized.source
      )
    FROM anonymized
    RETURNING 1
  )
  SELECT count(*)::integer INTO anonymized_count FROM audit_rows;

  RETURN anonymized_count;
END;
$$;

CREATE TRIGGER contact_requests_set_updated_at
BEFORE UPDATE ON app.contact_requests
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMENT ON TABLE app.contact_requests IS
  'Customer enquiries. Consent is explicit, request replay is idempotent, and expired PII is batch-anonymized.';
COMMENT ON COLUMN app.contact_requests.consent_policy_version IS
  'Version of the contact-data consent text accepted by the customer.';
COMMENT ON COLUMN app.contact_requests.purpose IS
  'Narrow processing purpose attached to the consent record.';
COMMENT ON COLUMN app.contact_requests.retention_until IS
  'Maximum retention deadline for contact PII.';
COMMENT ON COLUMN app.contact_requests.anonymized_at IS
  'Timestamp when the customer link, direct contact PII, and request fingerprint were irreversibly cleared.';
COMMENT ON FUNCTION app.anonymize_expired_contact_requests(integer) IS
  'Anonymizes an expired SKIP LOCKED batch, preserves workflow state, and appends a PII-free audit event.';
COMMENT ON TABLE app.product_views IS
  'Private per-user browsing history; API access must always be scoped to the authenticated user.';
