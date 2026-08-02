-- Optimistic concurrency and deterministic numbering for the staff workspace.

ALTER TABLE app.chat_threads
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE app.invoices
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE SEQUENCE app.invoice_number_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE INDEX chat_threads_assignment_queue_idx
  ON app.chat_threads (assigned_staff_id, status, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX invoices_status_created_idx
  ON app.invoices (status, created_at DESC);

CREATE UNIQUE INDEX invoices_one_live_per_order_uidx
  ON app.invoices (order_id)
  WHERE order_id IS NOT NULL AND status <> 'cancelled';

COMMENT ON COLUMN app.chat_threads.version IS
  'Optimistic concurrency token incremented on staff-visible thread changes.';
COMMENT ON COLUMN app.invoices.version IS
  'Optimistic concurrency token incremented on every invoice state change.';
