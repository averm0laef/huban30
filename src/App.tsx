import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";

import { AuthProvider } from "@/contexts/AuthContext";
import { ChatProvider } from "@/contexts/ChatContext";
import { CartProvider } from "@/contexts/CartContext";
import { ScrollToTop } from "@/components/ScrollToTop";
import { CartSheet } from "@/components/cart/CartSheet";
import Index from "./pages/Index";
import Catalog from "./pages/Catalog";
import ProductPage from "./pages/ProductPage";
import About from "./pages/About";
import Delivery from "./pages/Delivery";
import Contacts from "./pages/Contacts";
import Map from "./pages/Map";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import Returns from "./pages/Returns";
import HowToOrder from "./pages/HowToOrder";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import ExpertHelp from "./pages/ExpertHelp";
import Chat from "./pages/Chat";
import Careers from "./pages/Careers";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import AdminChat from "./pages/admin/AdminChat";
import AdminProducts from "./pages/admin/AdminProducts";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminBanners from "./pages/admin/AdminBanners";
import AdminPages from "./pages/admin/AdminPages";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminExchange from "./pages/admin/AdminExchange";
import AdminStaging from "./pages/admin/AdminStaging";
import AdminRequests from "./pages/admin/AdminRequests";
import AdminEngineParts from "./pages/admin/AdminEngineParts";
import AdminAttendance from "./pages/admin/AdminAttendance";
import AdminReports from "./pages/admin/AdminReports";
import AdminEmployees from "./pages/admin/AdminEmployees";
import AdminEntities from "./pages/admin/AdminEntities";
import AdminActionLogs from "./pages/admin/AdminActionLogs";
import AdminInvoices from "./pages/admin/AdminInvoices";
import AdminVINLookup from "./pages/admin/AdminVINLookup";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <ChatProvider>
          <CartProvider>
            <TooltipProvider>
              <BrowserRouter>
                <ScrollToTop />
                <CartSheet />
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/catalog" element={<Catalog />} />
                  <Route path="/catalog/product/:id" element={<ProductPage />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/delivery" element={<Delivery />} />
                  <Route path="/contacts" element={<Contacts />} />
                  <Route path="/map" element={<Map />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/returns" element={<Returns />} />
                  <Route path="/how-to-order" element={<HowToOrder />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/expert-help" element={<ExpertHelp />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/careers" element={<Careers />} />
                  
                  {/* Admin routes */}
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="chat" element={<AdminChat />} />
                    <Route path="products" element={<AdminProducts />} />
                    <Route path="categories" element={<AdminCategories />} />
                    <Route path="banners" element={<AdminBanners />} />
                    <Route path="pages" element={<AdminPages />} />
                    <Route path="settings" element={<AdminSettings />} />
                    <Route path="users" element={<AdminUsers />} />
                    <Route path="exchange" element={<AdminExchange />} />
                    <Route path="staging" element={<AdminStaging />} />
                    <Route path="requests" element={<AdminRequests />} />
                    <Route path="engine-parts" element={<AdminEngineParts />} />
                    <Route path="attendance" element={<AdminAttendance />} />
                    <Route path="reports" element={<AdminReports />} />
                    <Route path="employees" element={<AdminEmployees />} />
                    <Route path="entities" element={<AdminEntities />} />
                    <Route path="logs" element={<AdminActionLogs />} />
                    <Route path="invoices" element={<AdminInvoices />} />
                    <Route path="vin-lookup" element={<AdminVINLookup />} />
                  </Route>
                  
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </CartProvider>
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
