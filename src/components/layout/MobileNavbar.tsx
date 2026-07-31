import { Link, useLocation } from "react-router-dom";
import { Home, Search, User, MessageCircle, LogIn, ShoppingCart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { useCart } from "@/contexts/CartContext";

interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  action?: () => void;
  badge?: number;
}

export function MobileNavbar() {
  const location = useLocation();
  const { user, isAdmin } = useAuth();
  const { toggleChat, isOpen: isChatOpen, hasUnread } = useChat();
  const { totalItems, setCartOpen } = useCart();

  const navItems: NavItem[] = [
    { icon: Home, label: "Главная", href: "/" },
    { icon: Search, label: "Каталог", href: "/catalog" },
    { icon: ShoppingCart, label: "Корзина", action: () => setCartOpen(true), badge: totalItems },
    { icon: MessageCircle, label: "Чат", action: toggleChat },
    { 
      icon: user ? User : LogIn, 
      label: user ? "Профиль" : "Войти", 
      href: user ? (isAdmin ? "/admin" : "/profile") : "/auth" 
    },
  ];

  const isActive = (href?: string) => {
    if (!href) return false;
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border lg:hidden safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isChatItem = item.label === "Чат";

          if (item.action) {
            return (
              <button
                key={item.label}
                onClick={item.action}
                className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors relative ${
                  isChatItem && isChatOpen ? "text-primary" : "text-muted-foreground hover:text-primary"
                }`}
              >
                <div className="relative">
                  <Icon className={`h-5 w-5 ${isChatItem && isChatOpen ? "stroke-[2.5]" : ""}`} />
                  {isChatItem && hasUnread && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-destructive rounded-full animate-pulse" />
                  )}
                  {item.badge && item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center px-1">{item.badge}</span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.label}
              to={item.href!}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-primary"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : ""}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
