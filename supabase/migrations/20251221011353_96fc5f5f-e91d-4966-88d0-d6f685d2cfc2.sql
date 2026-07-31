-- Drop existing policy for viewing messages
DROP POLICY IF EXISTS "Users can view messages in their threads" ON public.chat_messages;

-- Create a more permissive policy that properly matches guest sessions
CREATE POLICY "Users can view messages in their threads" 
ON public.chat_messages 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM chat_threads 
    WHERE chat_threads.id = chat_messages.thread_id 
    AND (
      chat_threads.user_id = auth.uid() 
      OR (
        chat_threads.guest_session_id IS NOT NULL 
        AND chat_threads.user_id IS NULL
      )
    )
  )
  OR has_role(auth.uid(), 'admin'::app_role)
);