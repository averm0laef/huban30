-- Create table for temporary 1C exchange files
CREATE TABLE IF NOT EXISTS public.exchange_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text NOT NULL,
  filename text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create index for faster lookup
CREATE INDEX idx_exchange_files_session ON public.exchange_files(session_id);

-- Auto-cleanup old files (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_exchange_files()
RETURNS trigger AS $$
BEGIN
  DELETE FROM public.exchange_files WHERE created_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER cleanup_exchange_files_trigger
AFTER INSERT ON public.exchange_files
FOR EACH STATEMENT
EXECUTE FUNCTION cleanup_old_exchange_files();

-- RLS: Only service role can access
ALTER TABLE public.exchange_files ENABLE ROW LEVEL SECURITY;

-- No policies needed - only service role accesses this table