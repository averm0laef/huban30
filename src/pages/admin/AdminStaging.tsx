import { useEffect, useState, useMemo } from "react";
import {
  Package, Eye, Trash2, RefreshCw, CheckCheck, Search, Filter,
  ArrowUpDown, ArrowUp, ArrowDown, FolderTree, Tag, MoreHorizontal,
  Download, Upload, AlertTriangle, Info, Clock, Image, Loader2, X, Sparkles, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface StagingProduct {
  id: string;
  title: string;
  sku: string | null;
  brand: string | null;
  price: number;
  old_price: number | null;
  stock_qty: number;
  availability_status: string;
  description: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
  guid_1c: string | null;
  is_popular: boolean;
}

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  slug: string;
}

interface ProductImage {
  id: string;
  url: string;
  sort_order: number;
}

type SortField = "title" | "price" | "stock_qty" | "created_at" | "brand";
type SortDir = "asc" | "desc";

export default function AdminStaging() {
  const [products, setProducts] = useState<StagingProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [editProduct, setEditProduct] = useState<StagingProduct | null>(null);
  const [editImages, setEditImages] = useState<ProductImage[]>([]);
  const [editForm, setEditForm] = useState({
    title: "", price: 0, old_price: "" as string, description: "",
    sku: "", brand: "", category_id: "", availability_status: "in_stock",
    stock_qty: 0, is_popular: false,
  });
  const { toast } = useToast();

  // Filters & search
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBrand, setFilterBrand] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterPrice, setFilterPrice] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Dialogs
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBulkCategory, setShowBulkCategory] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState("");

  // Image search
  const [isBulkSearchingImages, setIsBulkSearchingImages] = useState(false);
  const [bulkImageProgress, setBulkImageProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 });
  const [showImageSearchDialog, setShowImageSearchDialog] = useState(false);

  // Description generation
  const [isBulkGeneratingDesc, setIsBulkGeneratingDesc] = useState(false);
  const [bulkDescProgress, setBulkDescProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 });
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [searchedImages, setSearchedImages] = useState<Array<{ url: string; title: string; source: string }>>([]);
  const [proxiedImages, setProxiedImages] = useState<Record<string, string>>({});
  const [imageSearchProductId, setImageSearchProductId] = useState<string | null>(null);

  // Stats
  const [importStats, setImportStats] = useState({ today: 0, week: 0, total: 0 });

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  const fetchProducts = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from("products")
      .select("id, title, sku, brand, price, old_price, stock_qty, availability_status, description, category_id, created_at, updated_at, guid_1c, is_popular")
      .eq("is_published", false)
      .order("created_at", { ascending: false })
      .limit(500);
    const prods = (data || []) as StagingProduct[];
    setProducts(prods);
    setSelected(new Set());

    // Compute stats
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();
    setImportStats({
      today: prods.filter(p => p.created_at >= todayStart).length,
      week: prods.filter(p => p.created_at >= weekStart).length,
      total: prods.length,
    });

    setIsLoading(false);
  };

  const fetchCategories = async () => {
    const { data } = await supabase
      .from("categories")
      .select("id, name, parent_id, slug")
      .eq("is_enabled", true)
      .order("sort_order");
    setCategories(data || []);
  };

  // Unique brands for filter
  const uniqueBrands = useMemo(() => {
    const brands = new Set(products.map(p => p.brand).filter(Boolean) as string[]);
    return Array.from(brands).sort();
  }, [products]);

  // Filtered & sorted products
  const filteredProducts = useMemo(() => {
    let result = [...products];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(p =>
        p.title.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.guid_1c && p.guid_1c.toLowerCase().includes(q))
      );
    }

    if (filterBrand !== "all") {
      result = result.filter(p => p.brand === filterBrand);
    }
    if (filterStatus !== "all") {
      result = result.filter(p => p.availability_status === filterStatus);
    }
    if (filterCategory === "none") {
      result = result.filter(p => !p.category_id);
    } else if (filterCategory !== "all") {
      result = result.filter(p => p.category_id === filterCategory);
    }
    if (filterPrice === "zero") {
      result = result.filter(p => p.price === 0);
    } else if (filterPrice === "has_old") {
      result = result.filter(p => p.old_price !== null && p.old_price > 0);
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title": cmp = a.title.localeCompare(b.title, "ru"); break;
        case "price": cmp = a.price - b.price; break;
        case "stock_qty": cmp = a.stock_qty - b.stock_qty; break;
        case "created_at": cmp = a.created_at.localeCompare(b.created_at); break;
        case "brand": cmp = (a.brand || "").localeCompare(b.brand || "", "ru"); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [products, searchQuery, filterBrand, filterStatus, filterCategory, filterPrice, sortField, sortDir]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filteredProducts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredProducts.map(p => p.id)));
    }
  };

  const publishSelected = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("products")
      .update({ is_published: true, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Опубликовано ${ids.length} товаров` });
      fetchProducts();
    }
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    await supabase.from("product_images").delete().in("product_id", ids);
    const { error } = await supabase.from("products").delete().in("id", ids);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Удалено ${ids.length} товаров` });
      fetchProducts();
    }
    setShowDeleteConfirm(false);
  };

  const assignCategoryBulk = async () => {
    if (selected.size === 0 || !bulkCategoryId) return;
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("products")
      .update({ category_id: bulkCategoryId, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Категория назначена для ${ids.length} товаров` });
      fetchProducts();
    }
    setShowBulkCategory(false);
    setBulkCategoryId("");
  };

  // Bulk auto-search images for selected products
  const bulkSearchImages = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const targetProducts = products.filter(p => ids.includes(p.id));

    // Check which ones already have images
    const { data: existingImages } = await supabase
      .from("product_images")
      .select("product_id")
      .in("product_id", ids);
    const withImages = new Set(existingImages?.map(i => i.product_id) || []);
    const productsToSearch = targetProducts.filter(p => !withImages.has(p.id));

    if (productsToSearch.length === 0) {
      toast({ title: "У всех выбранных товаров уже есть фото" });
      return;
    }

    setIsBulkSearchingImages(true);
    setBulkImageProgress({ current: 0, total: productsToSearch.length, success: 0, failed: 0 });

    let success = 0;
    let failed = 0;

    for (let i = 0; i < productsToSearch.length; i++) {
      const product = productsToSearch[i];
      setBulkImageProgress({ current: i + 1, total: productsToSearch.length, success, failed });

      try {
        const { data, error } = await supabase.functions.invoke("search-product-images", {
          body: { query: `${product.title} автозапчасть фото товара`, limit: 3 }
        });

        if (error) throw error;

        if (data?.images && data.images.length > 0) {
          // Pick the first image
          const imageUrl = data.images[0].url;
          const { error: insertError } = await supabase
            .from("product_images")
            .insert({ product_id: product.id, url: imageUrl, sort_order: 0 });

          if (!insertError) {
            success++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } catch (e) {
        console.error(`Image search error for ${product.title}:`, e);
        failed++;
      }

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    setBulkImageProgress({ current: productsToSearch.length, total: productsToSearch.length, success, failed });
    setIsBulkSearchingImages(false);

    toast({
      title: `Поиск фото завершён`,
      description: `Найдено: ${success}, не найдено: ${failed}`,
    });

    if (editProduct) {
      const { data } = await supabase
        .from("product_images")
        .select("id, url, sort_order")
        .eq("product_id", editProduct.id)
        .order("sort_order");
      setEditImages(data || []);
    }
  };

  // Bulk auto-generate descriptions for selected products
  const bulkGenerateDescriptions = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const productsToGenerate = products.filter(p => ids.includes(p.id) && !p.description?.trim());

    if (productsToGenerate.length === 0) {
      toast({ title: "У всех выбранных товаров уже есть описание" });
      return;
    }

    setIsBulkGeneratingDesc(true);
    setBulkDescProgress({ current: 0, total: productsToGenerate.length, success: 0, failed: 0 });

    let success = 0;
    let failed = 0;

    for (let i = 0; i < productsToGenerate.length; i++) {
      const product = productsToGenerate[i];
      setBulkDescProgress({ current: i + 1, total: productsToGenerate.length, success, failed });

      try {
        const { data, error } = await supabase.functions.invoke("generate-description", {
          body: { title: product.title, brand: product.brand, sku: product.sku }
        });

        if (error) throw error;

        if (data?.description) {
          const { error: updateError } = await supabase
            .from("products")
            .update({ description: data.description, updated_at: new Date().toISOString() })
            .eq("id", product.id);

          if (!updateError) {
            success++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } catch (e) {
        console.error(`Description generation error for ${product.title}:`, e);
        failed++;
      }

      await new Promise(resolve => setTimeout(resolve, 800));
    }

    setBulkDescProgress({ current: productsToGenerate.length, total: productsToGenerate.length, success, failed });
    setIsBulkGeneratingDesc(false);

    toast({
      title: "Генерация описаний завершена",
      description: `Сгенерировано: ${success}, ошибок: ${failed}`,
    });

    fetchProducts();
  };

  // Single product description generation
  const generateDescriptionForProduct = async () => {
    if (!editProduct) return;
    setIsGeneratingDesc(true);

    try {
      const { data, error } = await supabase.functions.invoke("generate-description", {
        body: { title: editForm.title, brand: editForm.brand, sku: editForm.sku }
      });

      if (error) throw error;

      if (data?.description) {
        setEditForm(f => ({ ...f, description: data.description }));
        toast({ title: "Описание сгенерировано" });
      } else {
        toast({ variant: "destructive", title: "Не удалось сгенерировать описание" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Ошибка", description: e?.message });
    } finally {
      setIsGeneratingDesc(false);
    }
  };

  const searchImagesForProduct = async (customQuery?: string) => {
    if (!editProduct) return;
    const query = customQuery?.trim() || imageSearchQuery.trim() || editForm.title.trim();
    if (!query) {
      toast({ variant: "destructive", title: "Введите поисковый запрос" });
      return;
    }

    setIsSearchingImages(true);
    setSearchedImages([]);
    setProxiedImages({});
    setImageSearchProductId(editProduct.id);
    setShowImageSearchDialog(true);
    if (!customQuery) setImageSearchQuery(query);

    try {
      const { data, error } = await supabase.functions.invoke("search-product-images", {
        body: { query: `${query} автозапчасть фото товара`, limit: 12 }
      });

      if (error) throw error;

      if (data?.images && data.images.length > 0) {
        setSearchedImages(data.images);
        data.images.forEach(async (img: { url: string }) => {
          try {
            const { data: proxyData } = await supabase.functions.invoke("search-product-images", {
              body: { proxy_url: img.url }
            });
            if (proxyData?.base64) {
              setProxiedImages(prev => ({ ...prev, [img.url]: proxyData.base64 }));
            }
          } catch (e) { /* skip */ }
        });
      } else {
        toast({ variant: "destructive", title: "Изображения не найдены" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Ошибка поиска", description: e?.message });
    } finally {
      setIsSearchingImages(false);
    }
  };

  const selectFoundImage = async (imageUrl: string) => {
    if (!imageSearchProductId) return;

    try {
      const { error } = await supabase
        .from("product_images")
        .insert({ product_id: imageSearchProductId, url: imageUrl, sort_order: editImages.length });
      if (error) throw error;

      toast({ title: "Изображение добавлено" });
      setShowImageSearchDialog(false);

      // Refresh images
      const { data } = await supabase
        .from("product_images")
        .select("id, url, sort_order")
        .eq("product_id", imageSearchProductId)
        .order("sort_order");
      setEditImages(data || []);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Ошибка", description: e?.message });
    }
  };

  const deleteImage = async (imageId: string) => {
    await supabase.from("product_images").delete().eq("id", imageId);
    setEditImages(prev => prev.filter(i => i.id !== imageId));
    toast({ title: "Изображение удалено" });
  };

  const publishAll = async () => {
    const ids = filteredProducts.map(p => p.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("products")
      .update({ is_published: true, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Опубликовано ${ids.length} товаров` });
      fetchProducts();
    }
  };

  const openEdit = async (p: StagingProduct) => {
    setEditProduct(p);
    setEditForm({
      title: p.title,
      price: p.price,
      old_price: p.old_price !== null ? String(p.old_price) : "",
      description: p.description || "",
      sku: p.sku || "",
      brand: p.brand || "",
      category_id: p.category_id || "",
      availability_status: p.availability_status,
      stock_qty: p.stock_qty,
      is_popular: p.is_popular,
    });
    // Fetch images
    const { data } = await supabase
      .from("product_images")
      .select("id, url, sort_order")
      .eq("product_id", p.id)
      .order("sort_order");
    setEditImages(data || []);
  };

  const saveEdit = async () => {
    if (!editProduct) return;
    const { error } = await supabase
      .from("products")
      .update({
        title: editForm.title,
        price: editForm.price,
        old_price: editForm.old_price ? Number(editForm.old_price) : null,
        description: editForm.description || null,
        sku: editForm.sku || null,
        brand: editForm.brand || null,
        category_id: editForm.category_id || null,
        availability_status: editForm.availability_status,
        stock_qty: editForm.stock_qty,
        is_popular: editForm.is_popular,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editProduct.id);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Товар обновлён" });
      setEditProduct(null);
      fetchProducts();
    }
  };

  const saveAndPublish = async () => {
    if (!editProduct) return;
    const { error } = await supabase
      .from("products")
      .update({
        title: editForm.title,
        price: editForm.price,
        old_price: editForm.old_price ? Number(editForm.old_price) : null,
        description: editForm.description || null,
        sku: editForm.sku || null,
        brand: editForm.brand || null,
        category_id: editForm.category_id || null,
        availability_status: editForm.availability_status,
        stock_qty: editForm.stock_qty,
        is_popular: editForm.is_popular,
        is_published: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editProduct.id);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Товар сохранён и опубликован" });
      setEditProduct(null);
      fetchProducts();
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const getStatusLabel = (s: string) => {
    switch (s) {
      case "in_stock": return <Badge className="bg-green-600 text-white">В наличии</Badge>;
      case "order": return <Badge variant="secondary">Под заказ</Badge>;
      default: return <Badge variant="outline">Нет</Badge>;
    }
  };

  const getCategoryName = (id: string | null) => {
    if (!id) return <span className="text-muted-foreground text-xs">Без категории</span>;
    const cat = categories.find(c => c.id === id);
    return cat ? <span className="text-xs">{cat.name}</span> : <span className="text-muted-foreground text-xs">—</span>;
  };

  const hasActiveFilters = filterBrand !== "all" || filterStatus !== "all" || filterCategory !== "all" || filterPrice !== "all" || searchQuery.trim();

  const clearFilters = () => {
    setSearchQuery("");
    setFilterBrand("all");
    setFilterStatus("all");
    setFilterCategory("all");
    setFilterPrice("all");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Импорт из 1С</h1>
          <p className="text-muted-foreground mt-1">
            Товары ожидающие проверки перед публикацией
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={fetchProducts}>
            <RefreshCw className="h-4 w-4 mr-2" />Обновить
          </Button>
          {filteredProducts.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4 mr-2" />Действия
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={publishAll}>
                  <Upload className="h-4 w-4 mr-2" />
                  Опубликовать все ({filteredProducts.length})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Clock className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{importStats.today}</p>
                <p className="text-xs text-muted-foreground">Сегодня</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Download className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{importStats.week}</p>
                <p className="text-xs text-muted-foreground">За неделю</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <Package className="h-4 w-4 text-orange-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{importStats.total}</p>
                <p className="text-xs text-muted-foreground">Всего ожидают</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="pt-5 pb-4 space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию, артикулу, бренду, GUID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="flex gap-3 flex-wrap items-center">
            <Select value={filterBrand} onValueChange={setFilterBrand}>
              <SelectTrigger className="w-[160px]">
                <Tag className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Бренд" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все бренды</SelectItem>
                {uniqueBrands.map(b => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="in_stock">В наличии</SelectItem>
                <SelectItem value="order">Под заказ</SelectItem>
                <SelectItem value="none">Нет в наличии</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[180px]">
                <FolderTree className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Категория" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все категории</SelectItem>
                <SelectItem value="none">Без категории</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterPrice} onValueChange={setFilterPrice}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Цена" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Любая цена</SelectItem>
                <SelectItem value="zero">Цена = 0</SelectItem>
                <SelectItem value="has_old">Со старой ценой</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                <Filter className="h-3 w-3 mr-1" />Сбросить
              </Button>
            )}

            <span className="text-sm text-muted-foreground ml-auto">
              Показано: {filteredProducts.length} из {products.length}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg flex-wrap">
          <span className="text-sm font-medium">Выбрано: {selected.size}</span>
          <Button size="sm" onClick={publishSelected} className="gap-1">
            <CheckCheck className="h-4 w-4" />Опубликовать
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowBulkCategory(true)} className="gap-1">
            <FolderTree className="h-4 w-4" />Назначить категорию
          </Button>
          <Button size="sm" variant="outline" onClick={bulkSearchImages} disabled={isBulkSearchingImages} className="gap-1">
            <Image className="h-4 w-4" />
            {isBulkSearchingImages ? "Поиск фото..." : "Найти фото"}
          </Button>
          <Button size="sm" variant="outline" onClick={bulkGenerateDescriptions} disabled={isBulkGeneratingDesc} className="gap-1">
            <Sparkles className="h-4 w-4" />
            {isBulkGeneratingDesc ? "Генерация..." : "Сгенерировать описания"}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)} className="gap-1">
            <Trash2 className="h-4 w-4" />Удалить
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground">
            Снять выделение
          </Button>
        </div>
      )}

      {/* Bulk image search progress */}
      {isBulkSearchingImages && (
        <div className="p-4 border rounded-lg bg-secondary/30 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">
              Поиск фото: {bulkImageProgress.current} / {bulkImageProgress.total}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              ✓ {bulkImageProgress.success} найдено, ✗ {bulkImageProgress.failed} не найдено
            </span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${(bulkImageProgress.current / bulkImageProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Bulk description generation progress */}
      {isBulkGeneratingDesc && (
        <div className="p-4 border rounded-lg bg-secondary/30 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">
              Генерация описаний: {bulkDescProgress.current} / {bulkDescProgress.total}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              ✓ {bulkDescProgress.success} готово, ✗ {bulkDescProgress.failed} ошибок
            </span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${(bulkDescProgress.current / bulkDescProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Products Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {hasActiveFilters ? "Нет товаров по заданным фильтрам" : "Нет товаров для проверки"}
              </p>
              {hasActiveFilters && (
                <Button variant="link" onClick={clearFilters} className="mt-2">Сбросить фильтры</Button>
              )}
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selected.size === filteredProducts.length && filteredProducts.length > 0}
                        onCheckedChange={selectAll}
                      />
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center hover:text-foreground transition-colors" onClick={() => toggleSort("title")}>
                        Название <SortIcon field="title" />
                      </button>
                    </TableHead>
                    <TableHead>Артикул</TableHead>
                    <TableHead>
                      <button className="flex items-center hover:text-foreground transition-colors" onClick={() => toggleSort("brand")}>
                        Бренд <SortIcon field="brand" />
                      </button>
                    </TableHead>
                    <TableHead>Категория</TableHead>
                    <TableHead>
                      <button className="flex items-center hover:text-foreground transition-colors" onClick={() => toggleSort("price")}>
                        Цена <SortIcon field="price" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center hover:text-foreground transition-colors" onClick={() => toggleSort("stock_qty")}>
                        Остаток <SortIcon field="stock_qty" />
                      </button>
                    </TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>
                      <button className="flex items-center hover:text-foreground transition-colors" onClick={() => toggleSort("created_at")}>
                        Дата <SortIcon field="created_at" />
                      </button>
                    </TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((p) => (
                    <TableRow key={p.id} className={selected.has(p.id) ? "bg-primary/5" : ""}>
                      <TableCell>
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium line-clamp-1 max-w-[250px]">{p.title}</p>
                        {p.guid_1c && <p className="text-xs text-muted-foreground font-mono">GUID: {p.guid_1c.slice(0, 12)}...</p>}
                      </TableCell>
                      <TableCell><span className="text-sm font-mono">{p.sku || "—"}</span></TableCell>
                      <TableCell><span className="text-sm">{p.brand || "—"}</span></TableCell>
                      <TableCell>{getCategoryName(p.category_id)}</TableCell>
                      <TableCell>
                        <div>
                          <span className="font-semibold">{p.price.toLocaleString()} ₽</span>
                          {p.old_price !== null && p.old_price > 0 && (
                            <span className="text-xs text-muted-foreground line-through ml-1">{p.old_price.toLocaleString()}</span>
                          )}
                          {p.price === 0 && <AlertTriangle className="h-3 w-3 text-orange-500 inline ml-1" />}
                        </div>
                      </TableCell>
                      <TableCell>{p.stock_qty}</TableCell>
                      <TableCell>{getStatusLabel(p.availability_status)}</TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(p.created_at), "dd.MM.yy")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Редактировать">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактировать товар</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="main">
            <TabsList className="w-full">
              <TabsTrigger value="main" className="flex-1">Основное</TabsTrigger>
              <TabsTrigger value="prices" className="flex-1">Цены и наличие</TabsTrigger>
              <TabsTrigger value="media" className="flex-1">Медиа</TabsTrigger>
              <TabsTrigger value="meta" className="flex-1">Мета</TabsTrigger>
            </TabsList>

            <TabsContent value="main" className="space-y-4 mt-4">
              <div>
                <Label>Название</Label>
                <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Артикул</Label>
                  <Input value={editForm.sku} onChange={e => setEditForm(f => ({ ...f, sku: e.target.value }))} />
                </div>
                <div>
                  <Label>Бренд</Label>
                  <Input value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Категория</Label>
                <Select value={editForm.category_id || "none"} onValueChange={v => setEditForm(f => ({ ...f, category_id: v === "none" ? "" : v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите категорию" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без категории</SelectItem>
                    {categories.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Описание</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={generateDescriptionForProduct}
                    disabled={isGeneratingDesc}
                    className="gap-1 h-7 text-xs"
                  >
                    {isGeneratingDesc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {isGeneratingDesc ? "Генерация..." : "Сгенерировать ИИ"}
                  </Button>
                </div>
                <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={4} />
              </div>
            </TabsContent>

            <TabsContent value="prices" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Цена (₽)</Label>
                  <Input type="number" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label>Старая цена (₽)</Label>
                  <Input
                    type="number"
                    placeholder="Оставьте пустым"
                    value={editForm.old_price}
                    onChange={e => setEditForm(f => ({ ...f, old_price: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Остаток</Label>
                  <Input type="number" value={editForm.stock_qty} onChange={e => setEditForm(f => ({ ...f, stock_qty: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label>Статус наличия</Label>
                  <Select value={editForm.availability_status} onValueChange={v => setEditForm(f => ({ ...f, availability_status: v }))}>
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
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={editForm.is_popular}
                  onCheckedChange={(v) => setEditForm(f => ({ ...f, is_popular: !!v }))}
                />
                <Label>Популярный товар</Label>
              </div>
            </TabsContent>

            <TabsContent value="media" className="space-y-4 mt-4">
              {/* Image search controls */}
              <div className="flex gap-2">
                <Input
                  placeholder="Поиск фото по запросу..."
                  value={imageSearchQuery}
                  onChange={e => setImageSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchImagesForProduct()}
                  className="flex-1"
                />
                <Button size="sm" onClick={() => searchImagesForProduct()} disabled={isSearchingImages}>
                  {isSearchingImages ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
                <Button size="sm" variant="outline" onClick={() => searchImagesForProduct(editForm.title)} disabled={isSearchingImages}>
                  <Image className="h-4 w-4 mr-1" />Авто
                </Button>
              </div>

              {editImages.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Нет изображений</p>
                  <p className="text-xs mt-1">Используйте поиск выше или кнопку «Авто» для поиска по названию</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {editImages.map(img => (
                    <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden border bg-secondary">
                      <img src={img.url} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => deleteImage(img.id)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="meta" className="space-y-4 mt-4">
              <div className="space-y-2 text-sm">
                {editProduct?.guid_1c && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GUID 1С</span>
                    <code className="font-mono text-xs">{editProduct.guid_1c}</code>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Создан</span>
                  <span>{editProduct && format(new Date(editProduct.created_at), "dd MMM yyyy, HH:mm", { locale: ru })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Обновлён</span>
                  <span>{editProduct && format(new Date(editProduct.updated_at), "dd MMM yyyy, HH:mm", { locale: ru })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <code className="font-mono text-xs">{editProduct?.id}</code>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2 mt-4 flex-wrap">
            <Button variant="outline" onClick={() => setEditProduct(null)}>Отмена</Button>
            <Button variant="secondary" onClick={saveEdit}>Сохранить</Button>
            <Button onClick={saveAndPublish}>Сохранить и опубликовать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {selected.size} товаров?</AlertDialogTitle>
            <AlertDialogDescription>
              Выбранные товары и их изображения будут удалены безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Category Dialog */}
      <Dialog open={showBulkCategory} onOpenChange={setShowBulkCategory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Назначить категорию ({selected.size} товарам)</DialogTitle>
          </DialogHeader>
          <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите категорию" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkCategory(false)}>Отмена</Button>
            <Button onClick={assignCategoryBulk} disabled={!bulkCategoryId}>Назначить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Search Results Dialog */}
      <Dialog open={showImageSearchDialog} onOpenChange={setShowImageSearchDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Результаты поиска изображений</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 mb-4">
            <Input
              value={imageSearchQuery}
              onChange={e => setImageSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchImagesForProduct()}
              placeholder="Уточните запрос..."
              className="flex-1"
            />
            <Button onClick={() => searchImagesForProduct()} disabled={isSearchingImages}>
              {isSearchingImages ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {isSearchingImages ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Поиск изображений...</p>
            </div>
          ) : searchedImages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Ничего не найдено</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {searchedImages.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => selectFoundImage(img.url)}
                  className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary bg-secondary transition-colors relative group"
                >
                  {proxiedImages[img.url] ? (
                    <img src={proxiedImages[img.url]} alt={img.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity truncate">
                    {img.source}
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
