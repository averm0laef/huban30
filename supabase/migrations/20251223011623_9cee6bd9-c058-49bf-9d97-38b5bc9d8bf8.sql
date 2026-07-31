-- Add unique constraint for user_id + product_id on user_product_views
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_product_views_unique 
ON public.user_product_views (user_id, product_id);