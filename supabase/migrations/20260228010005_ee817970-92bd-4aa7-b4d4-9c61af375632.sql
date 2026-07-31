
-- Add social links columns to store_settings
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS social_vk text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS social_whatsapp text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS social_telegram text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS social_max text DEFAULT NULL;

-- Update the public view to include social links
DROP VIEW IF EXISTS public.store_settings_public;
CREATE VIEW public.store_settings_public AS
  SELECT
    id, title, phone, address, telegram_nick, timezone,
    chat_offline_autoreply, no_item_text, shop_hours, chat_hours,
    social_vk, social_whatsapp, social_telegram, social_max,
    created_at, updated_at
  FROM public.store_settings;

-- Grant anon access to the view
GRANT SELECT ON public.store_settings_public TO anon, authenticated;
