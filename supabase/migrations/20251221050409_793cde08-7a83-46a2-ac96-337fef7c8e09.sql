-- Table to store mapping between chat threads and Telegram topics
CREATE TABLE public.telegram_thread_mapping (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_thread_id UUID NOT NULL UNIQUE,
  telegram_topic_id INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.telegram_thread_mapping ENABLE ROW LEVEL SECURITY;

-- Only admins can manage mappings
CREATE POLICY "Admins can manage telegram mappings"
ON public.telegram_thread_mapping
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));