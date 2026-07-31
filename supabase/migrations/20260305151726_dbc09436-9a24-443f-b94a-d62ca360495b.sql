
-- Invoices table for incoming (receipt) and outgoing (shipment) invoices
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'incoming' CHECK (type IN ('incoming', 'outgoing')),
  number text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  counterparty text, -- supplier or customer name
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'exported', 'cancelled')),
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  exported_at timestamp with time zone,
  export_session_id text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Invoice line items
CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  title text NOT NULL,
  sku text,
  quantity numeric NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  guid_1c text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoices
CREATE POLICY "Admins and directors can manage invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'director'::app_role));

CREATE POLICY "Managers can view invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- RLS policies for invoice items
CREATE POLICY "Admins and directors can manage invoice items" ON public.invoice_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'director'::app_role));

CREATE POLICY "Managers can view invoice items" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index for faster queries
CREATE INDEX idx_invoices_type_status ON public.invoices(type, status);
CREATE INDEX idx_invoices_date ON public.invoices(date DESC);
CREATE INDEX idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);
