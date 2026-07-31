-- Add telegram_username column to auth_codes
ALTER TABLE public.auth_codes 
ADD COLUMN IF NOT EXISTS telegram_username TEXT;

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_auth_codes_username ON public.auth_codes (telegram_username);