CREATE TABLE app.hub_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('telegram','vk','max','whatsapp')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  environment text NOT NULL CHECK (environment IN ('development','staging','production')),
  is_test boolean NOT NULL DEFAULT true,
  publish_enabled boolean NOT NULL DEFAULT false,
  inbox_enabled boolean NOT NULL DEFAULT false,
  publish_target text NOT NULL DEFAULT '',
  inbox_target text NOT NULL DEFAULT '',
  public_url text NOT NULL DEFAULT '',
  encrypted_credentials bytea NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  next_send_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_checked_at timestamptz,
  diagnostic jsonb,
  created_by uuid NOT NULL REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hub_connections_creator_idx ON app.hub_connections(created_by);
CREATE UNIQUE INDEX hub_connections_publish_target_idx ON app.hub_connections(environment,platform,publish_target) WHERE publish_target <> '';
CREATE UNIQUE INDEX hub_connections_inbox_target_idx ON app.hub_connections(environment,platform,inbox_target) WHERE inbox_target <> '';

CREATE TABLE app.hub_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  kind text NOT NULL CHECK (kind IN ('news','arrival')),
  title text NOT NULL,
  body text NOT NULL,
  image_url text,
  created_by uuid NOT NULL REFERENCES app.users(id),
  updated_by uuid NOT NULL REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hub_posts_creator_idx ON app.hub_posts(created_by);
CREATE INDEX hub_posts_editor_idx ON app.hub_posts(updated_by);
CREATE INDEX hub_posts_recent_idx ON app.hub_posts(updated_at DESC,id);
CREATE TABLE app.hub_post_revisions (
  post_id uuid NOT NULL REFERENCES app.hub_posts(id),
  revision integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  image_url text,
  created_by uuid NOT NULL REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(post_id,revision)
);
CREATE INDEX hub_post_revisions_creator_idx ON app.hub_post_revisions(created_by);
CREATE TRIGGER hub_post_revisions_append_only BEFORE UPDATE OR DELETE ON app.hub_post_revisions
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TABLE app.hub_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES app.hub_posts(id),
  connection_id uuid NOT NULL REFERENCES app.hub_connections(id),
  external_id text,
  applied_revision integer NOT NULL DEFAULT 0 CHECK (applied_revision >= 0),
  content_kind text CHECK (content_kind IN ('text','image')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(post_id,connection_id)
);
CREATE INDEX hub_publications_connection_idx ON app.hub_publications(connection_id);

CREATE TABLE app.hub_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES app.hub_connections(id),
  peer_id text NOT NULL,
  customer_name text NOT NULL,
  state text NOT NULL DEFAULT 'bot' CHECK (state IN ('bot','waiting','assigned','closed')),
  assigned_to uuid REFERENCES app.users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_inbound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_message_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_message_preview text NOT NULL DEFAULT '',
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(connection_id,peer_id)
);
CREATE INDEX hub_conversations_assignee_idx ON app.hub_conversations(assigned_to);
CREATE INDEX hub_conversations_queue_idx ON app.hub_conversations(state,last_message_at DESC,id);
CREATE TABLE app.hub_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES app.hub_conversations(id),
  connection_id uuid NOT NULL REFERENCES app.hub_connections(id),
  direction text NOT NULL CHECK(direction IN ('incoming','outgoing')),
  sender_kind text NOT NULL CHECK(sender_kind IN ('customer','operator','bot')),
  sender_user_id uuid REFERENCES app.users(id),
  client_key uuid,
  external_id text,
  body text NOT NULL,
  media jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(conversation_id,client_key)
);
CREATE INDEX hub_messages_sender_idx ON app.hub_messages(sender_user_id);
CREATE INDEX hub_messages_connection_idx ON app.hub_messages(connection_id);
CREATE INDEX hub_messages_history_idx ON app.hub_messages(conversation_id,created_at,id);
CREATE UNIQUE INDEX hub_messages_incoming_external_idx ON app.hub_messages(connection_id,external_id)
WHERE direction='incoming' AND external_id IS NOT NULL;
CREATE TABLE app.hub_events (
  connection_id uuid NOT NULL REFERENCES app.hub_connections(id),
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(connection_id,event_id)
);

CREATE TABLE app.hub_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES app.hub_connections(id),
  publication_id uuid REFERENCES app.hub_publications(id),
  revision integer,
  message_id uuid REFERENCES app.hub_messages(id),
  state text NOT NULL DEFAULT 'queued'
    CHECK(state IN ('queued','sending','succeeded','failed','unknown','manual')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  claim_token uuid,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((publication_id IS NOT NULL AND revision IS NOT NULL AND message_id IS NULL)
      OR (publication_id IS NULL AND revision IS NULL AND message_id IS NOT NULL)),
  UNIQUE(publication_id,revision),
  UNIQUE(message_id)
);
CREATE INDEX hub_jobs_connection_idx ON app.hub_jobs(connection_id);
CREATE INDEX hub_jobs_publication_idx ON app.hub_jobs(publication_id,created_at);
CREATE INDEX hub_jobs_ready_idx ON app.hub_jobs(state,available_at,created_at);
CREATE UNIQUE INDEX hub_jobs_single_publication_send_idx ON app.hub_jobs(publication_id) WHERE state='sending';

CREATE TABLE app.hub_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  version integer NOT NULL DEFAULT 1,
  faq jsonb NOT NULL DEFAULT '[]',
  updated_by uuid REFERENCES app.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hub_settings_editor_idx ON app.hub_settings(updated_by);
INSERT INTO app.hub_settings(singleton) VALUES(true);
