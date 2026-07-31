
-- Table for admin-manageable engine part labels on the scroll animation section
CREATE TABLE public.engine_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  x_position NUMERIC NOT NULL DEFAULT 50,
  y_position NUMERIC NOT NULL DEFAULT 50,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.engine_parts ENABLE ROW LEVEL SECURITY;

-- Anyone can view active parts
CREATE POLICY "Anyone can view active engine parts"
ON public.engine_parts
FOR SELECT
USING (is_active = true);

-- Admins can manage
CREATE POLICY "Admins can manage engine parts"
ON public.engine_parts
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert default data
INSERT INTO public.engine_parts (label, description, x_position, y_position, color, sort_order) VALUES
  ('Аккумулятор', 'АКБ и клеммы', 62, 26, '#22c55e', 1),
  ('Моторное масло', 'Синтетика и полусинтетика', 38, 20, '#f59e0b', 2),
  ('Фильтры', 'Воздушные, масляные, топливные', 48, 42, '#0ea5e9', 3),
  ('Ремни ГРМ', 'Приводные ремни и ролики', 30, 50, '#f43f5e', 4),
  ('Свечи зажигания', 'Оригинал и аналоги', 55, 55, '#8b5cf6', 5),
  ('Система охлаждения', 'Радиаторы, антифриз, помпы', 72, 46, '#06b6d4', 6);

-- Trigger for updated_at
CREATE TRIGGER update_engine_parts_updated_at
BEFORE UPDATE ON public.engine_parts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
