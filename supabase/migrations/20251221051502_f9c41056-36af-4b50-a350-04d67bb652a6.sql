-- Drop old check constraint and add new one with 'active' status
ALTER TABLE public.chat_threads DROP CONSTRAINT chat_threads_status_check;
ALTER TABLE public.chat_threads ADD CONSTRAINT chat_threads_status_check 
  CHECK (status = ANY (ARRAY['new'::text, 'active'::text, 'in_progress'::text, 'waiting'::text, 'closed'::text]));