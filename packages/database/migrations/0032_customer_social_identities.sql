CREATE TABLE app.customer_social_identities (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('yandex', 'vk')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 128),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, provider),
  UNIQUE (provider, subject)
);
