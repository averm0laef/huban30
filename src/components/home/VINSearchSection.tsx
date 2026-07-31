import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Car, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export function VINSearchSection() {
  const [vin, setVin] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      toast({ title: "Укажите телефон", description: "Мы свяжемся с вами для подбора", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await supabase.from("contact_requests").insert({
        phone: phone.trim(),
        message: `Подбор по VIN: ${vin.trim() || "не указан"}\n${description.trim() ? `Описание: ${description.trim()}` : ""}`,
        name: null,
      });
      setSubmitted(true);
      toast({ title: "Заявка отправлена!", description: "Мы подберём запчасти и свяжемся с вами" });
    } catch {
      toast({ title: "Ошибка", description: "Попробуйте ещё раз", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <section className="mx-3 sm:mx-4 lg:mx-6">
        <div className="rounded-2xl sm:rounded-3xl bg-card border border-border p-6 sm:p-8 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="font-display text-xl font-bold text-foreground mb-2">Заявка принята!</h3>
          <p className="text-muted-foreground text-sm">Наш специалист подберёт запчасти и свяжется с вами в ближайшее время.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-3 sm:mx-4 lg:mx-6">
      <div className="rounded-2xl sm:rounded-3xl bg-card border border-border overflow-hidden">
        <div className="grid lg:grid-cols-2 gap-0">
          {/* Left - info */}
          <div className="p-6 sm:p-8 bg-gradient-to-br from-primary/5 to-accent/5">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Car className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground mb-3">
              Подбор по <span className="text-primary">VIN-номеру</span>
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-4">
              Не можете найти нужную запчасть? Отправьте VIN-номер вашего автомобиля — 
              и мы бесплатно подберём все необходимые детали с гарантией совместимости.
            </p>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                <span>100% совместимость с вашим авто</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                <span>Подбор за 15 минут</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                <span>Бесплатная консультация</span>
              </div>
            </div>
          </div>

          {/* Right - form */}
          <div className="p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">VIN-номер</label>
                <Input
                  placeholder="Например: JTDKN3DU5A0..."
                  value={vin}
                  onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))}
                  className="h-11 rounded-xl"
                  maxLength={17}
                />
                <p className="text-xs text-muted-foreground mt-1">Можно найти в свидетельстве о регистрации</p>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Что ищете?</label>
                <Input
                  placeholder="Например: колодки передние, фильтр масляный"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Ваш телефон *</label>
                <Input
                  type="tel"
                  placeholder="+7 (999) 123-45-67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 rounded-xl"
                  required
                />
              </div>

              <Button type="submit" disabled={loading} className="w-full h-12 rounded-xl text-sm font-bold bg-primary hover:bg-primary/90">
                <Search className="mr-2 h-4 w-4" />
                {loading ? "Отправляем..." : "Подобрать запчасти"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
