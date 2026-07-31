-- Add typing indicator column to chat_threads
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS admin_typing boolean DEFAULT false;
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS admin_typing_at timestamp with time zone;