-- Add read_at column to track when message was read
ALTER TABLE public.chat_messages 
ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;

-- Update the mark_messages_as_read function to also set read_at
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_sender text, p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE chat_messages
  SET is_read = true, read_at = COALESCE(read_at, now())
  WHERE thread_id = p_thread_id
    AND sender = p_sender
    AND is_read = false;
END;
$$;