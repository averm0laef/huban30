import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShoppingCart, Heart, Share2, ExternalLink, X, ChevronLeft, ChevronRight } from "lucide-react";
import { StockIndicator } from "@/components/StockIndicator";
import { ProductImage } from "@/components/ProductImage";
import { supabase } from "@/integrations/supabase/client";
import { useFavorites } from "@/hooks/useFavorites";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProductImage {
  url: string;
  sort_order: number;
}

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
  props: Record<string, string> | null;
  category_id: string | null;
  categories?: { name: string; slug: string } | null;
  product_images: ProductImage[];
}

interface ProductQuickViewProps {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductQuickView({ productId, open, onOpenChange }: ProductQuickViewProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const { isFavorite, toggleFavorite } = useFavorites();

  useEffect(() => {
    if (productId && open) {
      fetchProduct(productId);
    }
  }, [productId, open]);

  useEffect(() => {
    if (!open) {
      setSelectedImage(0);
    }
  }, [open]);

  const fetchProduct = async (id: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .select(`
          *,
          categories:category_id (name, slug),
          product_images (url, sort_order)
        `)
        .eq("id", id)
        .eq("is_published", true)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setProduct({
          ...data,
          props: data.props as Record<string, string> | null,
          product_images: (data.product_images || []).sort((a: ProductImage, b: ProductImage) => a.sort_order - b.sort_order)
        });
      }
    } catch (error) {
      console.error("Error fetching product:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/catalog/product/${productId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована!");
    } catch {
      toast.success("Ссылка скопирована!");
    }
  };

  const nextImage = () => {
    if (product && product.product_images.length > 1) {
      setSelectedImage((prev) => (prev + 1) % product.product_images.length);
    }
  };

  const prevImage = () => {
    if (product && product.product_images.length > 1) {
      setSelectedImage((prev) => (prev - 1 + product.product_images.length) % product.product_images.length);
    }
  };

  if (!product && !isLoading) return null;

  const isInStock = product?.availability_status === "in_stock" || (product?.stock_qty ?? 0) > 0;
  const discount = product?.old_price
    ? Math.round((1 - (product?.price ?? 0) / product.old_price) * 100)
    : 0;
  const images = product?.product_images?.length
    ? product.product_images
    : [{ url: "/placeholder.svg", sort_order: 0 }];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{product?.title || "Загрузка..."}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : product ? (
          <div className="grid md:grid-cols-2 gap-0">
            {/* Image Section */}
            <div className="relative bg-secondary/30 aspect-square md:aspect-auto md:h-full">
              <ProductImage
                src={images[selectedImage]?.url || "/placeholder.svg"}
                alt={product.title}
                className="w-full h-full object-contain"
                watermarkSize="md"
              />
              
              {/* Discount Badge */}
              {discount > 0 && (
                <Badge className="absolute top-4 left-4 bg-destructive text-destructive-foreground">
                  -{discount}%
                </Badge>
              )}

              {/* Image Navigation */}
              {images.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition-colors"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  
                  {/* Image Dots */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setSelectedImage(index)}
                        className={cn(
                          "w-2 h-2 rounded-full transition-colors",
                          selectedImage === index ? "bg-primary" : "bg-foreground/30"
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Info Section */}
            <ScrollArea className="max-h-[70vh] md:max-h-[90vh]">
              <div className="p-6 space-y-4">
                {/* Brand & Title */}
                <div>
                  {product.brand && (
                    <p className="text-sm text-muted-foreground mb-1">{product.brand}</p>
                  )}
                  <h2 className="text-xl lg:text-2xl font-display font-bold">
                    {product.display_title || product.title}
                  </h2>
                  {product.sku && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Артикул: {product.sku}
                    </p>
                  )}
                </div>

                {/* Stock Status */}
                <StockIndicator stockQty={product.stock_qty} availabilityStatus={product.availability_status} />

                {/* Price */}
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-3xl font-bold">
                    {product.price.toLocaleString()} ₽
                  </span>
                  {product.old_price && (
                    <span className="text-lg text-muted-foreground line-through">
                      {product.old_price.toLocaleString()} ₽
                    </span>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button size="lg" className="flex-1">
                    <ShoppingCart className="h-5 w-5 mr-2" />
                    В корзину
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => toggleFavorite(product.id)}
                  >
                    <Heart
                      className={cn(
                        "h-5 w-5 transition-colors",
                        isFavorite(product.id) ? "fill-red-500 text-red-500" : ""
                      )}
                    />
                  </Button>
                  <Button size="lg" variant="outline" onClick={handleShare}>
                    <Share2 className="h-5 w-5" />
                  </Button>
                </div>

                <Separator />

                {/* Description */}
                {product.description && (
                  <div>
                    <h3 className="font-semibold mb-2">Описание</h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-4">
                      {product.description}
                    </p>
                  </div>
                )}

                {/* Properties */}
                {product.props && Object.keys(product.props).length > 0 && (
                  <div className="bg-secondary/30 rounded-lg p-4">
                    <h3 className="font-semibold mb-3">Характеристики</h3>
                    <div className="space-y-2">
                      {Object.entries(product.props).slice(0, 5).map(([key, value]) => (
                        <div key={key} className="flex justify-between py-1 text-sm">
                          <span className="text-muted-foreground">{key}</span>
                          <span className="font-medium">{value}</span>
                        </div>
                      ))}
                      {Object.keys(product.props).length > 5 && (
                        <p className="text-sm text-muted-foreground pt-2">
                          +{Object.keys(product.props).length - 5} характеристик
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Full Product Link */}
                <Link
                  to={`/catalog/product/${product.id}`}
                  onClick={() => onOpenChange(false)}
                  className="block"
                >
                  <Button variant="outline" className="w-full">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Открыть полную страницу товара
                  </Button>
                </Link>
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}