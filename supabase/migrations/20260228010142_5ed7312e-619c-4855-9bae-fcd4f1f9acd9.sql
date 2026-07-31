
-- Simple page views counter table
CREATE TABLE public.page_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path text NOT NULL DEFAULT '/',
  viewed_at timestamp with time zone NOT NULL DEFAULT now(),
  session_id text
);

-- Enable RLS
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (anonymous tracking)
CREATE POLICY "Anyone can insert page views"
ON public.page_views FOR INSERT
WITH CHECK (true);

-- Only admins can read
CREATE POLICY "Admins can read page views"
ON public.page_views FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Admins can manage
CREATE POLICY "Admins can manage page views"
ON public.page_views FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Index for fast counting
CREATE INDEX idx_page_views_viewed_at ON public.page_views (viewed_at DESC);
