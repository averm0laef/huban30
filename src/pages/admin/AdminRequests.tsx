import { useState, useEffect, useRef } from "react";
import { Phone, Mail, User, Clock, MessageSquare, CheckCircle2, XCircle, AlertCircle, Loader2, ShoppingCart, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ContactRequest {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  message: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CartOrderItem {
  id: string;
  title: string;
  price: number;
  quantity: number;
  sku?: string | null;
}

interface CartOrder {
  id: string;
  guest_name: string | null;
  guest_phone: string;
  guest_email: string | null;
  items: CartOrderItem[];
  total_amount: number;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  user_id: string | null;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: "Новая", color: "bg-blue-100 text-blue-700 border-blue-200", icon: AlertCircle },
  in_progress: { label: "В работе", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Clock },
  completed: { label: "Выполнена", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  cancelled: { label: "Отменена", color: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
};

const formatDate = (d: string) => new Date(d).toLocaleDateString("ru-RU", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

// Simple notification sound using Web Audio API
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    // Two-tone notification
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1046, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Audio not available
  }
}

export default function AdminRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [cartOrders, setCartOrders] = useState<CartOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<ContactRequest | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<CartOrder | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("orders");
  const initialLoadDone = useRef(false);

  useEffect(() => {
    loadAll();

    const ch1 = supabase
      .channel("admin-requests")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "contact_requests" }, () => {
        if (initialLoadDone.current) {
          playNotificationSound();
          toast({ title: "🔔 Новая заявка!", description: "Поступило новое обращение" });
        }
        loadRequests();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "contact_requests" }, () => loadRequests())
      .subscribe();

    const ch2 = supabase
      .channel("admin-cart-orders")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cart_orders" }, () => {
        if (initialLoadDone.current) {
          playNotificationSound();
          toast({ title: "🛒 Новый заказ!", description: "Поступил заказ из корзины" });
        }
        loadCartOrders();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cart_orders" }, () => loadCartOrders())
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, []);

  const loadAll = async () => {
    setIsLoading(true);
    await Promise.all([loadRequests(), loadCartOrders()]);
    setIsLoading(false);
    initialLoadDone.current = true;
  };

  const loadRequests = async () => {
    try {
      const { data, error } = await supabase
        .from("contact_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRequests((data as ContactRequest[]) || []);
    } catch (error) {
      console.error("Error loading requests:", error);
    }
  };

  const loadCartOrders = async () => {
    try {
      const { data, error } = await supabase
        .from("cart_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setCartOrders((data as unknown as CartOrder[]) || []);
    } catch (error) {
      console.error("Error loading cart orders:", error);
    }
  };

  const updateRequest = async (id: string, status: string, notes?: string) => {
    setIsSaving(true);
    try {
      const updateData: Record<string, string> = { status };
      if (notes !== undefined) updateData.admin_notes = notes;
      const { error } = await supabase.from("contact_requests").update(updateData).eq("id", id);
      if (error) throw error;
      toast({ title: "Заявка обновлена" });
      setSelectedRequest(null);
      loadRequests();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Ошибка", description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const updateCartOrder = async (id: string, status: string, notes?: string) => {
    setIsSaving(true);
    try {
      const updateData: Record<string, string> = { status };
      if (notes !== undefined) updateData.admin_notes = notes;
      const { error } = await supabase.from("cart_orders").update(updateData).eq("id", id);
      if (error) throw error;
      toast({ title: "Заказ обновлён" });
      setSelectedOrder(null);
      loadCartOrders();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Ошибка", description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const getFiltered = <T extends { status: string }>(list: T[]) =>
    filterStatus === "all" ? list : list.filter(r => r.status === filterStatus);

  const newOrdersCount = cartOrders.filter(o => o.status === "new").length;
  const newRequestsCount = requests.filter(r => r.status === "new").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Заявки и заказы</h1>
        <p className="text-muted-foreground">Управление обращениями и заказами из корзины</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="orders" className="gap-2">
            <ShoppingCart className="h-4 w-4" />
            Заказы
            {newOrdersCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-5 text-[10px] px-1.5">{newOrdersCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Обращения
            {newRequestsCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-5 text-[10px] px-1.5">{newRequestsCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Filter stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {[
            { label: "Всего", filter: "all" },
            { label: "Новые", filter: "new" },
            { label: "В работе", filter: "in_progress" },
            { label: "Выполнено", filter: "completed" },
          ].map((stat) => {
            const source = activeTab === "orders" ? cartOrders : requests;
            const count = stat.filter === "all" ? source.length : source.filter(r => r.status === stat.filter).length;
            return (
              <Card
                key={stat.filter}
                className={`cursor-pointer transition-all ${filterStatus === stat.filter ? "ring-2 ring-primary" : "hover:bg-secondary/50"}`}
                onClick={() => setFilterStatus(stat.filter)}
              >
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Cart orders tab */}
        <TabsContent value="orders">
          {getFiltered(cartOrders).length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground">Заказов пока нет</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {getFiltered(cartOrders).map((order) => {
                const statusInfo = statusConfig[order.status] || statusConfig.new;
                const StatusIcon = statusInfo.icon;
                const items = Array.isArray(order.items) ? order.items : [];
                return (
                  <Card
                    key={order.id}
                    className="cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => { setSelectedOrder(order); setAdminNotes(order.admin_notes || ""); }}
                  >
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-semibold truncate">{order.guest_name || "Без имени"}</span>
                            <Badge variant="outline" className={`text-xs shrink-0 ${statusInfo.color}`}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {statusInfo.label}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Phone className="h-3.5 w-3.5" /> {order.guest_phone}
                            </span>
                            {order.guest_email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3.5 w-3.5" /> {order.guest_email}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" /> {formatDate(order.created_at)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-sm">
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Package className="h-3.5 w-3.5" /> {items.length} товар(ов)
                            </span>
                            <span className="font-bold text-primary">
                              {order.total_amount.toLocaleString()} ₽
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Contact requests tab */}
        <TabsContent value="contacts">
          {getFiltered(requests).length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground">Заявок пока нет</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {getFiltered(requests).map((request) => {
                const statusInfo = statusConfig[request.status] || statusConfig.new;
                const StatusIcon = statusInfo.icon;
                return (
                  <Card
                    key={request.id}
                    className="cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => { setSelectedRequest(request); setAdminNotes(request.admin_notes || ""); }}
                  >
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold truncate">{request.name || "Без имени"}</span>
                          <Badge variant="outline" className={`text-xs shrink-0 ${statusInfo.color}`}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusInfo.label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" /> {request.phone}
                          </span>
                          {request.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3.5 w-3.5" /> {request.email}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> {formatDate(request.created_at)}
                          </span>
                        </div>
                        {request.message && (
                          <p className="text-sm mt-2 line-clamp-2 text-foreground/80">{request.message}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Contact request detail dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={(open) => !open && setSelectedRequest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Заявка от {selectedRequest?.name || "клиента"}</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Телефон</span>
                  <p className="font-medium">
                    <a href={`tel:${selectedRequest.phone}`} className="text-primary hover:underline">
                      {selectedRequest.phone}
                    </a>
                  </p>
                </div>
                {selectedRequest.email && (
                  <div>
                    <span className="text-muted-foreground">Email</span>
                    <p className="font-medium">{selectedRequest.email}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Дата</span>
                  <p className="font-medium">{formatDate(selectedRequest.created_at)}</p>
                </div>
              </div>
              {selectedRequest.message && (
                <div>
                  <span className="text-sm text-muted-foreground">Сообщение</span>
                  <p className="mt-1 text-sm bg-secondary/50 rounded-lg p-3">{selectedRequest.message}</p>
                </div>
              )}
              <div>
                <span className="text-sm text-muted-foreground">Статус</span>
                <Select
                  value={selectedRequest.status}
                  onValueChange={(value) => updateRequest(selectedRequest.id, value, adminNotes)}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Новая</SelectItem>
                    <SelectItem value="in_progress">В работе</SelectItem>
                    <SelectItem value="completed">Выполнена</SelectItem>
                    <SelectItem value="cancelled">Отменена</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Заметки администратора</span>
                <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Добавьте заметку..." rows={3} className="mt-1" />
              </div>
              <Button onClick={() => updateRequest(selectedRequest.id, selectedRequest.status, adminNotes)} disabled={isSaving} className="w-full">
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сохранить
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cart order detail dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              Заказ от {selectedOrder?.guest_name || "клиента"}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Телефон</span>
                  <p className="font-medium">
                    <a href={`tel:${selectedOrder.guest_phone}`} className="text-primary hover:underline">
                      {selectedOrder.guest_phone}
                    </a>
                  </p>
                </div>
                {selectedOrder.guest_email && (
                  <div>
                    <span className="text-muted-foreground">Email</span>
                    <p className="font-medium">{selectedOrder.guest_email}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Дата</span>
                  <p className="font-medium">{formatDate(selectedOrder.created_at)}</p>
                </div>
              </div>

              {/* Order items */}
              <div>
                <span className="text-sm text-muted-foreground">Товары</span>
                <div className="mt-2 bg-secondary/50 rounded-xl p-4 space-y-2">
                  {(Array.isArray(selectedOrder.items) ? selectedOrder.items : []).map((item: any, idx: number) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <div className="flex-1 min-w-0 mr-2">
                        <span className="line-clamp-1">{item.title}</span>
                        {item.sku && <span className="text-xs text-muted-foreground"> ({item.sku})</span>}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="text-muted-foreground">{item.quantity} × </span>
                        <span className="font-medium">{Number(item.price).toLocaleString()} ₽</span>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-bold">
                    <span>Итого:</span>
                    <span className="text-primary">{selectedOrder.total_amount.toLocaleString()} ₽</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="text-sm text-muted-foreground">Статус</span>
                <Select
                  value={selectedOrder.status}
                  onValueChange={(value) => updateCartOrder(selectedOrder.id, value, adminNotes)}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Новый</SelectItem>
                    <SelectItem value="in_progress">В работе</SelectItem>
                    <SelectItem value="completed">Выполнен</SelectItem>
                    <SelectItem value="cancelled">Отменён</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <span className="text-sm text-muted-foreground">Заметки администратора</span>
                <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Добавьте заметку..." rows={3} className="mt-1" />
              </div>

              <Button onClick={() => updateCartOrder(selectedOrder.id, selectedOrder.status, adminNotes)} disabled={isSaving} className="w-full">
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сохранить
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
