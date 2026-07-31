ALTER TABLE public.chat_threads 
ADD COLUMN IF NOT EXISTS user_typing boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS user_typing_at timestamp with time zone DEFAULT null;