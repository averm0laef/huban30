-- Add exchange settings columns to store_settings
ALTER TABLE public.store_settings 
ADD COLUMN IF NOT EXISTS exchange_login text DEFAULT 'admin',
ADD COLUMN IF NOT EXISTS exchange_password text DEFAULT NULL;
