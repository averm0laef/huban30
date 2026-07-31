import { ReactNode, useState } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { MobileNavbar } from "./MobileNavbar";
import { MobileDrawer } from "./MobileDrawer";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { usePageViewTracker } from "@/hooks/usePageViewTracker";

interface MainLayoutProps {
  children: ReactNode;
  hideFooter?: boolean;
}

export function MainLayout({ children, hideFooter = false }: MainLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  usePageViewTracker();

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuClick={() => setDrawerOpen(true)} />
      <main className="flex-1 pb-16 lg:pb-0">
        {children}
      </main>
      {!hideFooter && <Footer />}
      <MobileNavbar />
      <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <ChatWidget />
    </div>
  );
}
