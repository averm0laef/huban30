-- ==============================================
-- CRITICAL SECURITY FIX: Protect all sensitive data
-- ==============================================

-- 1. FIX STORE_SETTINGS: Remove public access to sensitive fields
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can view store settings" ON public.store_settings;

-- Create a secure view that hides sensitive fields
CREATE OR REPLACE VIEW public.store_settings_public AS
SELECT 
  id,
  title,
  phone,
  address,
  telegram_nick,
  shop_hours,
  chat_hours,
  chat_offline_autoreply,
  no_item_text,
  timezone,
  created_at,
  updated_at
  -- NOTE: exchange_login and exchange_password are intentionally excluded
FROM public.store_settings;

-- Grant select on the public view to authenticated and anon
GRANT SELECT ON public.store_settings_public TO anon, authenticated;

-- Create a new policy for public to view ONLY non-sensitive settings via the table
-- but they should use the view instead
CREATE POLICY "Public can view non-sensitive store settings"
ON public.store_settings
FOR SELECT
USING (false); -- Block direct table access for non-admins

-- Keep admin full access policy (already exists)

-- 2. FIX AUTH_CODES: Remove public access completely
DROP POLICY IF EXISTS "Service role can manage auth codes" ON public.auth_codes;

-- Auth codes should NEVER be publicly readable
-- Only service role (edge functions) should access this table
-- No RLS policy means only service_role can access
CREATE POLICY "Only service role via functions"
ON public.auth_codes
FOR ALL
USING (false)
WITH CHECK (false);

-- 3. FIX CHAT_THREADS: Guests can only see THEIR OWN threads
DROP POLICY IF EXISTS "Guests can view their threads" ON public.chat_threads;
DROP POLICY IF EXISTS "Guests can update their threads" ON public.chat_threads;

-- Guests must provide their session_id in the request context
-- For now, we'll require authentication or admin access for viewing
CREATE POLICY "Authenticated users can view their own threads"
ON public.chat_threads
FOR SELECT
USING (
  auth.uid() = user_id 
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 4. FIX EXCHANGE_FILES: Add admin-only policy
CREATE POLICY "Admins can manage exchange files"
ON public.exchange_files
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 5. FIX EXCHANGE_LOGS: Add SELECT policy for admins
CREATE POLICY "Admins can view exchange logs"
ON public.exchange_logs
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. Ensure chat_messages are protected
-- The existing policy has issues - let's fix it
DROP POLICY IF EXISTS "Users can view messages in their threads" ON public.chat_messages;

CREATE POLICY "Users can view messages in their own threads"
ON public.chat_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM chat_threads ct
    WHERE ct.id = chat_messages.thread_id
    AND ct.user_id = auth.uid()
  )
  OR has_role(auth.uid(), 'admin'::app_role)
);