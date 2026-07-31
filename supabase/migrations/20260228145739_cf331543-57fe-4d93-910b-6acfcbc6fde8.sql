-- Cart / order requests table
CREATE TABLE public.cart_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  guest_name TEXT,
  guest_phone TEXT NOT NULL,
  guest_email TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cart_orders ENABLE ROW LEVEL SECURITY;

-- Anyone can create an order
CREATE POLICY "Anyone can create cart orders"
ON public.cart_orders FOR INSERT
WITH CHECK (true);

-- Users can view their own orders
CREATE POLICY "Users can view their own orders"
ON public.cart_orders FOR SELECT
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'director'::app_role));

-- Admins can manage all orders
CREATE POLICY "Admins can manage cart orders"
ON public.cart_orders FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'director'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_cart_orders_updated_at
BEFORE UPDATE ON public.cart_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();