import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Plus, Search, Edit, Trash2, Package, Upload, Copy, Check, X, Save, Filter, RotateCcw, Image, Loader2, ChevronLeft, ChevronRight, Sparkles, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ITEMS_PER_PAGE = 50;

interface Product {
  id: string;
  title: string;
  display_title: string | null;
  sku: string | null;
  price: number;
  old_price: number | null;
  stock_qty: number;
  availability_status: string;
  is_published: boolean;
  is_popular: boolean;
  category_id: string | null;
  guid_1c: string | null;
  description: string | null;
  brand: string | null;
  categories?: { name: string } | null;
}

interface Category {
  id: string;
  name: string;
  is_enabled: boolean;
}

interface ProductForm {
  title: string;
  display_title: string;
  sku: string;
  price: string;
  old_price: string;
  stock_qty: string;
  availability_status: string;
  category_id: string;
  description: string;
  brand: string;
  is_published: boolean;
  is_popular: boolean;
}

interface SearchedImage {
  url: string;
  title: string;
  source: string;
}

const emptyForm: ProductForm = {
  title: "",
  display_title: "",
  sku: "",
  price: "",
  old_price: "",
  stock_qty: "0",
  availability_status: "in_stock",
  category_id: "",
  description: "",
  brand: "",
  is_published: true,
  is_popular: false,
};

export default function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterAvailability, setFilterAvailability] = useState<string>("all");
  const [filterPublished, setFilterPublished] = useState<string>("all");
  const [filterPopular, setFilterPopular] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showImageSearchDialog, setShowImageSearchDialog] = useState(false);
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [searchedImages, setSearchedImages] = useState<SearchedImage[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [proxiedImages, setProxiedImages] = useState<Record<string, string>>({});
  const [isBulkSearching, setIsBulkSearching] = useState(false);
  const [bulkSearchProgress, setBulkSearchProgress] = useState({ current: 0, total: 0 });
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [bulkGenProgress, setBulkGenProgress] = useState({ current: 0, total: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [showAiSettingsDialog, setShowAiSettingsDialog] = useState(false);
  const [aiSettings, setAiSettings] = useState({
    generatePhotos: true,
    generateTitles: true,
    generateDescriptions: true,
    filterCategory: "all" as string,
    filterStock: "all" as "all" | "in_stock" | "out_of_stock",
    filterHasPhoto: "no_photo" as "all" | "no_photo" | "has_photo",
    filterHasTitle: "no_title" as "all" | "no_title" | "has_title",
    filterHasDescription: "no_desc" as "all" | "no_desc" | "has_desc",
  });
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0, phase: "", retryCountdown: 0, retryAttempt: 0, successCount: 0, errorCount: 0 });
  const aiCancelRef = useRef(false);
  const { toast } = useToast();

  const importUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-1c`;

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const searchProductImages = async (customQuery?: string) => {
    const queryToUse = customQuery?.trim() || imageSearchQuery.trim() || form.title.trim();
    if (!queryToUse) {
      toast({ variant: "destructive", title: "Введите поисковый запрос или название товара" });
      return;
    }

    const categoryName = categories.find(c => c.id === form.category_id)?.name || "";
    const searchQuery = customQuery ? queryToUse : `${queryToUse} ${categoryName}`.trim();

    setIsSearchingImages(true);
    setSearchedImages([]);
    setSelectedImageUrl(null);
    setProxiedImages({});
    setShowImageSearchDialog(true);
    if (!customQuery) setImageSearchQuery(searchQuery);

    try {
      const { data, error } = await supabase.functions.invoke("search-product-images", {
        body: { query: searchQuery, limit: 12, brand: form.brand || undefined, sku: form.sku || undefined, use_ai: !!form.sku }
      });

      if (error) throw error;

      if (data?.images && data.images.length > 0) {
        setSearchedImages(data.images);
        // Proxy each image through edge function to get base64
        data.images.forEach(async (img: SearchedImage, index: number) => {
          try {
            const { data: proxyData } = await supabase.functions.invoke("search-product-images", {
              body: { proxy_url: img.url }
            });
            if (proxyData?.base64) {
              setProxiedImages(prev => ({ ...prev, [img.url]: proxyData.base64 }));
            }
          } catch (e) {
            console.error("Proxy error for", img.url, e);
          }
        });
      } else {
        toast({ variant: "destructive", title: "Изображения не найдены" });
      }
    } catch (error: any) {
      console.error("Error searching images:", error);
      toast({
        variant: "destructive",
        title: "Ошибка поиска",
        description: error?.message || "Не удалось найти изображения"
      });
    } finally {
      setIsSearchingImages(false);
    }
  };

  const selectImage = async (imageUrl: string) => {
    let productId = editingProduct?.id;

    // If no product yet, save it first
    if (!productId) {
      if (!form.title.trim()) {
        toast({ variant: "destructive", title: "Сначала введите название товара" });
        return;
      }
      try {
        const productData = {
          title: form.title.trim(),
          sku: form.sku.trim() || null,
          price: parseFloat(form.price) || 0,
          old_price: form.old_price ? parseFloat(form.old_price) : null,
          stock_qty: parseInt(form.stock_qty) || 0,
          availability_status: form.availability_status,
          category_id: form.category_id || null,
          description: form.description.trim() || null,
          brand: form.brand.trim() || null,
          is_published: form.is_published,
          is_popular: form.is_popular,
        };
        const { data: newProduct, error } = await supabase.from("products").insert(productData).select("id").single();
        if (error) throw error;
        productId = newProduct.id;
        setEditingProduct({ ...productData, id: productId, categories: null } as Product);
        toast({ title: "Товар создан" });
      } catch (error: any) {
        toast({ variant: "destructive", title: "Ошибка создания товара", description: error?.message });
        return;
      }
    }

    setSelectedImageUrl(imageUrl);

    try {
      const { error } = await supabase
        .from("product_images")
        .insert({ product_id: productId, url: imageUrl, sort_order: 0 });

      if (error) throw error;

      toast({ title: "Изображение добавлено" });
      setShowImageSearchDialog(false);
      fetchProducts();
    } catch (error: any) {
      console.error("Error adding image:", error);
      toast({ variant: "destructive", title: "Ошибка добавления", description: error?.message });
    }
  };

  // Fetch ALL products matching AI filters directly from DB (bypasses 1000 limit via pagination)
  const getAiFilteredProducts = useCallback(async () => {
    const PAGE_SIZE = 1000;
    let allProducts: Product[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("products")
        .select("id, title, display_title, sku, brand, description, category_id, stock_qty, availability_status", { count: "exact" })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (aiSettings.filterCategory !== "all" && aiSettings.filterCategory !== "none") {
        query = query.eq("category_id", aiSettings.filterCategory);
      }
      if (aiSettings.filterCategory === "none") {
        query = query.is("category_id", null);
      }
      if (aiSettings.filterStock === "in_stock") {
        query = query.or("stock_qty.gt.0,availability_status.eq.in_stock");
      }
      if (aiSettings.filterStock === "out_of_stock") {
        query = query.eq("availability_status", "out_of_stock").eq("stock_qty", 0);
      }
      if (aiSettings.filterHasTitle === "no_title") {
        query = query.is("display_title", null);
      }
      if (aiSettings.filterHasTitle === "has_title") {
        query = query.not("display_title", "is", null);
      }
      if (aiSettings.filterHasDescription === "no_desc") {
        query = query.or("description.is.null,description.eq.");
      }
      if (aiSettings.filterHasDescription === "has_desc") {
        query = query.not("description", "is", null).neq("description", "");
      }

      const { data, count } = await query;
      allProducts = allProducts.concat((data || []) as any);
      hasMore = data?.length === PAGE_SIZE;
      page++;
    }

    // Photo filter requires checking product_images table
    if (aiSettings.filterHasPhoto !== "all") {
      const { data: allProductImages } = await supabase
        .from("product_images")
        .select("product_id");
      const idsWithImages = new Set(allProductImages?.map(p => p.product_id) || []);
      
      if (aiSettings.filterHasPhoto === "no_photo") {
        allProducts = allProducts.filter(p => !idsWithImages.has(p.id));
      } else {
        allProducts = allProducts.filter(p => idsWithImages.has(p.id));
      }
    }

    return allProducts;
  }, [aiSettings]);

  const runAiGeneration = async () => {
    const filtered = await getAiFilteredProducts();
    
    if (filtered.length === 0) {
      toast({ title: "Нет товаров, подходящих под выбранные фильтры" });
      return;
    }

    const tasks: string[] = [];
    if (aiSettings.generatePhotos) tasks.push("фото");
    if (aiSettings.generateTitles) tasks.push("названия");
    if (aiSettings.generateDescriptions) tasks.push("описания");
    
    if (tasks.length === 0) {
      toast({ variant: "destructive", title: "Выберите хотя бы одну задачу" });
      return;
    }

    if (!confirm(`Запустить AI генерацию (${tasks.join(", ")}) для ${filtered.length} товаров?`)) return;

    setShowAiSettingsDialog(false);
    setAiRunning(true);
    aiCancelRef.current = false;
    let successCount = 0;
    let errorCount = 0;

    // Phase 1: Photos
    // Helper: countdown timer for retry waits
    const waitWithCountdown = async (waitMs: number, attempt: number) => {
      const totalSec = Math.ceil(waitMs / 1000);
      for (let sec = totalSec; sec > 0; sec--) {
        if (aiCancelRef.current) return;
        setAiProgress(prev => ({ ...prev, retryCountdown: sec, retryAttempt: attempt, phase: `⏳ Rate limit — повтор через ${sec}с` }));
        await new Promise(r => setTimeout(r, 1000));
      }
      setAiProgress(prev => ({ ...prev, retryCountdown: 0, retryAttempt: 0 }));
    };

    // Helper: invoke with rate-limit aware retry
    const invokeWithRetry = async (fnName: string, body: any, maxRetries = 3): Promise<any> => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { data, error } = await supabase.functions.invoke(fnName, { body });
        
        // Check for rate limit in both error object AND response data
        const errorMsg = error?.message || "";
        const dataError = typeof data === "object" && data?.error;
        const isRateLimit = errorMsg.includes("non-2xx") || errorMsg.includes("429") || 
          (dataError && (String(dataError).includes("лимит") || String(dataError).includes("429")));
        
        if (isRateLimit && attempt < maxRetries - 1) {
          const waitTime = (attempt + 1) * 30000; // 30s, 60s, 90s
          console.warn(`Rate limited on ${fnName}, waiting ${waitTime / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
          await waitWithCountdown(waitTime, attempt + 1);
          continue;
        }
        
        if (error) throw error;
        if (dataError) throw new Error(String(dataError));
        return data;
      }
      throw new Error("Max retries exceeded");
    };

    if (aiSettings.generatePhotos) {
      const { data: allProductImages } = await supabase
        .from("product_images")
        .select("product_id");
      const productIdsWithImages = new Set(allProductImages?.map(p => p.product_id) || []);
      const needPhotos = filtered.filter(p => !productIdsWithImages.has(p.id));

      for (let i = 0; i < needPhotos.length; i++) {
        if (aiCancelRef.current) break;
        const product = needPhotos[i];
        setAiProgress(prev => ({ ...prev, current: i + 1, total: needPhotos.length, phase: "🖼️ Фото" }));

        const categoryName = categories.find(c => c.id === product.category_id)?.name || "";
        try {
          const data = await invokeWithRetry("search-product-images", {
            query: product.title, limit: 6, brand: product.brand || undefined,
            category: categoryName || undefined, sku: product.sku || undefined, use_ai: true
          });
          if (data?.images?.length > 0) {
            const imageInserts = data.images.slice(0, 4).map((img: any, idx: number) => ({
              product_id: product.id, url: img.url, sort_order: idx
            }));
            const { error: insertError } = await supabase.from("product_images").insert(imageInserts);
            if (!insertError) successCount++; else errorCount++;
          } else { errorCount++; }
        } catch (e) {
          console.error(`Error searching images for ${product.title}:`, e);
          errorCount++;
        }
        setAiProgress(prev => ({ ...prev, successCount, errorCount }));
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Phase 2: Titles + Descriptions
    if (aiSettings.generateTitles || aiSettings.generateDescriptions) {
      const needContent = filtered.filter(p => {
        const needsTitle = aiSettings.generateTitles && !p.display_title;
        const needsDesc = aiSettings.generateDescriptions && (!p.description || p.description.trim() === "");
        return needsTitle || needsDesc;
      });

      for (let i = 0; i < needContent.length; i++) {
        if (aiCancelRef.current) break;
        const product = needContent[i];
        setAiProgress(prev => ({ ...prev, current: i + 1, total: needContent.length, phase: "✨ Контент" }));

        const needsTitle = aiSettings.generateTitles && !product.display_title;
        const needsDesc = aiSettings.generateDescriptions && (!product.description || product.description.trim() === "");

        try {
          const data = await invokeWithRetry("generate-description", {
            title: product.title, brand: product.brand, sku: product.sku, generate_title: needsTitle
          });

          const updateData: Record<string, any> = {};
          if (needsDesc && data?.description) updateData.description = data.description;
          if (needsTitle && data?.display_title) updateData.display_title = data.display_title;

          if (Object.keys(updateData).length > 0) {
            const { error: upErr } = await supabase.from("products").update(updateData).eq("id", product.id);
            if (!upErr) successCount++; else errorCount++;
          }
        } catch (e) {
          console.error(`Error generating content for ${product.title}:`, e);
          errorCount++;
        }
        setAiProgress(prev => ({ ...prev, successCount, errorCount }));
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    setAiRunning(false);
    setAiProgress({ current: 0, total: 0, phase: "", retryCountdown: 0, retryAttempt: 0, successCount: 0, errorCount: 0 });
    toast({ 
      title: aiCancelRef.current ? "AI генерация остановлена" : "AI генерация завершена", 
      description: `Успешно: ${successCount}, Ошибки: ${errorCount}` 
    });
    fetchProducts();
  };

  // Refetch when page or filters change
  useEffect(() => {
    fetchProducts();
  }, [currentPage, debouncedSearch, filterCategory, filterAvailability, filterPublished, filterPopular]);

  useEffect(() => {
    fetchCategories();
  }, []);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterCategory, filterAvailability, filterPublished, filterPopular]);

  const fetchProducts = async () => {
    setIsLoading(true);
    try {
      const from = (currentPage - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let query = supabase
        .from("products")
        .select(`*, categories:category_id (name)`, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      // Server-side filters
      if (debouncedSearch) {
        query = query.or(`title.ilike.%${debouncedSearch}%,sku.ilike.%${debouncedSearch}%,guid_1c.ilike.%${debouncedSearch}%`);
      }
      if (filterCategory !== "all") {
        if (filterCategory === "none") {
          query = query.is("category_id", null);
        } else {
          query = query.eq("category_id", filterCategory);
        }
      }
      if (filterAvailability === "in_stock") {
        query = query.or("availability_status.eq.in_stock,stock_qty.gt.0");
      } else if (filterAvailability === "order") {
        query = query.eq("availability_status", "order");
      } else if (filterAvailability === "none") {
        query = query.neq("availability_status", "in_stock").neq("availability_status", "order").eq("stock_qty", 0);
      }
      if (filterPublished === "published") query = query.eq("is_published", true);
      if (filterPublished === "hidden") query = query.eq("is_published", false);
      if (filterPopular === "popular") query = query.eq("is_popular", true);
      if (filterPopular === "regular") query = query.eq("is_popular", false);

      const { data, error, count } = await query;

      if (error) throw error;
      setProducts(data || []);
      setTotalProducts(count || 0);
    } catch (error) {
      console.error("Error fetching products:", error);
      toast({
        variant: "destructive",
        title: "Ошибка загрузки",
        description: "Не удалось загрузить список товаров",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCategories = async () => {
    const { data } = await supabase
      .from("categories")
      .select("id, name, is_enabled")
      .order("sort_order");
    setCategories(data || []);
  };

  const openCreateDialog = () => {
    setEditingProduct(null);
    setForm(emptyForm);
    setShowProductDialog(true);
  };

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setForm({
      title: product.title,
      display_title: (product as any).display_title || "",
      sku: product.sku || "",
      price: product.price.toString(),
      old_price: product.old_price?.toString() || "",
      stock_qty: product.stock_qty.toString(),
      availability_status: product.availability_status,
      category_id: product.category_id || "",
      description: product.description || "",
      brand: product.brand || "",
      is_published: product.is_published,
      is_popular: product.is_popular,
    });
    setShowProductDialog(true);
  };

  const handleSaveProduct = async () => {
    if (!form.title.trim()) {
      toast({ variant: "destructive", title: "Введите название товара" });
      return;
    }

    setIsSaving(true);
    try {
      const productData = {
        title: form.title.trim(),
        display_title: form.display_title.trim() || null,
        sku: form.sku.trim() || null,
        price: parseFloat(form.price) || 0,
        old_price: form.old_price ? parseFloat(form.old_price) : null,
        stock_qty: parseInt(form.stock_qty) || 0,
        availability_status: form.availability_status,
        category_id: form.category_id || null,
        description: form.description.trim() || null,
        brand: form.brand.trim() || null,
        is_published: form.is_published,
        is_popular: form.is_popular,
      };

      if (editingProduct) {
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", editingProduct.id);

        if (error) throw error;
        toast({ title: "Товар обновлён" });
      } else {
        const { error } = await supabase
          .from("products")
          .insert(productData);

        if (error) throw error;
        toast({ title: "Товар добавлен" });
      }

      setShowProductDialog(false);
      fetchProducts();
    } catch (error: any) {
      console.error("Error saving product:", error);
      toast({
        variant: "destructive",
        title: "Ошибка сохранения",
        description: error?.message || "Не удалось сохранить товар",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const togglePublished = async (product: Product) => {
    try {
      const { error } = await supabase
        .from("products")
        .update({ is_published: !product.is_published })
        .eq("id", product.id);

      if (error) throw error;

      setProducts(products.map(p => 
        p.id === product.id ? { ...p, is_published: !p.is_published } : p
      ));

      toast({
        title: product.is_published ? "Товар скрыт" : "Товар опубликован",
      });
    } catch (error) {
      console.error("Error updating product:", error);
    }
  };

  const togglePopular = async (product: Product) => {
    try {
      const { error } = await supabase
        .from("products")
        .update({ is_popular: !product.is_popular })
        .eq("id", product.id);

      if (error) throw error;

      setProducts(products.map(p => 
        p.id === product.id ? { ...p, is_popular: !p.is_popular } : p
      ));

      toast({
        title: product.is_popular ? "Убрано из популярных" : "Добавлено в популярные",
      });
    } catch (error) {
      console.error("Error updating product:", error);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!confirm("Удалить товар?")) return;

    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setProducts(products.filter(p => p.id !== id));
      toast({ title: "Товар удалён" });
    } catch (error) {
      console.error("Error deleting product:", error);
    }
  };

  const deleteAllProducts = async () => {
    if (!confirm("Удалить ВСЕ товары? Это действие нельзя отменить!")) return;

    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) throw error;

      setProducts([]);
      toast({ title: "Все товары удалены" });
    } catch (error) {
      console.error("Error deleting products:", error);
    }
  };

  const toggleCategoryEnabled = async (cat: Category) => {
    try {
      const { error } = await supabase
        .from("categories")
        .update({ is_enabled: !cat.is_enabled })
        .eq("id", cat.id);

      if (error) throw error;

      setCategories(categories.map(c => 
        c.id === cat.id ? { ...c, is_enabled: !c.is_enabled } : c
      ));

      toast({
        title: cat.is_enabled ? "Категория скрыта" : "Категория активирована",
      });
    } catch (error) {
      console.error("Error updating category:", error);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(importUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "URL скопирован" });
  };

  // Server-side pagination — products already filtered & paginated from DB
  const totalPages = Math.ceil(totalProducts / ITEMS_PER_PAGE);
  const paginatedProducts = products; // already paginated from fetchProducts

  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const showPages = 5;
    
    if (totalPages <= showPages + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      
      if (currentPage > 3) {
        pages.push('ellipsis');
      }
      
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      if (currentPage < totalPages - 2) {
        pages.push('ellipsis');
      }
      
      pages.push(totalPages);
    }
    
    return pages;
  };

  const getAvailabilityBadge = (status: string, qty: number) => {
    if (status === "in_stock" || qty > 0) {
      return <Badge className="bg-green-500">В наличии ({qty})</Badge>;
    }
    if (status === "order") {
      return <Badge variant="secondary">Под заказ</Badge>;
    }
    return <Badge variant="destructive">Нет</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Товары</h1>
          <p className="text-muted-foreground mt-1">
            Управление каталогом товаров
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Импорт из 1С
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Импорт товаров из 1С</DialogTitle>
                <DialogDescription>
                  Настройте 1С для отправки товаров по этому URL
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">URL для импорта</label>
                  <div className="flex gap-2 mt-1">
                    <Input value={importUrl} readOnly className="font-mono text-sm" />
                    <Button variant="outline" size="icon" onClick={copyToClipboard}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-2 block">Формат данных (JSON)</label>
                  <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`{
  "products": [
    {
      "guid": "уникальный-id-из-1с",
      "name": "Название товара",
      "sku": "Артикул",
      "brand": "Бренд",
      "price": 1000,
      "old_price": 1200,
      "stock_qty": 5,
      "availability_status": "in_stock",
      "category_guid": "guid-категории",
      "description": "Описание",
      "images": ["url1", "url2"]
    }
  ],
  "category_mapping": {
    "guid-категории-1с": "id-категории-в-системе"
  }
}`}
                  </pre>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Активные категории для импорта</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {categories.map(cat => (
                      <label key={cat.id} className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={cat.is_enabled}
                          onChange={() => toggleCategoryEnabled(cat)}
                          className="rounded"
                        />
                        <span className="text-sm">{cat.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{cat.id}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button 
            variant="outline" 
            onClick={() => setShowAiSettingsDialog(true)}
            disabled={aiRunning}
          >
            {aiRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            AI генерация
          </Button>

          {/* AI Progress Panel */}
          {aiRunning && (
            <div className="fixed bottom-4 right-4 z-50 w-96 bg-card border border-border rounded-lg shadow-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{aiProgress.phase}</span>
                <span className="text-xs text-muted-foreground">
                  {aiProgress.current}/{aiProgress.total}
                </span>
              </div>
              
              {/* Progress bar */}
              <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-primary h-full rounded-full transition-all duration-500"
                  style={{ width: `${aiProgress.total > 0 ? (aiProgress.current / aiProgress.total) * 100 : 0}%` }}
                />
              </div>

              {/* Retry countdown */}
              {aiProgress.retryCountdown > 0 && (
                <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-md p-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-destructive" />
                  <span className="text-xs text-destructive">
                    Попытка {aiProgress.retryAttempt}/3 — повтор через {aiProgress.retryCountdown}с
                  </span>
                  <div className="ml-auto w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-destructive h-full rounded-full transition-all duration-1000"
                      style={{ width: `${(aiProgress.retryCountdown / ((aiProgress.retryAttempt || 1) * 15)) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Success / Error counters + Cancel */}
              <div className="flex items-center gap-3 text-xs">
                <span className="text-green-600 dark:text-green-400">✓ {aiProgress.successCount}</span>
                <span className="text-destructive">✗ {aiProgress.errorCount}</span>
                <span className="text-muted-foreground">
                  {Math.round(aiProgress.total > 0 ? (aiProgress.current / aiProgress.total) * 100 : 0)}%
                </span>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={() => { aiCancelRef.current = true; }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Остановить
                </Button>
              </div>
            </div>
          )}
          <Button variant="destructive" size="sm" onClick={deleteAllProducts}>
            <Trash2 className="h-4 w-4 mr-2" />
            Удалить все
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить товар
          </Button>
        </div>
      </div>

      {/* AI Settings Dialog */}
      <Dialog open={showAiSettingsDialog} onOpenChange={setShowAiSettingsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>⚡ AI генерация контента</DialogTitle>
            <DialogDescription>
              Настройте параметры массовой генерации
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-5 py-2">
            {/* What to generate */}
            <div>
              <Label className="text-sm font-semibold mb-3 block">Что генерировать</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer">
                  <input type="checkbox" checked={aiSettings.generatePhotos} onChange={e => setAiSettings(s => ({ ...s, generatePhotos: e.target.checked }))} className="rounded" />
                  <Image className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Фотографии (поиск в интернете)</span>
                </label>
                <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer">
                  <input type="checkbox" checked={aiSettings.generateTitles} onChange={e => setAiSettings(s => ({ ...s, generateTitles: e.target.checked }))} className="rounded" />
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Названия для покупателей</span>
                </label>
                <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer">
                  <input type="checkbox" checked={aiSettings.generateDescriptions} onChange={e => setAiSettings(s => ({ ...s, generateDescriptions: e.target.checked }))} className="rounded" />
                  <Edit className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Описания товаров</span>
                </label>
              </div>
            </div>

            <Separator />

            {/* Filters */}
            <div>
              <Label className="text-sm font-semibold mb-3 block">Фильтры товаров</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Категория</Label>
                  <Select value={aiSettings.filterCategory} onValueChange={v => setAiSettings(s => ({ ...s, filterCategory: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все категории</SelectItem>
                      <SelectItem value="none">Без категории</SelectItem>
                      {categories.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Наличие</Label>
                  <Select value={aiSettings.filterStock} onValueChange={v => setAiSettings(s => ({ ...s, filterStock: v as any }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="in_stock">В наличии</SelectItem>
                      <SelectItem value="out_of_stock">Нет в наличии</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Фото</Label>
                  <Select value={aiSettings.filterHasPhoto} onValueChange={v => setAiSettings(s => ({ ...s, filterHasPhoto: v as any }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="no_photo">Без фото</SelectItem>
                      <SelectItem value="has_photo">С фото</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Название</Label>
                  <Select value={aiSettings.filterHasTitle} onValueChange={v => setAiSettings(s => ({ ...s, filterHasTitle: v as any }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="no_title">Без названия</SelectItem>
                      <SelectItem value="has_title">С названием</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Описание</Label>
                  <Select value={aiSettings.filterHasDescription} onValueChange={v => setAiSettings(s => ({ ...s, filterHasDescription: v as any }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="no_desc">Без описания</SelectItem>
                      <SelectItem value="has_desc">С описанием</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAiSettingsDialog(false)}>Отмена</Button>
            <Button onClick={runAiGeneration} disabled={!aiSettings.generatePhotos && !aiSettings.generateTitles && !aiSettings.generateDescriptions}>
              <Sparkles className="h-4 w-4 mr-2" />
              Запустить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Edit Dialog */}
      <Dialog open={showProductDialog} onOpenChange={setShowProductDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Редактировать товар" : "Добавить товар"}</DialogTitle>
            <DialogDescription>
              {editingProduct ? "Измените данные товара" : "Заполните информацию о новом товаре"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Название (1С) *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Техническое название товара"
                readOnly={!!editingProduct?.guid_1c}
                className={editingProduct?.guid_1c ? "bg-muted" : ""}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="display_title">Название для покупателей</Label>
              <div className="flex gap-2">
                <Input
                  id="display_title"
                  value={form.display_title}
                  onChange={(e) => setForm({ ...form, display_title: e.target.value })}
                  placeholder="Красивое название для сайта"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!form.title.trim()}
                  onClick={async () => {
                    try {
                      const { data, error } = await supabase.functions.invoke("generate-description", {
                        body: { title: form.title, brand: form.brand, sku: form.sku, generate_title: true }
                      });
                      if (error) throw error;
                      if (data?.display_title) {
                        setForm(f => ({ ...f, display_title: data.display_title }));
                        toast({ title: "Название сгенерировано" });
                      }
                    } catch (err: any) {
                      toast({ variant: "destructive", title: "Ошибка генерации", description: err?.message });
                    }
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </div>
              {form.display_title && (
                <p className="text-xs text-muted-foreground">
                  Покупатели увидят: <span className="font-medium text-foreground">{form.display_title}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sku">Артикул</Label>
                <Input
                  id="sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="SKU-001"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="brand">Бренд</Label>
                <Input
                  id="brand"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  placeholder="Название бренда"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="price">Цена *</Label>
                <Input
                  id="price"
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="old_price">Старая цена</Label>
                <Input
                  id="old_price"
                  type="number"
                  value={form.old_price}
                  onChange={(e) => setForm({ ...form, old_price: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="stock_qty">Остаток</Label>
                <Input
                  id="stock_qty"
                  type="number"
                  value={form.stock_qty}
                  onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="category">Категория</Label>
                <Select
                  value={form.category_id || "none"}
                  onValueChange={(value) => setForm({ ...form, category_id: value === "none" ? "" : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите категорию" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без категории</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="availability">Наличие</Label>
                <Select
                  value={form.availability_status}
                  onValueChange={(value) => setForm({ ...form, availability_status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_stock">В наличии</SelectItem>
                    <SelectItem value="order">Под заказ</SelectItem>
                    <SelectItem value="none">Нет в наличии</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Описание</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Описание товара..."
                rows={3}
              />
            </div>

            {/* Image search section */}
            <div className="grid gap-2">
              <Label>Изображения</Label>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => searchProductImages()}
                disabled={!form.title.trim()}
              >
                <Image className="h-4 w-4 mr-2" />
                Найти фото в интернете
              </Button>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="is_published"
                  checked={form.is_published}
                  onCheckedChange={(checked) => setForm({ ...form, is_published: checked })}
                />
                <Label htmlFor="is_published">Опубликован</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_popular"
                  checked={form.is_popular}
                  onCheckedChange={(checked) => setForm({ ...form, is_popular: checked })}
                />
                <Label htmlFor="is_popular">Популярный</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProductDialog(false)}>
              <X className="h-4 w-4 mr-2" />
              Отмена
            </Button>
            <Button onClick={handleSaveProduct} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Search Dialog */}
      <Dialog open={showImageSearchDialog} onOpenChange={setShowImageSearchDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Поиск изображений</DialogTitle>
            <DialogDescription>
              Нажмите на изображение, чтобы добавить его к товару
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex gap-2">
            <Input
              value={imageSearchQuery}
              onChange={(e) => setImageSearchQuery(e.target.value)}
              placeholder="Поисковый запрос..."
              onKeyDown={(e) => e.key === "Enter" && searchProductImages(imageSearchQuery)}
            />
            <Button 
              onClick={() => searchProductImages(imageSearchQuery)} 
              disabled={isSearchingImages || !imageSearchQuery.trim()}
            >
              {isSearchingImages ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          <div className="py-2">
            {isSearchingImages ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Ищем изображения с помощью ИИ...</p>
              </div>
            ) : searchedImages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Изображения не найдены. Попробуйте изменить запрос.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {searchedImages.map((img, index) => (
                  <div 
                    key={index}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer transition-all hover:border-primary hover:shadow-lg ${
                      selectedImageUrl === img.url ? "border-primary ring-2 ring-primary" : "border-border"
                    }`}
                    onClick={() => selectImage(img.url)}
                  >
                    {proxiedImages[img.url] ? (
                      <img
                        src={proxiedImages[img.url]}
                        alt={img.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-[10px] text-white truncate">{img.title}</p>
                      <p className="text-[9px] text-white/70 truncate">{img.source}</p>
                    </div>
                    {selectedImageUrl === img.url && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <Check className="h-8 w-8 text-primary-foreground bg-primary rounded-full p-1" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-3 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию, артикулу или GUID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Найдено: {totalProducts.toLocaleString()}
            </div>
          </div>
          
          {/* Filters row */}
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Категория" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все категории</SelectItem>
                <SelectItem value="none">Без категории</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterAvailability} onValueChange={setFilterAvailability}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Наличие" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Любое наличие</SelectItem>
                <SelectItem value="in_stock">В наличии</SelectItem>
                <SelectItem value="order">Под заказ</SelectItem>
                <SelectItem value="none">Нет в наличии</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterPublished} onValueChange={setFilterPublished}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Любой статус</SelectItem>
                <SelectItem value="published">Опубликованные</SelectItem>
                <SelectItem value="hidden">Скрытые</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterPopular} onValueChange={setFilterPopular}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Популярность" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все товары</SelectItem>
                <SelectItem value="popular">Популярные</SelectItem>
                <SelectItem value="regular">Обычные</SelectItem>
              </SelectContent>
            </Select>

            {(filterCategory !== "all" || filterAvailability !== "all" || filterPublished !== "all" || filterPopular !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterCategory("all");
                  setFilterAvailability("all");
                  setFilterPublished("all");
                  setFilterPopular("all");
                }}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Сбросить
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Загрузка...
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground">Товары не найдены</p>
              <p className="text-sm text-muted-foreground mt-2">
                Импортируйте товары из 1С или добавьте вручную
              </p>
              <Button className="mt-4" onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить первый товар
              </Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Артикул</TableHead>
                    <TableHead>Категория</TableHead>
                    <TableHead>Цена</TableHead>
                    <TableHead>Наличие</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div>
                          {product.display_title ? (
                            <>
                              <span className="font-medium">{product.display_title}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">{product.title}</p>
                            </>
                          ) : (
                            <span className="font-medium">{product.title}</span>
                          )}
                          {product.guid_1c && (
                            <p className="text-xs text-muted-foreground/60 font-mono">
                              {product.guid_1c.slice(0, 8)}...
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {product.sku || "—"}
                      </TableCell>
                      <TableCell>
                        {product.categories?.name || "—"}
                      </TableCell>
                      <TableCell>
                        {product.price.toLocaleString("ru-RU")} ₽
                      </TableCell>
                      <TableCell>
                        {getAvailabilityBadge(product.availability_status, product.stock_qty)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge 
                            variant={product.is_published ? "default" : "secondary"}
                            className="cursor-pointer"
                            onClick={() => togglePublished(product)}
                          >
                            {product.is_published ? "Опубл." : "Скрыт"}
                          </Badge>
                          <Badge 
                            variant={product.is_popular ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() => togglePopular(product)}
                          >
                            {product.is_popular ? "★" : "☆"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(product)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => deleteProduct(product.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Показано {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, totalProducts)} из {totalProducts.toLocaleString()}
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious 
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      
                      {getPageNumbers().map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={() => setCurrentPage(page)}
                              isActive={currentPage === page}
                              className="cursor-pointer"
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      
                      <PaginationItem>
                        <PaginationNext 
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}