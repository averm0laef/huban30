import { Link, useLocation } from "react-router-dom";
import {
  User,
  Heart,
  FolderTree,
  Info,
  Truck,
  RotateCcw,
  ShoppingCart,
  FileText,
  Shield,
  MapPin,
  Phone,
  MessageCircle,
  Send,
  Headphones,
  Home,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import logo from "@/assets/logo.svg";

interface MobileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const menuItems = [
  { icon: Home, label: "Главная", href: "/" },
  { icon: User, label: "Профиль", href: "/profile", authRequired: true },
  { icon: Heart, label: "Закладки", href: "/profile", authRequired: true },
  { icon: FolderTree, label: "Каталоги", href: "/catalog" },
];

const clientMenuItems = [
  { icon: Truck, label: "Условия доставки", href: "/delivery" },
  { icon: RotateCcw, label: "Возврат товара", href: "/returns" },
  { icon: ShoppingCart, label: "Как сделать заказ", href: "/how-to-order" },
  { icon: FileText, label: "Условия работы для клиентов", href: "/terms" },
  { icon: Shield, label: "Политика конфиденциальности", href: "/privacy" },
];

const companyMenuItems = [
  { icon: Info, label: "О компании", href: "/about" },
  { icon: MapPin, label: "Адрес магазина", href: "/map" },
  { icon: Phone, label: "Контакты", href: "/contacts" },
];

export function MobileDrawer({ open, onOpenChange }: MobileDrawerProps) {
  const location = useLocation();
  const { user, isAdmin } = useAuth();
  const { openChat } = useChat();
  const { setTheme, theme } = useTheme();

  const handleClose = () => onOpenChange(false);

  const handleChatClick = () => {
    handleClose();
    openChat();
  };

  const isActive = (href: string) => location.pathname === href;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 w-80">
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="sr-only">Меню</SheetTitle>
          <Link to="/" onClick={handleClose} className="flex items-center gap-2">
            <img src={logo} alt="АН-30" className="h-12" />
          </Link>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="p-3 space-y-1">
            {menuItems.map((item) => {
              if (item.authRequired && !user) return null;
              const Icon = item.icon;
              const href = item.href === "/profile" && isAdmin ? "/admin" : item.href;
              
              return (
                <Link
                  key={item.label}
                  to={href}
                  onClick={handleClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive(href) ? "bg-primary/10 text-primary" : "hover:bg-secondary"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}

            {/* Помощь эксперта */}
            <button
              onClick={handleChatClick}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-secondary w-full text-left"
            >
              <Headphones className="h-5 w-5" />
              <span className="font-medium">Помощь эксперта</span>
            </button>
          </div>

          <Separator className="my-2" />

          {/* Клиентам */}
          <div className="p-3">
            <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Клиентам
            </p>
            <div className="space-y-1">
              {clientMenuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    to={item.href}
                    onClick={handleClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive(item.href) ? "bg-primary/10 text-primary" : "hover:bg-secondary"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <Separator className="my-2" />

          {/* Компания */}
          <div className="p-3">
            <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Компания
            </p>
            <div className="space-y-1">
              {companyMenuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    to={item.href}
                    onClick={handleClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive(item.href) ? "bg-primary/10 text-primary" : "hover:bg-secondary"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <Separator className="my-2" />

          {/* Theme switcher */}
          <div className="p-3">
            <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Тема оформления
            </p>
            <div className="flex gap-2 px-3">
              <button
                onClick={() => setTheme("light")}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors flex-1 ${
                  theme === "light" ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"
                }`}
              >
                <Sun className="h-4 w-4" />
                <span className="text-sm font-medium">Светлая</span>
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors flex-1 ${
                  theme === "dark" ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"
                }`}
              >
                <Moon className="h-4 w-4" />
                <span className="text-sm font-medium">Тёмная</span>
              </button>
            </div>
          </div>

          <Separator className="my-2" />

          {/* Contact info */}
          <div className="p-4">
            <a 
              href="tel:+79244742605" 
              className="flex items-center gap-2 text-lg font-semibold text-foreground mb-3"
            >
              <Phone className="h-5 w-5 text-primary" />
              +7 (924) 474-26-05
            </a>
            <div className="flex items-center gap-3">
              <a 
                href="https://wa.me/79244742605" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-secondary hover:bg-secondary/80 transition-colors"
                title="WhatsApp"
              >
                <MessageCircle className="h-5 w-5" />
              </a>
              <a 
                href="https://t.me/an30_autoparts" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-secondary hover:bg-secondary/80 transition-colors"
                title="Telegram"
              >
                <Send className="h-5 w-5" />
              </a>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
