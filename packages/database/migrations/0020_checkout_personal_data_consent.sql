-- Separate, immutable evidence for checkout personal-data consent.
--
-- Existing orders remain valid historical rows: their newly added consent
-- fields are NULL. Every order created by the updated public API writes the
-- complete evidence tuple in the same transaction as the order.

ALTER TABLE app.orders
  DROP CONSTRAINT orders_legal_acceptance_pair,
  ADD CONSTRAINT orders_legal_acceptance_pair CHECK (
    (terms_accepted_at IS NULL AND legal_policy_version IS NULL)
    OR (
      terms_accepted_at IS NOT NULL
      AND legal_policy_version IN ('checkout-terms-v1','checkout-terms-2026-08-15-v2')
    )
  ),
  ADD COLUMN personal_data_consent_at timestamptz,
  ADD COLUMN personal_data_consent_policy_version text,
  ADD COLUMN personal_data_consent_document_path text,
  ADD COLUMN personal_data_consent_text text,
  ADD COLUMN personal_data_consent_ip_address inet,
  ADD COLUMN personal_data_consent_user_agent text,
  ADD CONSTRAINT orders_current_legal_evidence_complete CHECK (
    legal_policy_version IS DISTINCT FROM 'checkout-terms-2026-08-15-v2'
    OR personal_data_consent_at IS NOT NULL
  ),
  ADD CONSTRAINT orders_personal_data_consent_evidence CHECK (
    (
      personal_data_consent_at IS NULL
      AND personal_data_consent_policy_version IS NULL
      AND personal_data_consent_document_path IS NULL
      AND personal_data_consent_text IS NULL
      AND personal_data_consent_ip_address IS NULL
      AND personal_data_consent_user_agent IS NULL
    )
    OR (
      terms_accepted_at IS NOT NULL
      AND legal_policy_version='checkout-terms-2026-08-15-v2'
      AND personal_data_consent_at IS NOT NULL
      AND personal_data_consent_policy_version='checkout-personal-data-2026-08-15-v1'
      AND personal_data_consent_document_path='/checkout-personal-data-consent'
      AND personal_data_consent_text=btrim(personal_data_consent_text)
      AND personal_data_consent_text<>''
      AND (
        personal_data_consent_user_agent IS NULL
        OR char_length(personal_data_consent_user_agent)<=1024
      )
    )
  );

CREATE OR REPLACE FUNCTION app.preserve_order_legal_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at
    OR NEW.legal_policy_version IS DISTINCT FROM OLD.legal_policy_version
    OR NEW.personal_data_consent_at IS DISTINCT FROM OLD.personal_data_consent_at
    OR NEW.personal_data_consent_policy_version IS DISTINCT FROM OLD.personal_data_consent_policy_version
    OR NEW.personal_data_consent_document_path IS DISTINCT FROM OLD.personal_data_consent_document_path
    OR NEW.personal_data_consent_text IS DISTINCT FROM OLD.personal_data_consent_text
    OR NEW.personal_data_consent_ip_address IS DISTINCT FROM OLD.personal_data_consent_ip_address
    OR NEW.personal_data_consent_user_agent IS DISTINCT FROM OLD.personal_data_consent_user_agent THEN
    RAISE EXCEPTION 'order legal acceptance is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN app.orders.personal_data_consent_at IS
  'Trusted server-side timestamp of a separate checkout personal-data consent.';
COMMENT ON COLUMN app.orders.personal_data_consent_policy_version IS
  'Version of the purpose-specific checkout personal-data consent.';
COMMENT ON COLUMN app.orders.personal_data_consent_document_path IS
  'Stable storefront path of the accepted consent document.';
COMMENT ON COLUMN app.orders.personal_data_consent_text IS
  'Exact checkbox statement shown when the separate consent was accepted.';
COMMENT ON COLUMN app.orders.personal_data_consent_ip_address IS
  'Request IP retained as supporting consent evidence when available.';
COMMENT ON COLUMN app.orders.personal_data_consent_user_agent IS
  'Bounded request user-agent retained as supporting consent evidence when available.';
