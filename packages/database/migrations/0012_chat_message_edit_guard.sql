-- Messages are not editable in protocol v1; keep the edit marker immutable too.

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
    OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
  THEN
    RAISE EXCEPTION 'chat message payload is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

