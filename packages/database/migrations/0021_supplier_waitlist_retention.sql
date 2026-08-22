-- Bound the lifetime of direct contact data collected for supplier waitlist
-- requests. Workflow and product snapshots remain useful after anonymisation,
-- while the user link, contact fields and request fingerprint are removed.

ALTER TABLE app.supplier_waitlist_requests
  ADD COLUMN retention_until timestamptz,
  ADD COLUMN anonymized_at timestamptz;

UPDATE app.supplier_waitlist_requests
SET retention_until=created_at + interval '365 days';

ALTER TABLE app.supplier_waitlist_requests
  ALTER COLUMN retention_until SET NOT NULL,
  ALTER COLUMN retention_until SET DEFAULT (clock_timestamp() + interval '365 days'),
  DROP CONSTRAINT supplier_waitlist_requests_contact,
  ADD CONSTRAINT supplier_waitlist_requests_personal_data_state CHECK (
    (
      anonymized_at IS NULL
      AND customer_name<>''
      AND (customer_email IS NOT NULL OR customer_phone IS NOT NULL)
    )
    OR (
      anonymized_at IS NOT NULL
      AND user_id IS NULL
      AND customer_name=''
      AND customer_email IS NULL
      AND customer_phone IS NULL
    )
  ),
  ADD CONSTRAINT supplier_waitlist_requests_retention_period CHECK (
    retention_until>consent_at
  ),
  ADD CONSTRAINT supplier_waitlist_requests_anonymized_at_valid CHECK (
    anonymized_at IS NULL OR anonymized_at>=consent_at
  );

CREATE INDEX supplier_waitlist_requests_retention_idx
  ON app.supplier_waitlist_requests (retention_until,id)
  WHERE anonymized_at IS NULL;

CREATE FUNCTION app.anonymize_expired_supplier_waitlist_requests(batch_limit integer DEFAULT 500)
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
    SELECT waitlist.id
    FROM app.supplier_waitlist_requests AS waitlist
    WHERE waitlist.anonymized_at IS NULL
      AND waitlist.retention_until<=clock_timestamp()
    ORDER BY waitlist.retention_until,waitlist.id
    FOR UPDATE SKIP LOCKED
    LIMIT batch_limit
  ), anonymized AS (
    UPDATE app.supplier_waitlist_requests AS waitlist
    SET user_id=NULL,
        customer_name='',
        customer_email=NULL,
        customer_phone=NULL,
        request_hash=public.digest(
          'anonymized:' || waitlist.id::text || ':' || clock_timestamp()::text,
          'sha256'
        ),
        anonymized_at=clock_timestamp(),
        version=waitlist.version+1
    FROM candidates
    WHERE waitlist.id=candidates.id
    RETURNING waitlist.id,
              waitlist.supplier,
              waitlist.status,
              waitlist.consent_policy_version,
              waitlist.retention_until,
              waitlist.anonymized_at,
              waitlist.version
  ), audit_rows AS (
    INSERT INTO app.audit_log (
      action,entity_type,entity_id,after_state,metadata
    )
    SELECT
      'supplier_waitlist_request.anonymized',
      'supplier_waitlist_request',
      anonymized.id::text,
      jsonb_build_object(
        'anonymizedAt',anonymized.anonymized_at,
        'status',anonymized.status,
        'version',anonymized.version
      ),
      jsonb_build_object(
        'consentPolicyVersion',anonymized.consent_policy_version,
        'retentionUntil',anonymized.retention_until,
        'supplier',anonymized.supplier
      )
    FROM anonymized
    RETURNING 1
  )
  SELECT count(*)::integer INTO anonymized_count FROM audit_rows;

  RETURN anonymized_count;
END;
$$;

COMMENT ON COLUMN app.supplier_waitlist_requests.retention_until IS
  'Maximum deadline for retaining direct customer contact data for this request.';
COMMENT ON COLUMN app.supplier_waitlist_requests.anonymized_at IS
  'Timestamp when the user link, direct contact fields and request fingerprint were cleared.';
COMMENT ON FUNCTION app.anonymize_expired_supplier_waitlist_requests(integer) IS
  'Anonymizes an expired SKIP LOCKED batch and appends a PII-free audit event.';
