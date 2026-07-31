-- Add vk_id column to profiles table for VK authentication
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vk_id TEXT UNIQUE;

-- Create index for faster lookups by vk_id
CREATE INDEX IF NOT EXISTS idx_profiles_vk_id ON public.profiles(vk_id);