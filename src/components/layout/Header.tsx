import { useState, useEffect, useRef } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, Phone, MapPin, ChevronDown, Search, Loader2, User, LogIn, Heart, ShoppingCart, LayoutGrid, Headphones, MessageCircle, Send, FileText } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useChat } from "@/contexts/ChatContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger } from
"@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// VK icon component
const VKIcon = ({ className }: {className?: string;}) =>
<svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.785 16.241s.288-.032.436-.194c.136-.148.132-.427.132-.427s-.02-1.304.576-1.496c.588-.19 1.341 1.26 2.14 1.818.605.422 1.064.33 1.064.33l2.137-.03s1.117-.071.587-.964c-.043-.073-.308-.661-1.588-1.87-1.34-1.264-1.16-1.059.453-3.246.983-1.332 1.376-2.145 1.253-2.493-.117-.332-.84-.244-.84-.244l-2.406.015s-.178-.025-.31.056c-.13.079-.212.264-.212.264s-.382 1.03-.89 1.907c-1.07 1.85-1.499 1.948-1.674 1.832-.407-.267-.305-1.075-.305-1.648 0-1.793.267-2.54-.521-2.733-.262-.065-.454-.107-1.123-.114-.858-.01-1.585.003-1.996.208-.274.136-.485.44-.356.458.159.022.519.099.71.363.246.341.237 1.107.237 1.107s.142 2.11-.33 2.371c-.325.18-.77-.187-1.725-1.865-.489-.859-.859-1.81-.859-1.81s-.07-.176-.198-.272c-.154-.115-.37-.151-.37-.151l-2.286.015s-.343.01-.469.163c-.112.136-.009.418-.009.418s1.796 4.258 3.83 6.404c1.865 1.967 3.98 1.837 3.98 1.837h.96z" />
  </svg>;


const clientMenuItems = [
{ href: "/delivery", label: "Условия доставки" },
{ href: "/returns", label: "Возврат товара" },
{ href: "/how-to-order", label: "Как сделать заказ" },
{ href: "/terms", label: "Условия работы для клиентов" },
{ href: "/privacy", label: "Политика конфиденциальности" }];


const companyMenuItems = [
{ href: "/about", label: "О компании" },
{ href: "/contacts", label: "Контакты" },
{ href: "/map", label: "Адрес магазина" }];


interface Product {
  id: string;
  title: string;
  display_title: string | null;
  price: number;
  sku: string | null;
  brand: string | null;
  product_images: { url: string }[];
}

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isAdmin } = useAuth();
  const { openChat } = useChat();
  const { totalItems, setCartOpen } = useCart();

  // Helper to get user display name
  const getUserDisplayName = () => {
    if (profile?.full_name) return profile.full_name;
    if (profile?.telegram_id) return `@${profile.telegram_id}`;
    // Hide @telegram.local emails
    if (user?.email?.includes('@telegram.local')) return 'Telegram';
    return user?.email?.split('@')[0] || 'Профиль';
  };

  // Helper to get user initials for avatar
  const getUserInitials = () => {
    if (profile?.full_name) {
      const parts = profile.full_name.split(' ');
      return parts.map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    }
    return 'U';
  };

  // Smart search products
  useEffect(() => {
    const searchProducts = async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      
      const { buildSupabaseSearchTerms, looksLikeArticle, normalizeSku, scoreMatch } = await import("@/lib/smartSearch");
      const terms = buildSupabaseSearchTerms(searchQuery);
      const isArticle = looksLikeArticle(searchQuery);
      
      // Build OR filter for all variants
      const orFilters = terms
        .flatMap(term => [
          `title.ilike.%${term}%`,
          `display_title.ilike.%${term}%`,
          `sku.ilike.%${term}%`,
          `brand.ilike.%${term}%`,
        ])
        .join(',');

      const { data } = await supabase
        .from("products")
        .select("id, title, display_title, price, sku, brand, product_images(url)")
        .eq("is_published", true)
        .or(orFilters)
        .limit(20);

      if (data) {
        // Score and sort results by relevance
        const scored = data.map(p => ({
          ...p,
          _score: scoreMatch(searchQuery, {
            title: p.title,
            display_title: p.display_title || undefined,
            sku: p.sku || undefined,
            brand: p.brand || undefined,
          }),
        }));
        scored.sort((a, b) => b._score - a._score);
        setSearchResults(scored.slice(0, 10));
      } else {
        setSearchResults([]);
      }
      setIsSearching(false);
    };

    const debounce = setTimeout(searchProducts, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  // Close search on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideDesktop = searchRef.current?.contains(target);
      const insideMobile = mobileSearchRef.current?.contains(target);
      if (!insideDesktop && !insideMobile) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleProductClick = (productId: string) => {
    setShowResults(false);
    setSearchQuery("");
    navigate(`/catalog/product/${productId}`);
  };

  const handleFavorites = () => {
    toast.info("Избранное пока в разработке", {
      description: "Скоро здесь будут ваши любимые товары!"
    });
  };

  return (
    <header className="sticky top-0 z-50 w-full bg-card border-b border-border">
      {/* Main header row - Desktop */}
      <div className="hidden lg:block border-b border-border">
        <div className="container flex items-center gap-4 py-3">
          {/* Logo */}
          <Link to="/" className="shrink-0 transition-transform duration-200 hover:scale-110 active:scale-95">
            <img src={logo} alt="АН-30 Автозапчасти" className="h-20 lg:h-24 w-auto" />
          </Link>

          {/* Catalog button */}
          <Link to="/catalog">
            <Button className="gap-2 px-6 h-11 text-base font-medium">
              <LayoutGrid className="h-5 w-5" />
              Каталог
            </Button>
          </Link>

          {/* Search */}
          <div ref={searchRef} className="relative flex-1 max-w-2xl">
            <div className="relative flex">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Поиск по названию или артикулу..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setShowResults(true)}
                  className="w-full h-11 pl-12 pr-4 border border-border rounded-l-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />

                {isSearching &&
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-muted-foreground" />
                }
              </div>
              <button className="h-11 px-5 bg-primary text-primary-foreground rounded-r-lg hover:bg-primary/90 transition-colors">
                <Search className="h-5 w-5" />
              </button>
            </div>
            
            {showResults && (searchResults.length > 0 || searchQuery.length >= 2) &&
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden max-h-[60vh] overflow-y-auto overscroll-contain">
                {searchResults.length > 0 ?
              <div className="py-2">
                    {searchResults.map((product) => {
                      const imgUrl = product.product_images?.[0]?.url || "/placeholder.svg";
                      return (
                        <button
                          key={product.id}
                          onClick={() => handleProductClick(product.id)}
                          className="w-full px-3 py-2 text-left hover:bg-secondary transition-colors flex items-center gap-3">
                          <img src={imgUrl} alt="" className="w-10 h-10 rounded-md object-cover bg-secondary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm line-clamp-1">{product.display_title || product.title}</p>
                            <div className="flex items-center gap-2">
                              {product.sku &&
                                <span className="text-xs text-muted-foreground">Арт: {product.sku}</span>
                              }
                              {product.brand &&
                                <span className="text-xs text-muted-foreground/70">• {product.brand}</span>
                              }
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-primary shrink-0 ml-2">
                            {product.price.toLocaleString()} ₽
                          </span>
                        </button>
                      );
                    })}
                  </div> :

              <div className="px-4 py-3 text-sm text-muted-foreground">
                    Ничего не найдено
                  </div>
              }
              </div>
            }
          </div>

          {/* Right icons */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setCartOpen(true)}
              className="flex flex-col items-center justify-center w-16 py-1 hover:text-primary transition-colors text-foreground/70 relative">
              <ShoppingCart className="h-6 w-6 mb-0.5" />
              {totalItems > 0 && (
                <span className="absolute top-0 right-2 w-4.5 h-4.5 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">{totalItems}</span>
              )}
              <span className="text-xs">Корзина</span>
            </button>
            <button
              onClick={handleFavorites}
              className="flex flex-col items-center justify-center w-16 py-1 hover:text-primary transition-colors text-foreground/70">
              <Heart className="h-6 w-6 mb-0.5" />
              <span className="text-xs">Закладки</span>
            </button>

            {user ?
            <Link
              to={isAdmin ? "/admin" : "/profile"}
              className="flex flex-col items-center justify-center w-20 py-1 hover:text-primary transition-colors text-foreground/70">

                <Avatar className="h-7 w-7 mb-0.5">
                  {profile?.avatar_url ?
                <AvatarImage src={profile.avatar_url} alt={getUserDisplayName()} /> :
                null}
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs truncate max-w-full">{isAdmin ? "Админ" : getUserDisplayName()}</span>
              </Link> :

            <Link
              to="/auth"
              className="flex flex-col items-center justify-center w-16 py-1 hover:text-primary transition-colors text-foreground/70">

                <LogIn className="h-6 w-6 mb-0.5" />
                <span className="text-xs">Войти</span>
              </Link>
            }
          </div>
        </div>
      </div>

      {/* Secondary nav row - Desktop */}
      <div className="hidden lg:block bg-background">
        <div className="container flex items-center justify-between py-2">
          {/* Left nav */}
          <nav className="flex items-center gap-6">
            {/* Покупателям dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-primary transition-colors outline-none">
                Покупателям
                <ChevronDown className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {clientMenuItems.map((item) =>
                <DropdownMenuItem key={item.href} asChild>
                    <Link to={item.href} className="cursor-pointer">
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* О нас dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-primary transition-colors outline-none">
                О нас
                <ChevronDown className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {companyMenuItems.map((item) =>
                <DropdownMenuItem key={item.href} asChild>
                    <Link to={item.href} className="cursor-pointer">
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={openChat}
                  className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5"
                >
                  <Headphones className="h-4 w-4" />
                  Помощь эксперта
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p>Поможем подобрать запчасти для вашего авто</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/contacts"
                  className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 transition-all shadow-md shadow-accent/20 hover:shadow-lg hover:shadow-accent/30 hover:-translate-y-0.5"
                >
                  <FileText className="h-4 w-4" />
                  Оставить заявку
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p>Оставьте заявку — мы перезвоним и поможем с выбором</p>
              </TooltipContent>
            </Tooltip>
          </nav>

          {/* Right info */}
          <div className="flex items-center gap-6">
            <a
              href="tel:+79244742605"
              className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors">

              <Phone className="h-4 w-4" />
              +7 (924) 474-26-05
            </a>
            <Link
              to="/map"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline">

              <MapPin className="h-4 w-4" />
              Адрес магазина
            </Link>
          </div>
        </div>
      </div>

      {/* Mobile header */}
      <div className="lg:hidden">
        <div className="container flex items-center justify-between py-3 gap-3">
          <Link to="/" className="shrink-0 transition-transform duration-200 hover:scale-110 active:scale-95">
            <img src={logo} alt="АН-30 Автозапчасти" className="h-14 w-auto" />
          </Link>
          
          {/* Mobile search */}
          <div ref={mobileSearchRef} className="relative flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowResults(true)}
                className="w-full h-10 pl-10 pr-4 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />

            </div>
            
            {showResults && (searchResults.length > 0 || searchQuery.length >= 2) &&
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden max-h-[60vh] overflow-y-auto overscroll-contain">
                {searchResults.length > 0 ?
              <div className="py-2">
                    {searchResults.map((product) => {
                      const imgUrl = product.product_images?.[0]?.url || "/placeholder.svg";
                      return (
                        <button
                          key={product.id}
                          onClick={() => handleProductClick(product.id)}
                          className="w-full px-3 py-2 text-left hover:bg-secondary transition-colors flex items-center gap-3">
                          <img src={imgUrl} alt="" className="w-10 h-10 rounded-md object-cover bg-secondary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm line-clamp-1">{product.display_title || product.title}</p>
                            <div className="flex items-center gap-2">
                              {product.sku &&
                                <span className="text-xs text-muted-foreground">Арт: {product.sku}</span>
                              }
                              {product.brand &&
                                <span className="text-xs text-muted-foreground/70">• {product.brand}</span>
                              }
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-primary shrink-0 ml-2">
                            {product.price.toLocaleString()} ₽
                          </span>
                        </button>
                      );
                    })}
                  </div> :

              <div className="px-4 py-3 text-sm text-muted-foreground">
                    Ничего не найдено
                  </div>
              }
              </div>
            }
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick || (() => setIsMenuOpen(!isMenuOpen))}>

            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Mobile nav */}
      {isMenuOpen &&
      <div className="lg:hidden border-t border-border animate-slide-down">
          <ScrollArea className="h-[calc(100vh-180px)] max-h-[500px]">
            {/* Mobile Search */}
            <div className="container pt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                type="text"
                placeholder="Поиск товаров..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10" />

              </div>
              {searchResults.length > 0 &&
            <div className="mt-2 bg-secondary rounded-lg overflow-hidden">
                  {searchResults.map((product) => {
                    const imgUrl = product.product_images?.[0]?.url || "/placeholder.svg";
                    return (
                      <button
                        key={product.id}
                        onClick={() => {
                          handleProductClick(product.id);
                          setIsMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-muted transition-colors flex items-center gap-3">
                        <img src={imgUrl} alt="" className="w-9 h-9 rounded-md object-cover bg-muted shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm line-clamp-1">{product.title}</p>
                          {product.sku &&
                            <p className="text-xs text-muted-foreground">Арт: {product.sku}</p>
                          }
                        </div>
                        <span className="text-sm font-semibold text-primary shrink-0 ml-2">
                          {product.price.toLocaleString()} ₽
                        </span>
                      </button>
                    );
                  })}
                </div>
            }
            </div>
            <nav className="container py-4 flex flex-col gap-1">
              <Link
              to="/"
              onClick={() => setIsMenuOpen(false)}
              className={`py-2 px-3 rounded-md font-medium transition-colors ${
              location.pathname === "/" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`
              }>

                Главная
              </Link>
              <Link
              to="/catalog"
              onClick={() => setIsMenuOpen(false)}
              className={`py-2 px-3 rounded-md font-medium transition-colors ${
              location.pathname === "/catalog" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`
              }>

                Каталог
              </Link>
              
              {/* Mobile: Клиентам collapsible */}
              <Collapsible open={clientMenuOpen} onOpenChange={setClientMenuOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 rounded-md font-medium transition-colors hover:bg-secondary">
                  <span>Клиентам</span>
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${clientMenuOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="animate-accordion-down">
                  {clientMenuItems.map((item) =>
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={`py-2 px-3 pl-6 rounded-md font-medium transition-colors block ${
                  location.pathname === item.href ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`
                  }>

                      {item.label}
                    </Link>
                )}
                </CollapsibleContent>
              </Collapsible>

              {/* Mobile: Компания collapsible */}
              <Collapsible open={companyMenuOpen} onOpenChange={setCompanyMenuOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 rounded-md font-medium transition-colors hover:bg-secondary">
                  <span>Компания</span>
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${companyMenuOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="animate-accordion-down">
                  {companyMenuItems.map((item) =>
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={`py-2 px-3 pl-6 rounded-md font-medium transition-colors block ${
                  location.pathname === item.href ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`
                  }>

                      {item.label}
                    </Link>
                )}
                </CollapsibleContent>
              </Collapsible>

              <button
              onClick={() => {
                setIsMenuOpen(false);
                openChat();
              }}
              className="py-2 px-3 rounded-md font-medium transition-colors hover:bg-secondary text-left flex items-center gap-2">

                <Headphones className="h-4 w-4" />
                Помощь эксперта
              </button>

              {/* Social icons for mobile */}
              <div className="flex items-center gap-3 py-3 px-3">
                <a
                href="https://vk.com/an30_autoparts"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors">

                  <VKIcon className="h-5 w-5" />
                </a>
                <a
                href="https://wa.me/79244742605"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center hover:bg-success hover:text-primary-foreground transition-colors">

                  <MessageCircle className="h-5 w-5" />
                </a>
                <a
                href="https://t.me/an30_autoparts"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors">

                  <Send className="h-5 w-5" />
                </a>
              </div>

              <div className="flex gap-2 mt-2">
                <Link to="/map" target="_blank" className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">
                    <MapPin className="h-4 w-4 mr-1.5" />
                    Карта
                  </Button>
                </Link>
                {user ?
              <Link to={isAdmin ? "/admin" : "/profile"} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <User className="h-4 w-4 mr-1.5" />
                      {isAdmin ? "Админ" : "Профиль"}
                    </Button>
                  </Link> :

              <Link to="/auth" className="flex-1">
                    <Button size="sm" className="w-full">
                      <LogIn className="h-4 w-4 mr-1.5" />
                      Войти
                    </Button>
                  </Link>
              }
              </div>
            </nav>
          </ScrollArea>
        </div>
      }
    </header>);

}