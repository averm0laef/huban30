import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Search, Filter, Package, Eye, X, SlidersHorizontal, Car, ShoppingCart, ChevronLeft, ChevronRight } from "lucide-react";
import { StockIndicator } from "@/components/StockIndicator";
import { ProductImage } from "@/components/ProductImage";
import { smartMatch, scoreMatch } from "@/lib/smartSearch";
import { useCart } from "@/contexts/CartContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useFavorites } from "@/hooks/useFavorites";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ProductQuickView } from "@/components/catalog/ProductQuickView";

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface Product {
  id: string;
  title: string;
  display_title: string | null;
  brand: string | null;
  price: number;
  old_price: number | null;
  stock_qty: number;
  sku: string | null;
  availability_status: string;
  category_id: string | null;
  images: { url: string }[];
}

// Popular car brands for quick selection
const CAR_BRANDS = [
  "Toyota", "Honda", "Nissan", "Mazda", "Mitsubishi", "Subaru",
  "BMW", "Mercedes", "Audi", "Volkswagen", "Ford", "Chevrolet",
  "Hyundai", "Kia", "Лада", "УАЗ", "ГАЗ"
];

const PRODUCTS_PER_PAGE = 36;

const Catalog = () => {
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [allBrands, setAllBrands] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("popular");
  const [isLoading, setIsLoading] = useState(true);
  const [quickViewProductId, setQuickViewProductId] = useState<string | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  
  // Search mode: "text" for regular search, "vin" for VIN/car search
  const [searchMode, setSearchMode] = useState<"text" | "vin">("text");
  const [vinSearch, setVinSearch] = useState("");
  const [selectedCarBrand, setSelectedCarBrand] = useState<string>("");
  
  // Filter states
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100000]);
  const [minMaxPrice, setMinMaxPrice] = useState<[number, number]>([0, 100000]);
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "in_stock" | "on_order">("all");
  const [hasDiscount, setHasDiscount] = useState(false);
  
  const { isFavorite, toggleFavorite } = useFavorites();
  const { addItem } = useCart();

  const openQuickView = (productId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setQuickViewProductId(productId);
    setQuickViewOpen(true);
  };

  // Read category slug from URL and map to category ID
  useEffect(() => {
    if (categories.length === 0) return;
    const categorySlug = searchParams.get("category");
    if (categorySlug) {
      const found = categories.find(c => c.slug === categorySlug);
      if (found) {
        setSelectedCategory(found.id);
      } else {
        setSelectedCategory("all");
      }
    }
  }, [searchParams, categories]);

  useEffect(() => {
    fetchCategories();
    fetchProducts();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    fetchProducts();
  }, [selectedCategory, sortBy]);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from("categories")
      .select("id, name, slug")
      .eq("is_enabled", true)
      .order("sort_order");
    setCategories(data || []);
  };

  const fetchProducts = async (page = currentPage) => {
    setIsLoading(true);
    try {
      const from = (page - 1) * PRODUCTS_PER_PAGE;
      const to = from + PRODUCTS_PER_PAGE - 1;

      let query = supabase
        .from("products")
        .select(`
          id, title, display_title, brand, price, old_price, stock_qty, sku, availability_status, category_id, is_popular,
          product_images (url)
        `, { count: 'exact' })
        .eq("is_published", true);

      if (selectedCategory !== "all") {
        query = query.eq("category_id", selectedCategory);
      }

      if (sortBy === "price-asc") {
        query = query.order("price", { ascending: true });
      } else if (sortBy === "price-desc") {
        query = query.order("price", { ascending: false });
      } else if (sortBy === "name") {
        query = query.order("title", { ascending: true });
      } else {
        query = query.order("is_popular", { ascending: false }).order("created_at", { ascending: false });
      }

      const { data, error, count } = await query.range(from, to);

      if (error) throw error;

      const productsData = (data || []).map(p => ({
        ...p,
        images: p.product_images || []
      }));
      
      setProducts(productsData);
      setTotalCount(count || 0);
      
      // Extract unique brands
      const brands = [...new Set(productsData.map(p => p.brand).filter(Boolean))] as string[];
      setAllBrands(brands.sort());
      
      // Calculate min/max prices
      if (productsData.length > 0) {
        const prices = productsData.map(p => p.price);
        const min = Math.floor(Math.min(...prices));
        const max = Math.ceil(Math.max(...prices));
        setMinMaxPrice([min, max]);
        setPriceRange([min, max]);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Apply all filters
  const filteredProducts = useMemo(() => {
    const filtered = products.filter(p => {
      // Text search filter (smart: transliteration, aliases, fuzzy)
      const searchTerm = searchMode === "text" ? search : "";
      const searchableTitle = p.display_title || p.title;
      const matchesTextSearch = !searchTerm || 
        smartMatch(searchTerm, { title: searchableTitle, brand: p.brand || '', sku: p.sku || '' }) ||
        smartMatch(searchTerm, { title: p.title, brand: p.brand || '', sku: p.sku || '' });
      
      // VIN/Car search filter
      const vinTerm = searchMode === "vin" ? vinSearch : "";
      const matchesVinSearch = !vinTerm || 
        smartMatch(vinTerm, { title: p.title, brand: p.brand || '', sku: p.sku || '' });
      
      // Car brand filter (from VIN search mode)
      const matchesCarBrand = !selectedCarBrand || 
        smartMatch(selectedCarBrand, { title: p.title, brand: p.brand || '' });
      
      // Brand filter
      const matchesBrand = selectedBrands.length === 0 || 
        (p.brand && selectedBrands.includes(p.brand));
      
      // Price filter
      const matchesPrice = p.price >= priceRange[0] && p.price <= priceRange[1];
      
      // Availability filter
      const isInStock = p.availability_status === 'in_stock' || p.stock_qty > 0;
      const matchesAvailability = 
        availabilityFilter === "all" ||
        (availabilityFilter === "in_stock" && isInStock) ||
        (availabilityFilter === "on_order" && !isInStock);
      
      // Discount filter
      const matchesDiscount = !hasDiscount || (p.old_price && p.old_price > p.price);
      
      return matchesTextSearch && matchesVinSearch && matchesCarBrand && matchesBrand && matchesPrice && matchesAvailability && matchesDiscount;
    });

    // Sort by relevance when searching
    const activeSearch = searchMode === "text" ? search : vinSearch;
    if (activeSearch && activeSearch.trim().length >= 2) {
      filtered.sort((a, b) => {
        const scoreA = scoreMatch(activeSearch, { title: a.title, display_title: a.display_title || undefined, sku: a.sku || undefined, brand: a.brand || undefined });
        const scoreB = scoreMatch(activeSearch, { title: b.title, display_title: b.display_title || undefined, sku: b.sku || undefined, brand: b.brand || undefined });
        return scoreB - scoreA;
      });
    }

    return filtered;
  }, [products, search, vinSearch, selectedCarBrand, searchMode, selectedBrands, priceRange, availabilityFilter, hasDiscount]);

  const totalPages = Math.ceil(totalCount / PRODUCTS_PER_PAGE);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchProducts(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleBrand = (brand: string) => {
    setSelectedBrands(prev => 
      prev.includes(brand) 
        ? prev.filter(b => b !== brand) 
        : [...prev, brand]
    );
  };

  const resetFilters = () => {
    setSelectedBrands([]);
    setPriceRange(minMaxPrice);
    setAvailabilityFilter("all");
    setHasDiscount(false);
    setSearch("");
    setVinSearch("");
    setSelectedCarBrand("");
  };

  const activeFiltersCount = 
    selectedBrands.length + 
    (availabilityFilter !== "all" ? 1 : 0) + 
    (hasDiscount ? 1 : 0) + 
    (priceRange[0] !== minMaxPrice[0] || priceRange[1] !== minMaxPrice[1] ? 1 : 0) +
    (selectedCarBrand ? 1 : 0) +
    (vinSearch ? 1 : 0);

  // Filter sidebar content (shared between desktop and mobile)
  const FilterContent = () => (
    <div className="space-y-6">
      {/* Categories */}
      <div>
        <h3 className="font-semibold mb-3">Категории</h3>
        <ul className="space-y-1">
          <li>
            <button 
              onClick={() => setSelectedCategory("all")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedCategory === "all" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
            >
              Все категории
            </button>
          </li>
          {categories.map((cat) => (
            <li key={cat.id}>
              <button 
                onClick={() => setSelectedCategory(cat.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategory === cat.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                }`}
              >
                {cat.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Separator />

      {/* Price Range */}
      <div>
        <h3 className="font-semibold mb-3">Цена, ₽</h3>
        <div className="space-y-4">
          <Slider
            value={priceRange}
            onValueChange={(value) => setPriceRange(value as [number, number])}
            min={minMaxPrice[0]}
            max={minMaxPrice[1]}
            step={100}
            className="mt-2"
          />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={priceRange[0]}
              onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
              className="h-9 text-sm"
              min={minMaxPrice[0]}
              max={priceRange[1]}
            />
            <span className="text-muted-foreground">—</span>
            <Input
              type="number"
              value={priceRange[1]}
              onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
              className="h-9 text-sm"
              min={priceRange[0]}
              max={minMaxPrice[1]}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Availability */}
      <div>
        <h3 className="font-semibold mb-3">Наличие</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="radio" 
              name="availability"
              checked={availabilityFilter === "all"}
              onChange={() => setAvailabilityFilter("all")}
              className="accent-primary"
            />
            <span className="text-sm">Все товары</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="radio" 
              name="availability"
              checked={availabilityFilter === "in_stock"}
              onChange={() => setAvailabilityFilter("in_stock")}
              className="accent-primary"
            />
            <span className="text-sm">В наличии</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="radio" 
              name="availability"
              checked={availabilityFilter === "on_order"}
              onChange={() => setAvailabilityFilter("on_order")}
              className="accent-primary"
            />
            <span className="text-sm">Под заказ</span>
          </label>
        </div>
      </div>

      <Separator />

      {/* Discount */}
      <div>
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="discount" 
            checked={hasDiscount}
            onCheckedChange={(checked) => setHasDiscount(checked === true)}
          />
          <Label htmlFor="discount" className="text-sm cursor-pointer">
            Только со скидкой
          </Label>
        </div>
      </div>

      <Separator />

      {/* Brands */}
      {allBrands.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Бренд</h3>
          <ScrollArea className="h-48">
            <div className="space-y-2 pr-4">
              {allBrands.map((brand) => (
                <div key={brand} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`brand-${brand}`}
                    checked={selectedBrands.includes(brand)}
                    onCheckedChange={() => toggleBrand(brand)}
                  />
                  <Label 
                    htmlFor={`brand-${brand}`} 
                    className="text-sm cursor-pointer flex-1 truncate"
                  >
                    {brand}
                  </Label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Reset Button */}
      {activeFiltersCount > 0 && (
        <>
          <Separator />
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={resetFilters}
          >
            <X className="h-4 w-4 mr-2" />
            Сбросить фильтры ({activeFiltersCount})
          </Button>
        </>
      )}
    </div>
  );

  return (
    <MainLayout>
      <div className="bg-background">
        {/* Hero */}
        <section className="relative overflow-hidden py-12 sm:py-14">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(var(--primary))]/90 to-[hsl(var(--accent))]" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
          <div className="container relative z-10">
            <h1 className="font-display text-3xl lg:text-4xl font-extrabold mb-3 text-white">
              Каталог автозапчастей
            </h1>
            <p className="text-white/70 mb-6 max-w-xl">
              Широкий ассортимент запчастей для легковых и грузовых автомобилей
            </p>
            
            {/* Search Tabs */}
            <div className="max-w-3xl">
              <Tabs value={searchMode} onValueChange={(v) => setSearchMode(v as "text" | "vin")} className="mb-4">
                <TabsList className="bg-white/10 backdrop-blur-sm">
                  <TabsTrigger value="text" className="data-[state=active]:bg-white data-[state=active]:text-foreground text-white/80">
                    <Search className="h-4 w-4 mr-2" />
                    По названию
                  </TabsTrigger>
                  <TabsTrigger value="vin" className="data-[state=active]:bg-white data-[state=active]:text-foreground text-white/80">
                    <Car className="h-4 w-4 mr-2" />
                    По VIN / марке авто
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              
              {searchMode === "text" ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Поиск по названию или бренду..." 
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-10 bg-background text-foreground"
                    />
                  </div>
                  
                  {/* Mobile Filters Button */}
                  <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                    <SheetTrigger asChild>
                      <Button variant="secondary" className="lg:hidden">
                        <SlidersHorizontal className="h-4 w-4 mr-2" />
                        Фильтры
                        {activeFiltersCount > 0 && (
                          <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                            {activeFiltersCount}
                          </Badge>
                        )}
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-80">
                      <SheetHeader>
                        <SheetTitle>Фильтры</SheetTitle>
                      </SheetHeader>
                      <ScrollArea className="h-[calc(100vh-80px)] mt-4 pr-4">
                        <FilterContent />
                      </ScrollArea>
                    </SheetContent>
                  </Sheet>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Car className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input 
                        placeholder="Введите VIN-номер (17 символов)..." 
                        value={vinSearch}
                        onChange={(e) => setVinSearch(e.target.value.toUpperCase())}
                        className="pl-10 bg-background text-foreground font-mono uppercase"
                        maxLength={17}
                      />
                    </div>
                    
                    <Select value={selectedCarBrand || "all"} onValueChange={(val) => setSelectedCarBrand(val === "all" ? "" : val)}>
                      <SelectTrigger className="w-full sm:w-48 bg-background text-foreground">
                        <SelectValue placeholder="Марка авто" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все марки</SelectItem>
                        {CAR_BRANDS.map(brand => (
                          <SelectItem key={brand} value={brand}>{brand}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    {/* Mobile Filters Button */}
                    <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                      <SheetTrigger asChild>
                        <Button variant="secondary" className="lg:hidden">
                          <SlidersHorizontal className="h-4 w-4 mr-2" />
                          Фильтры
                          {activeFiltersCount > 0 && (
                            <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                              {activeFiltersCount}
                            </Badge>
                          )}
                        </Button>
                      </SheetTrigger>
                      <SheetContent side="left" className="w-80">
                        <SheetHeader>
                          <SheetTitle>Фильтры</SheetTitle>
                        </SheetHeader>
                        <ScrollArea className="h-[calc(100vh-80px)] mt-4 pr-4">
                          <FilterContent />
                        </ScrollArea>
                      </SheetContent>
                    </Sheet>
                  </div>
                  
                  {/* Quick car brand selection */}
                  <div className="flex flex-wrap gap-2">
                    {CAR_BRANDS.slice(0, 8).map(brand => (
                      <Badge 
                        key={brand}
                        variant={selectedCarBrand === brand ? "default" : "secondary"}
                        className="cursor-pointer hover:bg-secondary/80 transition-colors"
                        onClick={() => setSelectedCarBrand(selectedCarBrand === brand ? "" : brand)}
                      >
                        {brand}
                      </Badge>
                    ))}
                  </div>
                  
                  {vinSearch && vinSearch.length === 17 && (
                    <div className="bg-background/10 rounded-lg p-3 text-sm">
                      <p className="text-primary-foreground/80">
                        🔍 Поиск по VIN: <span className="font-mono font-medium">{vinSearch}</span>
                      </p>
                      <p className="text-primary-foreground/60 text-xs mt-1">
                        Для точного подбора запчастей по VIN обратитесь к нашим специалистам в чате
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Catalog */}
        <section className="py-8">
          <div className="container">
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Desktop Sidebar */}
              <aside className="hidden lg:block lg:w-64 shrink-0">
                <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin pr-2">
                  <FilterContent />
                </div>
              </aside>

              {/* Products */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-6 gap-4">
                  <p className="text-muted-foreground text-sm">
                    Найдено <span className="font-medium text-foreground">{totalCount}</span> товаров (стр. {currentPage} из {totalPages || 1})
                  </p>
                  
                  {/* Active filters badges (mobile) */}
                  {activeFiltersCount > 0 && (
                    <div className="hidden sm:flex lg:hidden items-center gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={resetFilters}
                        className="text-xs"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Сбросить
                      </Button>
                    </div>
                  )}
                  
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-40 sm:w-48">
                      <SelectValue placeholder="Сортировка" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="popular">По популярности</SelectItem>
                      <SelectItem value="price-asc">Сначала дешёвые</SelectItem>
                      <SelectItem value="price-desc">Сначала дорогие</SelectItem>
                      <SelectItem value="name">По названию</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Active Filters Display */}
                {activeFiltersCount > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedBrands.map(brand => (
                      <Badge 
                        key={brand} 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => toggleBrand(brand)}
                      >
                        {brand}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))}
                    {selectedCarBrand && (
                      <Badge 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => setSelectedCarBrand("")}
                      >
                        Авто: {selectedCarBrand}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    )}
                    {vinSearch && (
                      <Badge 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => setVinSearch("")}
                      >
                        VIN: {vinSearch.slice(0, 8)}...
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    )}
                    {availabilityFilter !== "all" && (
                      <Badge 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => setAvailabilityFilter("all")}
                      >
                        {availabilityFilter === "in_stock" ? "В наличии" : "Под заказ"}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    )}
                    {hasDiscount && (
                      <Badge 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => setHasDiscount(false)}
                      >
                        Со скидкой
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    )}
                    {(priceRange[0] !== minMaxPrice[0] || priceRange[1] !== minMaxPrice[1]) && (
                      <Badge 
                        variant="secondary"
                        className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => setPriceRange(minMaxPrice)}
                      >
                        {priceRange[0].toLocaleString()} — {priceRange[1].toLocaleString()} ₽
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    )}
                  </div>
                )}

                {isLoading ? (
                  <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-lg font-medium mb-2">Товары не найдены</p>
                    <p className="text-muted-foreground mb-4">Попробуйте изменить параметры поиска</p>
                    {activeFiltersCount > 0 && (
                      <Button variant="outline" onClick={resetFilters}>
                        Сбросить фильтры
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredProducts.map((product) => {
                      const imageUrl = product.images?.[0]?.url || "/placeholder.svg";
                      const isInStock = product.availability_status === 'in_stock' || product.stock_qty > 0;
                      const discount = product.old_price 
                        ? Math.round((1 - product.price / product.old_price) * 100) 
                        : 0;

                      return (
                        <Card key={product.id} className="group overflow-hidden h-full hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 border-border/60 hover:border-primary/30">
                          <Link to={`/catalog/product/${product.id}`} className="block">
                            {/* Image */}
                            <div className="relative aspect-[4/3] overflow-hidden bg-secondary/20">
                              <ProductImage 
                                src={imageUrl} 
                                alt={product.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                              
                              {/* Badges overlay */}
                              <div className="absolute top-2 left-2 flex flex-col gap-1">
                                {discount > 0 && (
                                  <Badge className="bg-destructive text-destructive-foreground text-[11px] font-bold px-2 py-0.5">
                                    −{discount}%
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Stock indicator */}
                              <div className="absolute top-2 right-2">
                                <StockIndicator stockQty={product.stock_qty} availabilityStatus={product.availability_status} compact />
                              </div>
                              
                              {/* Hover overlay */}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                              
                              {/* Action buttons on hover */}
                              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                                <button
                                  onClick={(e) => openQuickView(product.id, e)}
                                  className="bg-background/95 backdrop-blur-sm text-foreground px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-background shadow-md"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  Быстрый просмотр
                                </button>
                                <FavoriteButton
                                  isFavorite={isFavorite(product.id)}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleFavorite(product.id);
                                  }}
                                  size="sm"
                                />
                              </div>
                            </div>
                          </Link>
                          
                          {/* Info */}
                          <CardContent className="p-3 sm:p-4 space-y-2">
                            {/* Brand & SKU row */}
                            <div className="flex items-center justify-between gap-2">
                              {product.brand && (
                                <span className="text-[11px] font-semibold text-primary/80 uppercase tracking-wide truncate">
                                  {product.brand}
                                </span>
                              )}
                              {product.sku && (
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                  {product.sku}
                                </span>
                              )}
                            </div>
                            
                            {/* Title */}
                            <Link to={`/catalog/product/${product.id}`}>
                              <h3 className="font-medium text-sm leading-snug line-clamp-2 min-h-[2.5rem] hover:text-primary transition-colors">
                                {product.display_title || product.title}
                              </h3>
                            </Link>
                            
                            {/* Availability text */}
                            <p className={`text-[11px] font-medium ${isInStock ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                              {isInStock ? `✓ В наличии${product.stock_qty > 0 ? ` (${product.stock_qty} шт.)` : ''}` : "⏳ Под заказ"}
                            </p>
                            
                            {/* Price + Cart */}
                            <div className="flex items-end justify-between gap-2 pt-1 border-t border-border/40">
                              <div className="flex flex-col">
                                {product.old_price && (
                                  <span className="text-xs text-muted-foreground line-through leading-none">
                                    {product.old_price.toLocaleString()} ₽
                                  </span>
                                )}
                                <span className={`font-display font-bold text-lg leading-tight ${discount > 0 ? "text-destructive" : ""}`}>
                                  {product.price.toLocaleString()} ₽
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant={isInStock ? "default" : "outline"}
                                className="shrink-0 h-8 gap-1.5 text-xs"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  addItem({
                                    id: product.id,
                                    title: product.display_title || product.title,
                                    price: product.price,
                                    image: imageUrl,
                                    sku: product.sku,
                                  });
                                }}
                              >
                                <ShoppingCart className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">В корзину</span>
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-8">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => handlePageChange(currentPage - 1)}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Назад
                    </Button>
                    
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                        let page: number;
                        if (totalPages <= 7) {
                          page = i + 1;
                        } else if (currentPage <= 4) {
                          page = i + 1;
                        } else if (currentPage >= totalPages - 3) {
                          page = totalPages - 6 + i;
                        } else {
                          page = currentPage - 3 + i;
                        }
                        return (
                          <Button
                            key={page}
                            variant={currentPage === page ? "default" : "outline"}
                            size="sm"
                            className="w-9 h-9 p-0"
                            onClick={() => handlePageChange(page)}
                          >
                            {page}
                          </Button>
                        );
                      })}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === totalPages}
                      onClick={() => handlePageChange(currentPage + 1)}
                    >
                      Вперёд
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                    
                    <span className="text-sm text-muted-foreground ml-2">
                      {totalCount} товаров
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Quick View Modal */}
      <ProductQuickView
        productId={quickViewProductId}
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
      />
    </MainLayout>
  );
};

export default Catalog;