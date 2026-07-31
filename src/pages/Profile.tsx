import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User, Mail, Phone, MapPin, Edit, LogOut, Loader2, ArrowLeft, Heart, Clock, MessageCircle, Lock, Eye, EyeOff, Key, Send, Trash2, ShoppingCart, Package, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { ProfileCompletionPrompt } from "@/components/profile/ProfileCompletionPrompt";

const passwordSchema = z.object({
  currentPassword: z.string().min(6, "Минимум 6 символов"),
  newPassword: z.string().min(6, "Минимум 6 символов"),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

type PasswordFormData = z.infer<typeof passwordSchema>;

interface ChatThread {
  id: string;
  created_at: string;
  status: string;
  last_message_at: string | null;
  messages_count?: number;
}

interface FavoriteProduct {
  id: string;
  title: string;
  price: number;
  old_price: number | null;
  image_url: string | null;
}

interface ViewedProduct {
  id: string;
  title: string;
  price: number;
  old_price: number | null;
  image_url: string | null;
  viewed_at: string;
}

interface UserOrder {
  id: string;
  items: any[];
  total_amount: number;
  status: string;
  created_at: string;
  guest_phone: string;
}

export default function Profile() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, signOut, refreshProfile, isLoading: authLoading } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    address: "",
  });
  
  // Password change
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Chat history
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  
  // Favorites
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  
  // View history
  const [viewHistory, setViewHistory] = useState<ViewedProduct[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Orders
  const [orders, setOrders] = useState<UserOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  
  // Profile completion prompt
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false);

  // Check if user needs to complete profile on first load
  useEffect(() => {
    if (profile) {
      const isTelegramUser = user?.email?.includes("@telegram.local");
      const needsPhone = !profile.phone;
      const needsEmail = isTelegramUser && !profile.email;
      
      // Show prompt if missing data and not dismissed this session
      const dismissed = sessionStorage.getItem("profile_prompt_dismissed");
      if ((needsPhone || needsEmail) && !dismissed) {
        setShowCompletionPrompt(true);
      }
    }
  }, [profile, user]);

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || "",
        phone: profile.phone || "",
        address: profile.address || "",
      });
    }
  }, [profile]);

  useEffect(() => {
    if (user) {
      loadChatHistory();
      loadFavorites();
      loadViewHistory();
      loadOrders();
      
      // Subscribe to realtime updates for chat threads
      const channel = supabase
        .channel('profile-chat-updates')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'chat_threads',
          },
          (payload) => {
            const updated = payload.new as any;
            setChatThreads(prev => 
              prev.map(thread => 
                thread.id === updated.id 
                  ? { ...thread, status: updated.status, last_message_at: updated.last_message_at }
                  : thread
              )
            );
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const loadChatHistory = async () => {
    if (!user) return;
    
    setIsLoadingChats(true);
    try {
      const { data: threads, error } = await supabase
        .from('chat_threads')
        .select('id, created_at, status, last_message_at')
        .eq('user_id', user.id)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      // Get message counts for each thread
      const threadsWithCounts = await Promise.all(
        (threads || []).map(async (thread) => {
          const { count } = await supabase
            .from('chat_messages')
            .select('*', { count: 'exact', head: true })
            .eq('thread_id', thread.id);
          
          return { ...thread, messages_count: count || 0 };
        })
      );

      setChatThreads(threadsWithCounts);
    } catch (error) {
      console.error('Error loading chat history:', error);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const loadFavorites = async () => {
    if (!user) return;
    
    setIsLoadingFavorites(true);
    try {
      const { data, error } = await supabase
        .from('user_favorites')
        .select(`
          product_id,
          products:product_id (
            id,
            title,
            price,
            old_price,
            product_images (url, sort_order)
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const favProducts: FavoriteProduct[] = (data || [])
        .filter(f => f.products)
        .map(f => {
          const p = f.products as any;
          const images = p.product_images || [];
          const sortedImages = [...images].sort((a: any, b: any) => a.sort_order - b.sort_order);
          return {
            id: p.id,
            title: p.title,
            price: p.price,
            old_price: p.old_price,
            image_url: sortedImages[0]?.url || null
          };
        });

      setFavorites(favProducts);
    } catch (error) {
      console.error('Error loading favorites:', error);
    } finally {
      setIsLoadingFavorites(false);
    }
  };

  const loadViewHistory = async () => {
    if (!user) return;
    
    setIsLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('user_product_views')
        .select(`
          product_id,
          viewed_at,
          products:product_id (
            id,
            title,
            price,
            old_price,
            product_images (url, sort_order)
          )
        `)
        .eq('user_id', user.id)
        .order('viewed_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const viewedProducts: ViewedProduct[] = (data || [])
        .filter(v => v.products)
        .map(v => {
          const p = v.products as any;
          const images = p.product_images || [];
          const sortedImages = [...images].sort((a: any, b: any) => a.sort_order - b.sort_order);
          return {
            id: p.id,
            title: p.title,
            price: p.price,
            old_price: p.old_price,
            image_url: sortedImages[0]?.url || null,
            viewed_at: v.viewed_at
          };
        });

      setViewHistory(viewedProducts);
    } catch (error) {
      console.error('Error loading view history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };
  const loadOrders = async () => {
    if (!user) return;
    setIsLoadingOrders(true);
    try {
      const { data, error } = await supabase
        .from('cart_orders')
        .select('id, items, total_amount, status, created_at, guest_phone')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setOrders((data as unknown as UserOrder[]) || []);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const removeFavorite = async (productId: string) => {
    if (!user) return;
    
    try {
      await supabase
        .from('user_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('product_id', productId);

      setFavorites(prev => prev.filter(p => p.id !== productId));
      toast({ title: "Убрано из избранного" });
    } catch (error) {
      console.error('Error removing favorite:', error);
    }
  };

  const clearViewHistory = async () => {
    if (!user) return;
    
    try {
      await supabase
        .from('user_product_views')
        .delete()
        .eq('user_id', user.id);

      setViewHistory([]);
      toast({ title: "История просмотров очищена" });
    } catch (error) {
      console.error('Error clearing view history:', error);
      toast({ variant: "destructive", title: "Ошибка очистки истории" });
    }
  };

  const handleSave = async () => {
    if (!user) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: formData.full_name,
          phone: formData.phone,
          address: formData.address,
        })
        .eq("user_id", user.id);

      if (error) throw error;

      await refreshProfile();
      setIsEditing(false);
      toast({ title: "Профиль обновлён" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async (data: PasswordFormData) => {
    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: data.newPassword
      });

      if (error) throw error;

      toast({ title: "Пароль успешно изменён" });
      setIsPasswordDialogOpen(false);
      passwordForm.reset();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message,
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
    toast({ title: "Вы вышли из аккаунта" });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'new': return 'Новый';
      case 'waiting': return 'Ожидает ответа';
      case 'active': return 'Активный';
      case 'closed': return 'Закрыт';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-500/10 text-blue-600';
      case 'waiting': return 'bg-yellow-500/10 text-yellow-600';
      case 'active': return 'bg-green-500/10 text-green-600';
      case 'closed': return 'bg-gray-500/10 text-gray-600';
      default: return 'bg-gray-500/10 text-gray-600';
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <MainLayout>
      <div className="bg-secondary/20 py-8">
        <div className="container max-w-4xl">
          <div className="mb-6">
            <Link to="/" className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4 mr-2" />
              На главную
            </Link>
          </div>

          {/* Profile completion prompt */}
          {showCompletionPrompt && user && (
            <div className="mb-6">
              <ProfileCompletionPrompt
                userId={user.id}
                currentPhone={profile?.phone || null}
                currentEmail={profile?.email || null}
                userEmail={user.email}
                onComplete={() => {
                  setShowCompletionPrompt(false);
                  refreshProfile();
                }}
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="w-16 h-16">
                    {profile?.avatar_url ? (
                      <AvatarImage src={profile.avatar_url} alt={profile?.full_name || "Пользователь"} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-primary text-xl">
                      {profile?.full_name ? profile.full_name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() : <User className="h-8 w-8" />}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-2xl">
                      {profile?.full_name || (user.email?.includes("@telegram.local") ? "Telegram пользователь" : "Пользователь")}
                    </CardTitle>
                    <CardDescription>
                      {user.email?.includes("@telegram.local") 
                        ? (profile?.telegram_id ? `Telegram ID: ${profile.telegram_id}` : "Вход через Telegram")
                        : user.email
                      }
                    </CardDescription>
                  </div>
                </div>
                <Button variant="outline" onClick={handleLogout}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Выйти
                </Button>
              </div>
            </CardHeader>

            <CardContent>
              <Tabs defaultValue="profile">
                <TabsList className="grid w-full grid-cols-5 mb-6">
                  <TabsTrigger value="profile">Профиль</TabsTrigger>
                  <TabsTrigger value="orders">Заказы</TabsTrigger>
                  <TabsTrigger value="chats">Чаты</TabsTrigger>
                  <TabsTrigger value="favorites">Избранное</TabsTrigger>
                  <TabsTrigger value="history">История</TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Личные данные</h3>
                    {!isEditing && (
                      <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Редактировать
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="full_name">Имя</Label>
                      {isEditing ? (
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="full_name"
                            value={formData.full_name}
                            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                            className="pl-10"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 p-3 rounded-md bg-secondary/50">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>{profile?.full_name || "Не указано"}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <div className="flex items-center gap-3 p-3 rounded-md bg-secondary/50">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {user.email?.includes("@telegram.local") 
                            ? (profile?.email || "Не привязан") 
                            : user.email
                          }
                        </span>
                        {user.email?.includes("@telegram.local") && !profile?.email && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            (вход через Telegram)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">Телефон</Label>
                      {isEditing ? (
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                          <PhoneInput
                            id="phone"
                            value={formData.phone}
                            onChange={(value) => setFormData({ ...formData, phone: value })}
                            className="pl-10"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 p-3 rounded-md bg-secondary/50">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span>{profile?.phone || "Не указан"}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address">Адрес</Label>
                      {isEditing ? (
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="address"
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            className="pl-10"
                            placeholder="Ваш адрес"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 p-3 rounded-md bg-secondary/50">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span>{profile?.address || "Не указан"}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="flex gap-3">
                      <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Сохранить
                      </Button>
                      <Button variant="outline" onClick={() => setIsEditing(false)}>
                        Отмена
                      </Button>
                    </div>
                  )}

                  {/* Password change section - only for non-Telegram users */}
                  {!user.email?.includes("@telegram.local") && (
                    <>
                      <Separator className="my-6" />
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold">Безопасность</h3>
                        <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
                          <DialogTrigger asChild>
                            <Button variant="outline">
                              <Key className="h-4 w-4 mr-2" />
                              Изменить пароль
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Изменение пароля</DialogTitle>
                              <DialogDescription>
                                Введите новый пароль для вашего аккаунта
                              </DialogDescription>
                            </DialogHeader>
                            <Form {...passwordForm}>
                              <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="space-y-4">
                                <FormField
                                  control={passwordForm.control}
                                  name="currentPassword"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Текущий пароль</FormLabel>
                                      <FormControl>
                                        <div className="relative">
                                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                          <Input 
                                            type={showCurrentPassword ? "text" : "password"}
                                            className="pl-10 pr-10" 
                                            {...field} 
                                          />
                                          <button
                                            type="button"
                                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                          >
                                            {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                          </button>
                                        </div>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={passwordForm.control}
                                  name="newPassword"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Новый пароль</FormLabel>
                                      <FormControl>
                                        <div className="relative">
                                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                          <Input 
                                            type={showNewPassword ? "text" : "password"}
                                            className="pl-10 pr-10" 
                                            {...field} 
                                          />
                                          <button
                                            type="button"
                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                          >
                                            {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                          </button>
                                        </div>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={passwordForm.control}
                                  name="confirmPassword"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Подтвердите пароль</FormLabel>
                                      <FormControl>
                                        <div className="relative">
                                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                          <Input 
                                            type={showConfirmPassword ? "text" : "password"}
                                            className="pl-10 pr-10" 
                                            {...field} 
                                          />
                                          <button
                                            type="button"
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                          >
                                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                          </button>
                                        </div>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <div className="flex gap-3 pt-4">
                                  <Button type="submit" disabled={isChangingPassword}>
                                    {isChangingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Изменить пароль
                                  </Button>
                                  <Button type="button" variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>
                                    Отмена
                                  </Button>
                                </div>
                              </form>
                            </Form>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </>
                  )}

                  {/* Info for Telegram users */}
                  {user.email?.includes("@telegram.local") && (
                    <>
                      <Separator className="my-6" />
                      <div className="space-y-2">
                        <h3 className="text-lg font-semibold">Безопасность</h3>
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                          <Send className="h-4 w-4" />
                          Вы вошли через Telegram — для входа используйте бота
                        </p>
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="orders">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Мои заказы</h3>
                    {isLoadingOrders ? (
                      <div className="text-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    ) : orders.length === 0 ? (
                      <div className="text-center py-12">
                        <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground">У вас пока нет заказов</p>
                        <Link to="/catalog">
                          <Button variant="outline" className="mt-4">Перейти в каталог</Button>
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {orders.map((order) => {
                          const items = Array.isArray(order.items) ? order.items : [];
                          const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
                            new: { label: "Новый", variant: "default" },
                            in_progress: { label: "В работе", variant: "secondary" },
                            completed: { label: "Выполнен", variant: "outline" },
                            cancelled: { label: "Отменён", variant: "destructive" },
                          };
                          const status = statusMap[order.status] || statusMap.new;
                          return (
                            <div key={order.id} className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                                  <Clock className="h-3.5 w-3.5" />
                                  {formatDate(order.created_at)}
                                </span>
                                <Badge variant={status.variant}>{status.label}</Badge>
                              </div>
                              <div className="space-y-1.5">
                                {items.slice(0, 3).map((item: any, idx: number) => (
                                  <div key={idx} className="flex justify-between text-sm">
                                    <span className="line-clamp-1 flex-1 mr-2">{item.title}</span>
                                    <span className="shrink-0 text-muted-foreground">
                                      {item.quantity} × {Number(item.price).toLocaleString()} ₽
                                    </span>
                                  </div>
                                ))}
                                {items.length > 3 && (
                                  <p className="text-xs text-muted-foreground">...и ещё {items.length - 3} товар(ов)</p>
                                )}
                              </div>
                              <div className="flex justify-between items-center pt-2 border-t">
                                <span className="text-sm text-muted-foreground">{items.length} товар(ов)</span>
                                <span className="font-bold text-primary">{order.total_amount.toLocaleString()} ₽</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="chats">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">История чатов</h3>
                    
                    {isLoadingChats ? (
                      <div className="text-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    ) : chatThreads.length === 0 ? (
                      <div className="text-center py-12">
                        <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground">У вас пока нет чатов</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Напишите нам через виджет чата в правом нижнем углу
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {chatThreads.map((thread) => (
                          <div
                            key={thread.id}
                            className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-secondary/30 transition-colors"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <MessageCircle className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">
                                  Чат от {formatDate(thread.created_at)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {thread.messages_count} сообщений
                                </p>
                              </div>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(thread.status)}`}>
                              {getStatusText(thread.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="favorites">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Избранное</h3>
                    
                    {isLoadingFavorites ? (
                      <div className="text-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    ) : favorites.length === 0 ? (
                      <div className="text-center py-12">
                        <Heart className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground">Избранные товары появятся здесь</p>
                        <Link to="/catalog">
                          <Button variant="outline" className="mt-4">
                            Перейти в каталог
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {favorites.map((product) => (
                          <Link
                            key={product.id}
                            to={`/product/${product.id}`}
                            className="group relative rounded-lg border bg-card overflow-hidden hover:border-primary transition-colors"
                          >
                            <div className="aspect-square bg-secondary/30">
                              <img 
                                src={product.image_url || "/placeholder.svg"} 
                                alt={product.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="p-3">
                              <p className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                                {product.title}
                              </p>
                              <div className="flex items-baseline gap-2 mt-1">
                                <span className="font-bold">{product.price.toLocaleString()} ₽</span>
                                {product.old_price && (
                                  <span className="text-xs text-muted-foreground line-through">
                                    {product.old_price.toLocaleString()} ₽
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                removeFavorite(product.id);
                              }}
                              className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 hover:bg-background text-red-500"
                            >
                              <Heart className="h-4 w-4 fill-current" />
                            </button>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="history">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">История просмотров</h3>
                      {viewHistory.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={clearViewHistory}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Очистить
                        </Button>
                      )}
                    </div>
                    
                    {isLoadingHistory ? (
                      <div className="text-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    ) : viewHistory.length === 0 ? (
                      <div className="text-center py-12">
                        <Clock className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground">История просмотров появится здесь</p>
                        <Link to="/catalog">
                          <Button variant="outline" className="mt-4">
                            Перейти в каталог
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {viewHistory.map((product) => (
                          <Link
                            key={product.id}
                            to={`/product/${product.id}`}
                            className="group rounded-lg border bg-card overflow-hidden hover:border-primary transition-colors"
                          >
                            <div className="aspect-square bg-secondary/30">
                              <img 
                                src={product.image_url || "/placeholder.svg"} 
                                alt={product.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="p-3">
                              <p className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                                {product.title}
                              </p>
                              <div className="flex items-baseline gap-2 mt-1">
                                <span className="font-bold">{product.price.toLocaleString()} ₽</span>
                                {product.old_price && (
                                  <span className="text-xs text-muted-foreground line-through">
                                    {product.old_price.toLocaleString()} ₽
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {new Date(product.viewed_at).toLocaleDateString("ru-RU", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
