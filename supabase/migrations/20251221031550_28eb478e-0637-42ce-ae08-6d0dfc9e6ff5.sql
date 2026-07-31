-- Add rating column to chat_threads table
ALTER TABLE public.chat_threads
ADD COLUMN rating integer CHECK (rating >= 1 AND rating <= 5);