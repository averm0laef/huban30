-- Add is_read column to chat_messages
ALTER TABLE public.chat_messages 
ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT false;

-- Add index for faster queries
CREATE INDEX idx_chat_messages_is_read ON public.chat_messages(thread_id, is_read) WHERE is_read = false;

-- Create function to mark messages as read
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_thread_id UUID, p_sender TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_messages 
  SET is_read = true 
  WHERE thread_id = p_thread_id 
    AND sender != p_sender 
    AND is_read = false;
END;
$$;

-- Create function to get unread count
CREATE OR REPLACE FUNCTION public.get_unread_count(p_thread_id UUID, p_sender TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  unread_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unread_count
  FROM public.chat_messages 
  WHERE thread_id = p_thread_id 
    AND sender != p_sender 
    AND is_read = false;
  RETURN unread_count;
END;
$$;