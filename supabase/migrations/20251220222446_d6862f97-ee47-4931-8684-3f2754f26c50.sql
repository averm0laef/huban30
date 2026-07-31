-- Create super admin user (will be created on first signup, protected in code)
-- Add is_super_admin column to profiles to mark protected admin
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- Create function to prevent deleting super admin
CREATE OR REPLACE FUNCTION public.prevent_super_admin_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_super_admin = true THEN
    RAISE EXCEPTION 'Cannot delete super admin account';
  END IF;
  RETURN OLD;
END;
$$;

-- Create trigger to prevent super admin deletion
DROP TRIGGER IF EXISTS prevent_super_admin_delete_trigger ON public.profiles;
CREATE TRIGGER prevent_super_admin_delete_trigger
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_super_admin_delete();

-- Create function to prevent changing super admin role
CREATE OR REPLACE FUNCTION public.prevent_super_admin_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_is_super BOOLEAN;
BEGIN
  SELECT is_super_admin INTO profile_is_super 
  FROM public.profiles 
  WHERE user_id = OLD.user_id;
  
  IF profile_is_super = true AND OLD.role = 'admin' AND NEW.role != 'admin' THEN
    RAISE EXCEPTION 'Cannot change super admin role';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to prevent super admin role change
DROP TRIGGER IF EXISTS prevent_super_admin_role_change_trigger ON public.user_roles;
CREATE TRIGGER prevent_super_admin_role_change_trigger
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_super_admin_role_change();

-- Create function to prevent deleting super admin role
CREATE OR REPLACE FUNCTION public.prevent_super_admin_role_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_is_super BOOLEAN;
BEGIN
  SELECT is_super_admin INTO profile_is_super 
  FROM public.profiles 
  WHERE user_id = OLD.user_id;
  
  IF profile_is_super = true THEN
    RAISE EXCEPTION 'Cannot delete super admin role';
  END IF;
  
  RETURN OLD;
END;
$$;

-- Create trigger to prevent super admin role deletion
DROP TRIGGER IF EXISTS prevent_super_admin_role_delete_trigger ON public.user_roles;
CREATE TRIGGER prevent_super_admin_role_delete_trigger
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_super_admin_role_delete();