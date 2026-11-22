-- Human-readable chat numbers («Ч-000123») and customer avatar choice.

CREATE SEQUENCE app.chat_thread_number_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
ALTER TABLE app.chat_threads ADD COLUMN public_number bigint;
-- Existing chats are numbered in the order they were opened.
UPDATE app.chat_threads AS thread SET public_number=numbered.n
FROM (SELECT id,row_number() OVER (ORDER BY created_at,id) AS n FROM app.chat_threads) AS numbered
WHERE numbered.id=thread.id;
SELECT setval('app.chat_thread_number_seq',COALESCE((SELECT max(public_number) FROM app.chat_threads),0)+1,false);
ALTER TABLE app.chat_threads
  ALTER COLUMN public_number SET DEFAULT nextval('app.chat_thread_number_seq'),
  ALTER COLUMN public_number SET NOT NULL,
  ADD CONSTRAINT chat_threads_public_number_key UNIQUE (public_number);
ALTER SEQUENCE app.chat_thread_number_seq OWNED BY app.chat_threads.public_number;

-- One of the 15 pictures in public/avatars; NULL means "pick by hash".
ALTER TABLE app.users ADD COLUMN avatar_key text
  CONSTRAINT users_avatar_key_known CHECK (avatar_key IS NULL OR avatar_key ~ '^customer-(0[1-9]|1[0-5])$');
