import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { StockIndicator } from "@/components/StockIndicator";

interface RecentProduct {
  id: string;
  title: string;
  price: number;
  brand: string | null;
  stock_qty: number;
  availability_status: string;
  images: { url: string }[];
}

export function RecentlyViewedSection() {
  const { user } = useAuth();
  const [products, setProducts] = useState<RecentProduct[]>([]);

  useEffect(() => {
    if (!user) return;
    const fetchRecent = async () => {
      const { data: views } = await supabase
        .from("user_product_views")
        .select("product_id")
        .eq("user_id", user.id)
        .order("viewed_at", { ascending: false })
        .limit(8);

      if (!views || views.length === 0) return;

      const ids = [...new Set(views.map(v => v.product_id))].slice(0, 4);
      const { data } = await supabase
        .from("products")
        .select("id, title, price, brand, stock_qty, availability_status, product_images(url)")
        .in("id", ids)
        .eq("is_published", true);

      if (data) {
        setProducts(data.map(p => ({ ...p, images: p.product_images || [] })));
      }
    };
    fetchRecent();
  }, [user]);

  if (products.length === 0) return null;

  return (
    <section className="py-6 sm:py-8">
      <div className="container px-4 sm:px-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg sm:text-xl font-bold">Недавно смотрели</h2>
          </div>
          <Link to="/catalog" className="hidden sm:flex items-center gap-1 text-sm text-primary font-medium hover:underline">
            В каталог <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {products.map(product => (
            <Link key={product.id} to={`/catalog/product/${product.id}`}>
              <Card className="group card-hover overflow-hidden h-full">
                <div className="relative aspect-[4/3] overflow-hidden bg-secondary/30">
                  <img
                    src={product.images?.[0]?.url || "/placeholder.svg"}
                    alt={product.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <CardContent className="p-3">
                  <p className="text-[10px] text-muted-foreground">{product.brand || "—"}</p>
                  <h3 className="font-medium text-xs sm:text-sm line-clamp-2 mb-1">{product.title}</h3>
                  <StockIndicator stockQty={product.stock_qty} availabilityStatus={product.availability_status} compact />
                  <p className="font-display font-bold text-sm text-primary mt-1">{product.price.toLocaleString()} ₽</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
