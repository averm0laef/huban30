
-- 2. Employees table
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can manage employees" ON public.employees
  FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Managers can view active employees" ON public.employees
  FOR SELECT USING (has_role(auth.uid(), 'manager') AND is_active = true);

-- 3. Attendance records
CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  is_present boolean NOT NULL DEFAULT false,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES auth.users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, date)
);
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can manage attendance" ON public.attendance_records
  FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Managers can manage attendance" ON public.attendance_records
  FOR ALL USING (has_role(auth.uid(), 'manager'));

-- 4. Business entities (ИП)
CREATE TABLE public.business_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.business_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can manage entities" ON public.business_entities
  FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Managers can view active entities" ON public.business_entities
  FOR SELECT USING (has_role(auth.uid(), 'manager') AND is_active = true);

-- 5. Report categories per entity
CREATE TABLE public.report_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.business_entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can manage report categories" ON public.report_categories
  FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Managers can view active report categories" ON public.report_categories
  FOR SELECT USING (has_role(auth.uid(), 'manager') AND is_active = true);

-- 6. Daily reports
CREATE TABLE public.daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  UNIQUE(user_id, report_date)
);
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can view all reports" ON public.daily_reports
  FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Managers can manage own reports" ON public.daily_reports
  FOR ALL USING (has_role(auth.uid(), 'manager') AND auth.uid() = user_id);

-- 7. Report entries
CREATE TABLE public.report_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.report_categories(id),
  amount numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can view all entries" ON public.report_entries
  FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Managers can manage own entries" ON public.report_entries
  FOR ALL USING (
    has_role(auth.uid(), 'manager') AND 
    EXISTS (SELECT 1 FROM public.daily_reports dr WHERE dr.id = report_id AND dr.user_id = auth.uid())
  );

-- 8. Report photos
CREATE TABLE public.report_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  url text NOT NULL,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can view all photos" ON public.report_photos
  FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Managers can manage own photos" ON public.report_photos
  FOR ALL USING (
    has_role(auth.uid(), 'manager') AND 
    EXISTS (SELECT 1 FROM public.daily_reports dr WHERE dr.id = report_id AND dr.user_id = auth.uid())
  );

-- 9. Action logs
CREATE TABLE public.action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.action_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can view logs" ON public.action_logs
  FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'director'));
CREATE POLICY "Authenticated users can insert logs" ON public.action_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 10. Storage bucket for report photos
INSERT INTO storage.buckets (id, name, public) VALUES ('report-photos', 'report-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload report photos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'report-photos' AND auth.uid() IS NOT NULL);
CREATE POLICY "Anyone can view report photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'report-photos');
CREATE POLICY "Users can delete own report photos" ON storage.objects
  FOR DELETE USING (bucket_id = 'report-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 11. Triggers
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_daily_reports_updated_at BEFORE UPDATE ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 12. Update has_role so director = admin equivalent
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND (
      role = _role 
      OR (role = 'director' AND _role = 'admin')
    )
  )
$$;
