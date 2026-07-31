-- Fix duplicate mark_messages_as_read function issue
-- Drop both versions and recreate with unique signature
DROP FUNCTION IF EXISTS public.mark_messages_as_read(uuid, text);
DROP FUNCTION IF EXISTS public.mark_messages_as_read(text, uuid);

-- Create single function with clear parameter order
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_thread_id uuid, p_sender text)
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