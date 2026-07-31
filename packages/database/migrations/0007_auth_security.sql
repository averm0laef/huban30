ALTER TABLE app.users
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_failed_login_at timestamptz,
  ADD COLUMN password_changed_at timestamptz;

ALTER TABLE app.staff_members
  ADD COLUMN totp_last_used_step bigint CHECK (totp_last_used_step IS NULL OR totp_last_used_step >= 0);

ALTER TABLE app.auth_sessions
  ADD COLUMN mfa_verified_at timestamptz,
  ADD CONSTRAINT auth_sessions_mfa_time CHECK (
    mfa_verified_at IS NULL OR mfa_verified_at >= created_at
  );

CREATE INDEX users_locked_idx ON app.users (locked_until)
  WHERE locked_until IS NOT NULL;
CREATE INDEX auth_sessions_pending_mfa_idx ON app.auth_sessions (user_id, created_at DESC)
  WHERE revoked_at IS NULL AND mfa_verified_at IS NULL;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;

COMMENT ON COLUMN app.users.locked_until IS
  'Database-backed account lock used together with Redis IP/email rate limits.';
COMMENT ON COLUMN app.auth_sessions.mfa_verified_at IS
  'Null for customer sessions and staff sessions awaiting mandatory TOTP/recovery verification.';
