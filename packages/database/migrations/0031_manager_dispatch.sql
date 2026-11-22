CREATE TABLE app.manager_availability (
  user_id uuid PRIMARY KEY REFERENCES app.staff_members(user_id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES app.auth_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX manager_availability_session_idx ON app.manager_availability(session_id);
CREATE INDEX manager_availability_expiry_idx ON app.manager_availability(expires_at);

ALTER TABLE app.chat_threads ADD COLUMN manager_wait_since timestamptz;
UPDATE app.chat_threads SET manager_wait_since=COALESCE(
  (SELECT min(m.created_at) FROM app.chat_messages m
   WHERE m.thread_id=app.chat_threads.id AND m.sender_kind IN ('guest','customer')
     AND m.sequence_number > COALESCE((SELECT max(s.sequence_number) FROM app.chat_messages s
       WHERE s.thread_id=m.thread_id AND s.sender_kind='staff'),0)),
  last_message_at,created_at)
WHERE status='waiting_staff' AND assigned_staff_id IS NULL AND deleted_at IS NULL;

CREATE FUNCTION app.set_manager_wait_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='waiting_staff' AND NEW.assigned_staff_id IS NULL AND NEW.deleted_at IS NULL THEN
    NEW.manager_wait_since := COALESCE(NEW.manager_wait_since,clock_timestamp());
  ELSE
    NEW.manager_wait_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER chat_threads_manager_wait BEFORE INSERT OR UPDATE OF status,assigned_staff_id,deleted_at
ON app.chat_threads FOR EACH ROW EXECUTE FUNCTION app.set_manager_wait_since();
CREATE INDEX chat_threads_manager_wait_idx ON app.chat_threads(manager_wait_since,id)
WHERE status='waiting_staff' AND assigned_staff_id IS NULL AND deleted_at IS NULL;

ALTER TABLE app.hub_conversations ADD COLUMN manager_wait_since timestamptz;
UPDATE app.hub_conversations SET manager_wait_since=last_message_at WHERE state='waiting';
CREATE FUNCTION app.set_hub_manager_wait_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='waiting' AND NEW.assigned_to IS NULL THEN
    NEW.manager_wait_since := COALESCE(NEW.manager_wait_since,clock_timestamp());
  ELSE
    NEW.manager_wait_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hub_conversations_manager_wait BEFORE INSERT OR UPDATE OF state,assigned_to
ON app.hub_conversations FOR EACH ROW EXECUTE FUNCTION app.set_hub_manager_wait_since();
CREATE INDEX hub_conversations_manager_wait_idx ON app.hub_conversations(manager_wait_since,id)
WHERE state='waiting' AND assigned_to IS NULL;
