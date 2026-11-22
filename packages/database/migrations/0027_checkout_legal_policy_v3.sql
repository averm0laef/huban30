-- The manager-request checkout accepts v3. Keep immutable v1/v2 history
-- valid while requiring the same complete consent evidence for v2 and v3.
ALTER TABLE app.orders
  DROP CONSTRAINT orders_legal_acceptance_pair,
  ADD CONSTRAINT orders_legal_acceptance_pair CHECK (
    (terms_accepted_at IS NULL AND legal_policy_version IS NULL)
    OR (
      terms_accepted_at IS NOT NULL
      AND legal_policy_version IS NOT NULL
      AND legal_policy_version IN (
        'checkout-terms-v1',
        'checkout-terms-2026-08-15-v2',
        'checkout-terms-2026-08-30-v3'
      )
    )
  ),
  DROP CONSTRAINT orders_current_legal_evidence_complete,
  ADD CONSTRAINT orders_current_legal_evidence_complete CHECK (
    (
      legal_policy_version IS DISTINCT FROM 'checkout-terms-2026-08-15-v2'
      AND legal_policy_version IS DISTINCT FROM 'checkout-terms-2026-08-30-v3'
    )
    OR personal_data_consent_at IS NOT NULL
  ),
  DROP CONSTRAINT orders_personal_data_consent_evidence,
  ADD CONSTRAINT orders_personal_data_consent_evidence CHECK ((
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
      AND legal_policy_version IN (
        'checkout-terms-2026-08-15-v2',
        'checkout-terms-2026-08-30-v3'
      )
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
  ) IS TRUE);
