import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShoppingCart, Minus, Plus, Trash2, Send, CheckCircle, Loader2 } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function CartSheet() {
  const { items, removeItem, updateQuantity, clearCart, totalItems, totalPrice, isCartOpen, setCartOpen } = useCart();
  const { user, profile } = useAuth();
  const [step, setStep] = useState<"cart" | "checkout" | "done">("cart");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: profile?.full_name || "",
    phone: profile?.phone || "",
    email: profile?.email || "",
    comment: "",
  });

  const handleSubmit = async () => {
    if (!form.phone.trim()) {
      toast.error("Укажите номер телефона");
      return;
    }
    setIsSubmitting(true);
    try {
      const orderItems = items.map(i => ({
        id: i.id, title: i.title, price: i.price, quantity: i.quantity, sku: i.sku,
      }));

      const { error } = await supabase.from("cart_orders").insert({
        user_id: user?.id || null,
        guest_name: form.name || null,
        guest_phone: form.phone,
        guest_email: form.email || null,
        items: orderItems as any,
        total_amount: totalPrice,
        status: "new",
        admin_notes: form.comment || null,
      });

      if (error) throw error;

      // Notify via telegram
      try {
        await supabase.functions.invoke("notify-telegram", {
          body: {
            action: "new_order",
            name: form.name,
            phone: form.phone,
            email: form.email,
            total: totalPrice,
            itemsCount: totalItems,
            items: orderItems,
            comment: form.comment,
          },
        });
      } catch {
        // Order creation must not fail when the optional notification is disabled.
      }

      clearCart();
      setStep("done");
      toast.success("Заявка отправлена!");
    } catch (err) {
      console.error(err);
      toast.error("Ошибка при отправке заявки");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setCartOpen(false);
    setTimeout(() => setStep("cart"), 300);
  };

  return (
    <Sheet open={isCartOpen} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            {step === "done" ? "Заявка отправлена" : step === "checkout" ? "Оформление заявки" : `Корзина (${totalItems})`}
          </SheetTitle>
        </SheetHeader>

        {step === "done" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <CheckCircle className="h-16 w-16 text-green-500" />
            <h3 className="text-xl font-bold">Заявка принята!</h3>
            <p className="text-muted-foreground text-sm">
              Наш менеджер свяжется с вами в ближайшее время для подтверждения заказа.
            </p>
            <Button onClick={handleClose} className="mt-4">Закрыть</Button>
          </div>
        ) : step === "checkout" ? (
          <div className="flex-1 flex flex-col">
            <ScrollArea className="flex-1 px-5">
              <div className="space-y-4 pb-4">
                <div>
                  <Label htmlFor="name" className="text-sm">Ваше имя</Label>
                  <Input id="name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Иван Иванов" />
                </div>
                <div>
                  <Label htmlFor="phone" className="text-sm">Телефон *</Label>
                  <Input id="phone" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+7 (___) ___-__-__" required />
                </div>
                <div>
                  <Label htmlFor="email" className="text-sm">Email</Label>
                  <Input id="email" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="mail@example.com" />
                </div>
                <div>
                  <Label htmlFor="comment" className="text-sm">Комментарий</Label>
                  <Input id="comment" value={form.comment} onChange={e => setForm(p => ({ ...p, comment: e.target.value }))} placeholder="Уточнения по заказу..." />
                </div>

                <Separator />

                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-xs text-muted-foreground mb-2">Итого по заявке:</p>
                  <div className="space-y-1">
                    {items.map(item => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="truncate flex-1 mr-2">{item.title} × {item.quantity}</span>
                        <span className="font-medium shrink-0">{(item.price * item.quantity).toLocaleString()} ₽</span>
                      </div>
                    ))}
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-bold">
                    <span>Итого:</span>
                    <span className="text-primary">{totalPrice.toLocaleString()} ₽</span>
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="p-5 border-t border-border space-y-2">
              <Button onClick={handleSubmit} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Отправить заявку
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStep("cart")}>
                Назад к корзине
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                <ShoppingCart className="h-12 w-12 text-muted-foreground/30" />
                <p className="text-muted-foreground">Корзина пуста</p>
                <Button variant="outline" onClick={handleClose}>Перейти в каталог</Button>
              </div>
            ) : (
              <>
                <ScrollArea className="flex-1 px-5">
                  <div className="space-y-3 pb-4">
                    {items.map(item => (
                      <div key={item.id} className="flex gap-3 p-3 rounded-xl bg-secondary/40">
                        {item.image && (
                          <img src={item.image} alt={item.title} className="w-16 h-16 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm line-clamp-2">{item.title}</p>
                          <p className="text-primary font-bold text-sm mt-1">{item.price.toLocaleString()} ₽</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity - 1)}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity + 1)}>
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto text-destructive" onClick={() => removeItem(item.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="p-5 border-t border-border">
                  <div className="flex justify-between mb-3">
                    <span className="text-muted-foreground">Итого:</span>
                    <span className="text-lg font-bold text-primary">{totalPrice.toLocaleString()} ₽</span>
                  </div>
                  <Button className="w-full" onClick={() => setStep("checkout")}>
                    Оформить заявку
                  </Button>
                  <p className="text-[10px] text-center text-muted-foreground mt-2">
                    Менеджер перезвонит для подтверждения заказа
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
