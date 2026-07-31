-- AN30-002: the legacy client cannot securely bind an anonymous browser session
-- to RLS. Guest chat is disabled until the autonomous API owns authorization.

DROP POLICY IF EXISTS "Users and guests can view their own threads" ON public.chat_threads;
DROP POLICY IF EXISTS "Guests can update threads without user" ON public.chat_threads;
DROP POLICY IF EXISTS "Guests can update their threads" ON public.chat_threads;
DROP POLICY IF EXISTS "Users and guests can create threads" ON public.chat_threads;
DROP POLICY IF EXISTS "Anyone can create threads" ON public.chat_threads;

DROP POLICY IF EXISTS "Users and guests can view their thread messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Authenticated users and guests can send messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Anyone can send messages" ON public.chat_messages;

DROP POLICY IF EXISTS "Legacy authenticated users create own threads" ON public.chat_threads;
CREATE POLICY "Legacy authenticated users create own threads"
ON public.chat_threads
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND guest_session_id IS NULL
);

DROP POLICY IF EXISTS "Legacy authenticated users send own messages" ON public.chat_messages;
CREATE POLICY "Legacy authenticated users send own messages"
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender = 'user'
  AND EXISTS (
    SELECT 1
    FROM public.chat_threads thread
    WHERE thread.id = chat_messages.thread_id
      AND thread.user_id = auth.uid()
  )
);

-- Legacy attachments were public and accepted anonymous uploads. The new API
-- will reintroduce private, signature-checked attachments in AN30-009.
UPDATE storage.buckets
SET public = false
WHERE id = 'chat-images';

DROP POLICY IF EXISTS "Chat images are publicly viewable" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload chat images" ON storage.objects;
