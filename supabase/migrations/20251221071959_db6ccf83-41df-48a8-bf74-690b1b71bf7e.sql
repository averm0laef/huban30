-- Create storage bucket for chat images
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-images', 'chat-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public viewing of chat images
CREATE POLICY "Chat images are publicly viewable"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-images');

-- Allow authenticated users and guests to upload images
CREATE POLICY "Anyone can upload chat images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-images');

-- Allow admins to delete images
CREATE POLICY "Admins can delete chat images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'chat-images' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
);