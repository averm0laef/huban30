CREATE INDEX integration_request_log_batch_idx
  ON app.integration_request_log (batch_id, created_at DESC)
  WHERE batch_id IS NOT NULL;
