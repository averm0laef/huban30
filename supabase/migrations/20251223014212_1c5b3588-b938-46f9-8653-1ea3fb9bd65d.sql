-- Fix the SECURITY DEFINER view issue
-- Drop the old view and recreate with SECURITY INVOKER
DROP VIEW IF EXISTS public.store_settings_public;

CREATE VIEW public.store_settings_public
WITH (security_invoker = true)
AS
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
FROM public.store_settings;

-- Grant access to the view
GRANT SELECT ON public.store_settings_public TO anon, authenticated;

-- Now fix the store_settings policy to allow view access
DROP POLICY IF EXISTS "Public can view non-sensitive store settings" ON public.store_settings;

-- Create policy that allows select but hides sensitive columns at view level
CREATE POLICY "Allow public access through view"
ON public.store_settings
FOR SELECT
USING (true);