-- Drop existing restrictive policies for chat_threads
DROP POLICY IF EXISTS "Admins can manage all threads" ON public.chat_threads;
DROP POLICY IF EXISTS "Users can create threads" ON public.chat_threads;
DROP POLICY IF EXISTS "Users can update their own threads" ON public.chat_threads;
DROP POLICY IF EXISTS "Users can view their own threads" ON public.chat_threads;

-- Create permissive policies for chat_threads
CREATE POLICY "Admins can manage all threads" 
ON public.chat_threads 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own threads" 
ON public.chat_threads 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own threads" 
ON public.chat_threads 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Anyone can create threads" 
ON public.chat_threads 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Guests can view their threads" 
ON public.chat_threads 
FOR SELECT 
USING (guest_session_id IS NOT NULL);

CREATE POLICY "Guests can update their threads" 
ON public.chat_threads 
FOR UPDATE 
USING (guest_session_id IS NOT NULL);

-- Drop and recreate chat_messages policies
DROP POLICY IF EXISTS "Admins can manage all messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can send messages to their threads" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can view messages in their threads" ON public.chat_messages;

CREATE POLICY "Admins can manage all messages" 
ON public.chat_messages 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view messages in their threads" 
ON public.chat_messages 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM chat_threads 
  WHERE chat_threads.id = chat_messages.thread_id 
  AND (chat_threads.user_id = auth.uid() OR chat_threads.guest_session_id IS NOT NULL)
));

CREATE POLICY "Anyone can send messages" 
ON public.chat_messages 
FOR INSERT 
WITH CHECK (true);