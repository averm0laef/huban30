
-- Add sign column to report_categories: 'income' or 'expense'
ALTER TABLE public.report_categories ADD COLUMN sign text NOT NULL DEFAULT 'income';

-- Update existing Расходы categories to 'expense'
UPDATE public.report_categories SET sign = 'expense' WHERE name = 'Расходы';
