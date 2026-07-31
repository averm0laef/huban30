-- Create table for temporary auth codes
CREATE TABLE public.auth_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '5 minutes'),
  used BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.auth_codes ENABLE ROW LEVEL SECURITY;

-- Allow edge functions to manage codes (service role)
CREATE POLICY "Service role can manage auth codes"
ON public.auth_codes
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_auth_codes_telegram_id ON public.auth_codes(telegram_id);
CREATE INDEX idx_auth_codes_code ON public.auth_codes(code);

-- Auto-cleanup expired codes
CREATE OR REPLACE FUNCTION public.cleanup_expired_auth_codes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.auth_codes WHERE expires_at < now() OR used = true;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cleanup_auth_codes_trigger
AFTER INSERT ON public.auth_codes
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_expired_auth_codes();