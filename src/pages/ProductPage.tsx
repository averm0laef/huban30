import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { ArrowLeft, ShoppingCart, Heart, Share2, Package, MessageCircle } from "lucide-react";
import { StockIndicator } from "@/components/StockIndicator";
import { ProductImage } from "@/components/ProductImage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useFavorites } from "@/hooks/useFavorites";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { useChat } from "@/contexts/ChatContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Product {
  id: string;
  title: string;
  display_title: string | null;
  brand: string | null;
  sku: string | null;
  price: number;
  old_price: number | null;
  stock_qty: number;
  availability_status: string;
  description: string | null;
  props: any;
  category_id: string | null;
  categories?: { name: string; slug: string } | null;
  product_images: { url: string; sort_order: number }[];
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { addItem } = useCart();
  const { openChat, setProductContext } = useChat();
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const { isFavorite, toggleFavorite } = useFavorites();

  useEffect(() => {
    if (id) {
      fetchProduct(id);
      recordProductView(id);
    }
  }, [id]);

  // Record product view
  const recordProductView = async (productId: string) => {
    if (!user) return;
    
    try {
      // Upsert - update viewed_at if exists, insert if not
      await supabase
        .from('user_product_views')
        .upsert({
          user_id: user.id,
          product_id: productId,
          viewed_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,product_id'
        });
    } catch (error) {
      console.error('Error recording view:', error);
    }
  };

  // Share/copy link
  const handleShare = async () => {
    const url = window.location.href;
    
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Ссылка скопирована!');
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      toast.success('Ссылка скопирована!');
    }
  };

  const fetchProduct = async (productId: string) => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select(`
          *,
          categories:category_id (name, slug),
          product_images (url, sort_order)
        `)
        .eq("id", productId)
        .eq("is_published", true)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setProduct({
          ...data,
          product_images: (data.product_images || []).sort((a: any, b: any) => a.sort_order - b.sort_order)
        });
      }
    } catch (error) {
      console.error("Error fetching product:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="container py-8">
          <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
        </div>
      </MainLayout>
    );
  }

  if (!product) {
    return (
      <MainLayout>
        <div className="container py-8">
          <div className="text-center py-12">
            <Package className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
            <h1 className="text-2xl font-bold mb-2">Товар не найден</h1>
            <p className="text-muted-foreground mb-6">
              Возможно, товар был удалён или скрыт
            </p>
            <Link to="/catalog">
              <Button>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Вернуться в каталог
              </Button>
            </Link>
          </div>
        </div>
      </MainLayout>
    );
  }

  const isInStock = product.availability_status === 'in_stock' || product.stock_qty > 0;
  const discount = product.old_price 
    ? Math.round((1 - product.price / product.old_price) * 100) 
    : 0;
  const images = product.product_images.length > 0 
    ? product.product_images 
    : [{ url: "/placeholder.svg", sort_order: 0 }];
  const props = product.props as Record<string, string> | null;

  return (
    <MainLayout>
      <div className="container py-6 lg:py-8">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/" className="hover:text-foreground">Главная</Link>
          <span>/</span>
          <Link to="/catalog" className="hover:text-foreground">Каталог</Link>
          {product.categories && (
            <>
              <span>/</span>
              <Link to={`/catalog?category=${product.categories.slug}`} className="hover:text-foreground">
                {product.categories.name}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="text-foreground truncate max-w-[200px]">{product.display_title || product.title}</span>
        </nav>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Images */}
          <div className="space-y-4">
            <div className="relative aspect-square overflow-hidden rounded-lg bg-secondary/30">
              <ProductImage 
                src={images[selectedImage]?.url || "/placeholder.svg"} 
                alt={product.title}
                className="w-full h-full object-contain"
                watermarkSize="md"
              />
              {discount > 0 && (
                <Badge className="absolute top-4 left-4 bg-destructive text-destructive-foreground">
                  -{discount}%
                </Badge>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {images.map((img, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedImage(index)}
                    className={`shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedImage === index ? "border-primary" : "border-transparent"
                    }`}
                  >
                    <img 
                      src={img.url} 
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-6">
            <div>
              {product.brand && (
                <p className="text-sm text-muted-foreground mb-1">{product.brand}</p>
              )}
              <h1 className="text-2xl lg:text-3xl font-display font-bold">
                {product.display_title || product.title}
              </h1>
              {product.sku && (
                <p className="text-sm text-muted-foreground mt-2">
                  Артикул: {product.sku}
                </p>
              )}
            </div>

            <StockIndicator stockQty={product.stock_qty} availabilityStatus={product.availability_status} />

            <div className="flex items-baseline gap-3">
              <span className="font-display text-4xl font-bold">
                {product.price.toLocaleString()} ₽
              </span>
              {product.old_price && (
                <span className="text-xl text-muted-foreground line-through">
                  {product.old_price.toLocaleString()} ₽
                </span>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                size="lg"
                className="flex-1"
                onClick={() => {
                  addItem({
                    id: product.id,
                    title: product.display_title || product.title,
                    price: product.price,
                    image: images[0]?.url !== "/placeholder.svg" ? images[0]?.url : undefined,
                    sku: product.sku,
                  });
                }}
              >
                <ShoppingCart className="h-5 w-5 mr-2" />
                В корзину
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                onClick={() => product && toggleFavorite(product.id)}
              >
                <Heart className={cn(
                  "h-5 w-5 transition-colors",
                  product && isFavorite(product.id) ? "fill-red-500 text-red-500" : ""
                )} />
              </Button>
              <Button size="lg" variant="outline" onClick={handleShare}>
                <Share2 className="h-5 w-5" />
              </Button>
            </div>

            {/* Ask about product button */}
            <Button
              variant="outline"
              className="w-full border-primary/30 text-primary hover:bg-primary/5"
              onClick={() => {
                const images = product.product_images || [];
                const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order);
                setProductContext({
                  id: product.id,
                  title: product.display_title || product.title,
                  price: product.price,
                  imageUrl: sorted[0]?.url || null,
                });
                openChat();
              }}
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Спросить про этот товар
            </Button>

            <Separator />

            {product.description && (
              <div>
                <h2 className="font-semibold mb-2">Описание</h2>
                <p className="text-muted-foreground whitespace-pre-line">
                  {product.description}
                </p>
              </div>
            )}

            {props && Object.keys(props).length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <h2 className="font-semibold mb-4">Характеристики</h2>
                  <div className="space-y-2">
                    {Object.entries(props).map(([key, value]) => (
                      <div key={key} className="flex justify-between py-2 border-b border-border last:border-0">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
