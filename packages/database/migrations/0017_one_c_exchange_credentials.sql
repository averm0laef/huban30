-- Switches app.integration_endpoints from a reversibly-encrypted secret to a
-- one-way argon2id hash (apps/api/src/security/password.service.ts) — the
-- same primitive every user account password already uses. Basic-auth
-- credentials only ever need to be *verified*, never read back, so a hash
-- closes off the "encryption key leaks, every stored integration password is
-- recoverable" failure mode that AES-256-GCM ciphertext left open. This is
-- shared by every integration keyed into app.integration_endpoints — the
-- one-c-exchange endpoint (AN30-013) and the pre-existing 1C JSON machine
-- endpoint both authenticate through the same 'one_c' row, so the fix
-- belongs on the column, not on a new one.
--
-- No integration has a real password configured in any live environment yet
-- (the only current occupant, integration_key='one_c', predates a working 1C
-- endpoint entirely), so there is no ciphertext worth carrying forward — the
-- reset below is a clean slate, not a data loss.
ALTER TABLE app.integration_endpoints RENAME COLUMN secret_ciphertext TO secret_hash;
UPDATE app.integration_endpoints SET secret_hash = NULL WHERE secret_hash IS NOT NULL;

COMMENT ON COLUMN app.integration_endpoints.secret_hash IS
  'Argon2id hash (PasswordService) of the Basic-auth password for this integration. Never a reversible ciphertext and never returned by the API -- GET reports only hasPassword.';
