import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package, Loader2 } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { supabase } from "@/integrations/supabase/client";

interface Category {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  productCount: number;
}

export function CategoriesSection() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const { data: categoriesData, error: catError } = await supabase
        .from("categories")
        .select("id, name, slug, image_url")
        .eq("is_enabled", true)
        .order("sort_order");

      if (catError) throw catError;

      const { data: products, error: prodError } = await supabase
        .from("products")
        .select("category_id")
        .eq("is_published", true);

      if (prodError) throw prodError;

      const countMap: Record<string, number> = {};
      products?.forEach((p) => {
        if (p.category_id) {
          countMap[p.category_id] = (countMap[p.category_id] || 0) + 1;
        }
      });

      const categoriesWithCounts = (categoriesData || []).map((cat) => ({
        ...cat,
        productCount: countMap[cat.id] || 0,
      }));

      setCategories(categoriesWithCounts);
    } catch (error) {
      console.error("Error fetching categories:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <section className="py-6 sm:py-8 lg:py-10">
        <div className="container px-4 sm:px-6 flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    <section className="py-6 sm:py-8 lg:py-10">
      <div className="container px-4 sm:px-6">
        <ScrollReveal>
          <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold text-foreground text-center mb-6 sm:mb-8">
            Запчасти в интернет-магазине
          </h2>
        </ScrollReveal>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4">
          {categories.map((category, index) => (
            <ScrollReveal key={category.id} delay={index * 50}>
              <Link to={`/catalog?category=${category.slug}`}>
                <div className="group backdrop-blur-md bg-card/70 border border-border/40 hover:border-primary/30 rounded-2xl p-4 sm:p-5 flex flex-col items-center text-center transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 mb-3 flex items-center justify-center overflow-hidden">
                    {category.image_url ? (
                      <img 
                        src={category.image_url} 
                        alt={category.name}
                        loading="lazy"
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full rounded-xl bg-primary/5 backdrop-blur-sm flex items-center justify-center">
                        <Package className="h-8 w-8 sm:h-10 sm:w-10 text-primary/40" />
                      </div>
                    )}
                  </div>
                  
                  <h3 className="font-medium text-foreground text-sm sm:text-base group-hover:text-primary transition-colors leading-tight">
                    {category.name}
                  </h3>
                </div>
              </Link>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
