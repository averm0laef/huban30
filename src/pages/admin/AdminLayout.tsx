import { useEffect, useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { 
  LayoutDashboard, MessageSquare, FileText, Image, 
  Package, FolderTree, Settings, LogOut, Users, ChevronRight, Menu, RefreshCw, ExternalLink, ClipboardList, Target,
  CalendarCheck, FileBarChart, Building2, ScrollText, UserCheck, PackageCheck, Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import logo from "@/assets/logo.svg";

interface MenuItem {
  href?: string;
  label: string;
  icon?: any;
  badge?: boolean;
  type?: string;
  roles?: string[]; // which roles can see this item
}

const allMenuItems: MenuItem[] = [
  { href: "/admin", label: "Дашборд", icon: LayoutDashboard },
  { href: "/admin/chat", label: "Чат", icon: MessageSquare, badge: true, roles: ["admin", "director"] },
  { href: "/admin/requests", label: "Заявки", icon: ClipboardList, roles: ["admin", "director"] },
  { type: "separator", label: "Учёт" },
  { href: "/admin/attendance", label: "Посещаемость", icon: CalendarCheck },
  { href: "/admin/reports", label: "Отчёты", icon: FileBarChart },
  { href: "/admin/employees", label: "Сотрудники", icon: UserCheck, roles: ["admin", "director"] },
  { href: "/admin/entities", label: "ИП / Категории", icon: Building2, roles: ["admin", "director"] },
  { href: "/admin/logs", label: "Логи действий", icon: ScrollText, roles: ["admin", "director"] },
  { type: "separator", label: "Контент", roles: ["admin", "director"] },
  { href: "/admin/banners", label: "Баннеры", icon: Image, roles: ["admin", "director"] },
  { href: "/admin/engine-parts", label: "Точки на капоте", icon: Target, roles: ["admin", "director"] },
  { href: "/admin/pages", label: "Страницы", icon: FileText, roles: ["admin", "director"] },
  { type: "separator", label: "Каталог", roles: ["admin", "director"] },
  { href: "/admin/vin-lookup", label: "Подбор артикулов", icon: Search, roles: ["admin", "director", "manager"] },
  { href: "/admin/categories", label: "Категории", icon: FolderTree, roles: ["admin", "director"] },
  { href: "/admin/products", label: "Товары", icon: Package, roles: ["admin", "director"] },
  { href: "/admin/exchange", label: "Обмен 1С", icon: RefreshCw, roles: ["admin", "director"] },
  { href: "/admin/staging", label: "Импорт из 1С", icon: PackageCheck, roles: ["admin", "director"] },
  { href: "/admin/invoices", label: "Накладные", icon: FileText, roles: ["admin", "director"] },
  { type: "separator", label: "Система", roles: ["admin", "director"] },
  { href: "/admin/users", label: "Пользователи", icon: Users, roles: ["admin", "director"] },
  { href: "/admin/settings", label: "Настройки", icon: Settings, roles: ["admin", "director"] },
];

function SidebarContent({ onItemClick, userRole }: { onItemClick?: () => void; userRole: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const visibleItems = allMenuItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(userRole);
  });

  return (
    <>
      <div className="p-5 border-b border-border">
        <Link to="/" className="flex items-center gap-3" onClick={onItemClick}>
          <img src={logo} alt="АН-30" className="h-10 w-auto" />
          <div>
            <span className="font-display font-bold text-base block leading-tight">АН-30</span>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              {userRole === "manager" ? "Менеджер" : userRole === "director" ? "Директор" : "Панель управления"}
            </span>
          </div>
        </Link>
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {visibleItems.map((item, index) => {
            if (item.type === "separator") {
              return (
                <div key={index} className="pt-5 pb-2">
                  <span className="px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                    {item.label}
                  </span>
                </div>
              );
            }

            const Icon = item.icon!;
            const isActive = location.pathname === item.href;

            return (
              <Link
                key={item.href}
                to={item.href!}
                onClick={onItemClick}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "hover:bg-secondary text-foreground/70 hover:text-foreground"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
                )}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="p-3 border-t border-border space-y-1">
        <Link to="/" className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
          <ExternalLink className="h-4 w-4" />
          <span>Открыть сайт</span>
        </Link>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-destructive rounded-xl"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4 mr-3" />
          Выйти
        </Button>
      </div>
    </>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isManager, role, isLoading } = useAuth();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const hasAccess = isAdmin || isManager;

  useEffect(() => {
    if (!isLoading && (!user || !hasAccess)) {
      navigate("/auth");
    }
  }, [user, hasAccess, isLoading, navigate]);

  useEffect(() => {
    setSheetOpen(false);
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin h-8 w-8 border-3 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (!user || !hasAccess) {
    return null;
  }

  const currentLabel = allMenuItems.find(m => m.href === location.pathname)?.label || "";

  return (
    <div className="min-h-screen flex bg-background">
      {!isMobile && (
        <aside className="w-[260px] bg-card border-r border-border flex flex-col shrink-0 sticky top-0 h-screen">
          <SidebarContent userRole={role} />
        </aside>
      )}

      <main className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-lg border-b border-border px-4 md:px-6 py-3 flex items-center gap-3">
          {isMobile && (
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 rounded-xl">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-[260px] flex flex-col">
                <SidebarContent onItemClick={() => setSheetOpen(false)} userRole={role} />
              </SheetContent>
            </Sheet>
          )}
          
          <div className="flex items-center gap-2 text-sm">
            <Link to="/admin" className="text-muted-foreground hover:text-foreground transition-colors">
              Панель управления
            </Link>
            {location.pathname !== "/admin" && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="text-foreground font-medium">{currentLabel}</span>
              </>
            )}
          </div>

          {isMobile && (
            <div className="ml-auto">
              <img src={logo} alt="АН-30" className="h-7 w-auto" />
            </div>
          )}
        </header>

        <div className="flex-1 p-4 md:p-6 lg:p-8 overflow-hidden flex flex-col min-h-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
