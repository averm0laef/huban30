import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShoppingCart, Package } from "lucide-react";
import { StockIndicator } from "@/components/StockIndicator";
import { ProductImage } from "@/components/ProductImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/contexts/CartContext";

interface Product {
  id: string;
  title: string;
  brand: string | null;
  price: number;
  old_price: number | null;
  stock_qty: number;
  sku: string | null;
  availability_status: string;
  images: { url: string }[];
}

function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();
  const discount = product.old_price 
    ? Math.round((1 - product.price / product.old_price) * 100) 
    : 0;

  const imageUrl = product.images?.[0]?.url || "/placeholder.svg";
  const isInStock = product.availability_status === 'in_stock' || product.stock_qty > 0;

  return (
    <Card className="group h-full card-hover overflow-hidden">
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary/30">
        <ProductImage 
          src={imageUrl} 
          alt={product.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {discount > 0 && (
          <Badge className="absolute top-2 left-2 bg-destructive text-destructive-foreground text-[10px]">
            -{discount}%
          </Badge>
        )}
        <div className="absolute top-2 right-2 bg-background/90 backdrop-blur-sm rounded-md px-1.5 py-0.5">
          <StockIndicator stockQty={product.stock_qty} availabilityStatus={product.availability_status} compact />
        </div>
      </div>
      <CardContent className="p-3">
        <p className="text-[10px] text-muted-foreground mb-0.5">{product.brand || "—"}</p>
        <h3 className="font-medium text-foreground line-clamp-2 mb-2 min-h-[2rem] text-xs sm:text-sm">
          {product.title}
        </h3>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display font-bold text-sm sm:text-base text-foreground truncate">
              {product.price.toLocaleString()} ₽
            </p>
            {product.old_price && (
              <p className="text-[10px] text-muted-foreground line-through">
                {product.old_price.toLocaleString()} ₽
              </p>
            )}
          </div>
          <Button 
            size="icon" 
            variant="outline" 
            className="shrink-0 h-7 w-7 sm:h-8 sm:w-8"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              addItem({
                id: product.id,
                title: product.title,
                price: product.price,
                image: imageUrl,
                sku: product.sku,
              });
            }}
          >
            <ShoppingCart className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProductsShowcase() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select(`id, title, brand, price, old_price, stock_qty, sku, availability_status, product_images (url)`)
        .eq("is_published", true)
        .eq("is_popular", true)
        .order("created_at", { ascending: false })
        .limit(4);

      if (error) throw error;

      setProducts((data || []).map(p => ({
        ...p,
        images: p.product_images || []
      })));
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <section className="py-12 sm:py-16">
        <div className="container px-4 sm:px-6">
          <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
        </div>
      </section>
    );
  }

  if (products.length === 0) {
    return (
      <section className="py-12 sm:py-16">
        <div className="container px-4 sm:px-6">
          <div className="text-center py-12">
            <Package className="h-12 sm:h-16 w-12 sm:w-16 mx-auto mb-4 text-muted-foreground/50" />
            <h2 className="font-display text-xl sm:text-2xl font-bold text-foreground mb-2">
              Каталог товаров
            </h2>
            <p className="text-muted-foreground mb-6 text-sm sm:text-base">
              Товары скоро появятся в каталоге
            </p>
            <Link to="/catalog">
              <Button variant="outline">
                Перейти в каталог
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-6 sm:py-8 lg:py-10">
      <div className="container px-4 sm:px-6">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div>
            <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold text-foreground mb-1">
              Популярные товары
            </h2>
            <p className="text-muted-foreground text-sm">
              Самые востребованные запчасти
            </p>
          </div>
          <Link 
            to="/catalog"
            className="hidden sm:flex items-center gap-1 text-primary font-medium hover:underline"
          >
            Смотреть все
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {products.map((product) => (
            <Link key={product.id} to={`/catalog/product/${product.id}`}>
              <ProductCard product={product} />
            </Link>
          ))}
        </div>

        <div className="text-center mt-6 sm:mt-8">
          <Link to="/catalog">
            <Button size="default" variant="outline" className="w-full sm:w-auto">
              Перейти в каталог
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
