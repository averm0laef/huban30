-- Fix overly permissive RLS policies for chat_messages INSERT
DROP POLICY IF EXISTS "Anyone can send messages" ON public.chat_messages;

CREATE POLICY "Authenticated users and guests can send messages"
ON public.chat_messages
FOR INSERT
WITH CHECK (
  -- Admins can insert any message
  has_role(auth.uid(), 'admin'::app_role)
  OR
  -- Users can insert messages to their own threads
  (sender IN ('user', 'bot', 'system') AND EXISTS (
    SELECT 1 FROM chat_threads ct 
    WHERE ct.id = thread_id 
    AND (ct.user_id = auth.uid() OR (ct.user_id IS NULL AND ct.guest_session_id IS NOT NULL))
  ))
);

-- Fix overly permissive RLS policies for chat_threads INSERT
DROP POLICY IF EXISTS "Anyone can create threads" ON public.chat_threads;

CREATE POLICY "Users and guests can create threads"
ON public.chat_threads
FOR INSERT
WITH CHECK (
  -- Authenticated users can create threads for themselves
  (user_id = auth.uid() AND guest_session_id IS NULL)
  OR
  -- Anonymous guests can create threads without user_id
  (user_id IS NULL AND guest_session_id IS NOT NULL)
  OR
  -- Admins can create any threads
  has_role(auth.uid(), 'admin'::app_role)
);