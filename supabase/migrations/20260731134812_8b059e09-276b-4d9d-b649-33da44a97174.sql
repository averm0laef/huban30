ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone;

-- Backfill: everything already read is obviously delivered
UPDATE public.chat_messages SET delivered_at = COALESCE(read_at, created_at) WHERE is_read = true AND delivered_at IS NULL;

CREATE OR REPLACE FUNCTION public.mark_messages_delivered(p_thread_id uuid, p_sender text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.chat_messages
  SET delivered_at = now()
  WHERE thread_id = p_thread_id
    AND sender = p_sender
    AND delivered_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_messages_delivered(uuid, text) TO anon, authenticated, service_role;

-- Ensure realtime UPDATE payloads carry all columns
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_threads REPLICA IDENTITY FULL;