-- Create exchange_logs table for 1C exchange history
CREATE TABLE public.exchange_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  exchange_type TEXT DEFAULT 'catalog',
  products_created INTEGER DEFAULT 0,
  products_updated INTEGER DEFAULT 0,
  categories_created INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  error_details JSONB,
  file_count INTEGER DEFAULT 0,
  total_size_bytes INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.exchange_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view and manage exchange logs
CREATE POLICY "Admins can manage exchange logs"
ON public.exchange_logs
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for faster queries
CREATE INDEX idx_exchange_logs_session ON public.exchange_logs(session_id);
CREATE INDEX idx_exchange_logs_started_at ON public.exchange_logs(started_at DESC);