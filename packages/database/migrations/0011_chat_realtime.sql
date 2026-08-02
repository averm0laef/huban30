-- Reliable chat cursors, guest receipts and immutable message payloads.

ALTER TABLE app.chat_messages
  DROP CONSTRAINT chat_messages_sender_kind_check,
  DROP CONSTRAINT chat_message_sender;

ALTER TABLE app.chat_messages
  ADD CONSTRAINT chat_messages_sender_kind_check
    CHECK (sender_kind IN ('customer', 'guest', 'staff', 'system')),
  ADD CONSTRAINT chat_message_sender CHECK (
    (sender_kind IN ('guest', 'system') AND sender_user_id IS NULL)
    OR (sender_kind IN ('customer', 'staff') AND sender_user_id IS NOT NULL)
  );

ALTER TABLE app.chat_messages
  ADD COLUMN sequence_number bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE app.chat_messages
  ADD CONSTRAINT chat_messages_sequence_unique UNIQUE (sequence_number);

CREATE INDEX chat_messages_reconnect_idx
  ON app.chat_messages (thread_id, sequence_number)
  WHERE deleted_at IS NULL;

CREATE TABLE app.chat_guest_message_receipts (
  message_id uuid PRIMARY KEY REFERENCES app.chat_messages(id) ON DELETE CASCADE,
  delivered_at timestamptz,
  read_at timestamptz,
  CONSTRAINT chat_guest_receipt_order CHECK (read_at IS NULL OR delivered_at IS NOT NULL)
);

CREATE OR REPLACE FUNCTION app.protect_chat_message_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.thread_id IS DISTINCT FROM OLD.thread_id
    OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
    OR NEW.sender_kind IS DISTINCT FROM OLD.sender_kind
    OR NEW.message_type IS DISTINCT FROM OLD.message_type
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.client_message_id IS DISTINCT FROM OLD.client_message_id
    OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
  THEN
    RAISE EXCEPTION 'chat message payload is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_messages_protect_payload
BEFORE UPDATE ON app.chat_messages
FOR EACH ROW EXECUTE FUNCTION app.protect_chat_message_payload();

CREATE OR REPLACE FUNCTION app.protect_chat_attachment_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.message_id IS DISTINCT FROM OLD.message_id
    OR NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'chat attachment link is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_attachments_protect_link
BEFORE UPDATE OR DELETE ON app.chat_attachments
FOR EACH ROW EXECUTE FUNCTION app.protect_chat_attachment_link();
