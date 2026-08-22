-- Explicit, purpose-specific consent collected during customer registration.
--
-- The record is intentionally separate from the user row. It is append-only
-- evidence of one concrete affirmative action and remains available when the
-- account is later soft-deleted. A changed consent text must use a new policy
-- version instead of rewriting historical rows.

CREATE TABLE app.personal_data_consents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  purpose text NOT NULL DEFAULT 'account_registration',
  policy_version text NOT NULL,
  document_path text NOT NULL DEFAULT '/personal-data-consent',
  consent_text text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ip_address inet,
  user_agent text,
  CONSTRAINT personal_data_consents_purpose CHECK (
    purpose='account_registration'
  ),
  CONSTRAINT personal_data_consents_policy_version CHECK (
    policy_version=btrim(policy_version) AND policy_version<>''
  ),
  CONSTRAINT personal_data_consents_document_path CHECK (
    document_path='/personal-data-consent'
  ),
  CONSTRAINT personal_data_consents_text CHECK (
    consent_text=btrim(consent_text) AND consent_text<>''
  ),
  CONSTRAINT personal_data_consents_user_agent_length CHECK (
    user_agent IS NULL OR char_length(user_agent)<=1024
  )
);

CREATE INDEX personal_data_consents_user_idx
  ON app.personal_data_consents (user_id,accepted_at DESC);
CREATE INDEX personal_data_consents_version_idx
  ON app.personal_data_consents (policy_version,accepted_at DESC);

CREATE TRIGGER personal_data_consents_append_only
BEFORE UPDATE OR DELETE ON app.personal_data_consents
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

COMMENT ON TABLE app.personal_data_consents IS
  'Append-only evidence of explicit personal-data consent collected for account registration.';
COMMENT ON COLUMN app.personal_data_consents.policy_version IS
  'Version of the purpose-specific consent document accepted by the customer.';
COMMENT ON COLUMN app.personal_data_consents.consent_text IS
  'Exact checkbox statement shown when this consent was accepted.';
COMMENT ON COLUMN app.personal_data_consents.accepted_at IS
  'Trusted server-side acceptance timestamp.';
COMMENT ON COLUMN app.personal_data_consents.ip_address IS
  'Request IP captured as supporting evidence, when available.';
COMMENT ON COLUMN app.personal_data_consents.user_agent IS
  'Bounded request user-agent captured as supporting evidence, when available.';
