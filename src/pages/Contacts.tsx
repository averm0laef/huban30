import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MainLayout } from "@/components/layout/MainLayout";
import { Phone, MapPin, Clock, Send, Mail, MessageSquare, Building2, CheckCircle2, Loader2, Home } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PhoneInput } from "@/components/ui/phone-input";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { useStoreStatus } from "@/hooks/useStoreStatus";
import { useChat } from "@/contexts/ChatContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const contactSchema = z.object({
  name: z.string().min(2, "Имя минимум 2 символа").max(100, "Имя слишком длинное"),
  phone: z.string().min(16, "Введите полный номер телефона"),
  email: z.string().email("Введите корректный email").max(255).optional().or(z.literal("")),
  message: z.string().min(5, "Сообщение минимум 5 символов").max(1000, "Сообщение слишком длинное"),
});

type ContactFormData = z.infer<typeof contactSchema>;

const Contacts = () => {
  const { isOpen, statusText } = useStoreStatus();
  const { openChat } = useChat();
  const { toast } = useToast();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", phone: "", email: "", message: "" },
  });

  const handleSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from("contact_requests")
        .insert({
          name: data.name.trim(),
          phone: data.phone,
          email: data.email?.trim() || null,
          message: data.message.trim(),
        });

      if (error) throw error;

      try {
        await supabase.functions.invoke("notify-telegram", {
          body: {
            action: "new_contact_request",
            name: data.name.trim(),
            phone: data.phone,
            email: data.email?.trim() || null,
            contactMessage: data.message.trim(),
          },
        });
      } catch (tgErr) {
        console.error("Telegram notification error:", tgErr);
      }

      setIsSubmitted(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Ошибка отправки",
        description: "Попробуйте позже или свяжитесь по телефону",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MainLayout>
      {/* Hero */}
      <section className="relative overflow-hidden py-16 sm:py-20">
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(var(--primary))]/90 to-[hsl(var(--accent))]" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="container relative z-10">
          <Breadcrumb className="mb-6">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/" className="text-white/60 hover:text-white"><Home className="h-4 w-4" /></Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="text-white/40" />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-white">Контакты</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium text-white/90 mb-5">
            <Building2 className="h-4 w-4" />
            Контактная информация
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-3">
            Свяжитесь с нами
          </h1>
          <p className="text-white/70 text-base sm:text-lg max-w-2xl">
            Выберите удобный способ связи или приезжайте в магазин лично
          </p>
        </div>
      </section>

      {/* Contact info */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            {/* Info */}
            <div className="space-y-6">
              <ScrollReveal>
                <div>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold mb-2">Контакты магазина</h2>
                  <p className="text-muted-foreground">Мы всегда рады ответить на ваши вопросы</p>
                </div>
              </ScrollReveal>

              <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                {[
                  { icon: Phone, title: "Телефон", content: <a href="tel:+79244742605" className="text-primary hover:underline font-medium text-lg">+7 (924) 474-26-05</a> },
                  { icon: Send, title: "Telegram", content: <a href="https://t.me/an30_autoparts" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">@an30_autoparts</a> },
                  { icon: MapPin, title: "Адрес магазина", content: <p className="text-muted-foreground">Чернышевск,<br />ул. Куйбышева, 118А</p> },
                  {
                    icon: Clock, title: "Режим работы", content: (
                      <>
                        <p className="text-muted-foreground mb-1">Ежедневно: 09:00 — 19:00</p>
                        <p className={`text-sm font-medium ${isOpen ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`}>{statusText}</p>
                      </>
                    )
                  },
                ].map((card, index) => {
                  const Icon = card.icon;
                  return (
                    <ScrollReveal key={index} delay={index * 80}>
                      <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-5 sm:p-6 h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <h3 className="font-semibold mb-2">{card.title}</h3>
                        {card.content}
                      </div>
                    </ScrollReveal>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                <ScrollReveal delay={320}>
                  <Card 
                    className="bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 transition-all border-primary rounded-2xl hover:-translate-y-1 hover:shadow-lg" 
                    onClick={openChat}
                  >
                    <CardContent className="p-5 sm:p-6">
                      <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center mb-3">
                        <MessageSquare className="h-6 w-6 text-primary-foreground" />
                      </div>
                      <h3 className="font-semibold mb-1">Онлайн-консультация</h3>
                      <p className="text-sm text-primary-foreground/70">Задайте вопрос специалисту</p>
                    </CardContent>
                  </Card>
                </ScrollReveal>

                <ScrollReveal delay={400}>
                  <Link to="/map">
                    <Card className="bg-accent text-accent-foreground hover:bg-accent/90 transition-all border-accent rounded-2xl h-full hover:-translate-y-1 hover:shadow-lg">
                      <CardContent className="p-5 sm:p-6">
                        <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center mb-3">
                          <MapPin className="h-6 w-6 text-accent-foreground" />
                        </div>
                        <h3 className="font-semibold mb-1">Как добраться</h3>
                        <p className="text-sm text-accent-foreground/70">Открыть карту проезда</p>
                      </CardContent>
                    </Card>
                  </Link>
                </ScrollReveal>
              </div>
            </div>

            {/* Contact form */}
            <ScrollReveal>
              <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-6 sm:p-8">
                {isSubmitted ? (
                  <div className="text-center py-8">
                    <div className="w-20 h-20 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="h-10 w-10 text-primary" />
                    </div>
                    <h2 className="font-display text-2xl font-bold mb-3 text-foreground">Заявка принята!</h2>
                    <p className="text-muted-foreground text-lg mb-6">Менеджер свяжется с вами в течение рабочего дня</p>
                    <Button variant="outline" className="rounded-xl" onClick={() => { setIsSubmitted(false); form.reset(); }}>
                      Отправить ещё одну заявку
                    </Button>
                  </div>
                ) : (
                  <>
                    <h2 className="font-display text-2xl font-bold mb-2">Оставить заявку</h2>
                    <p className="text-muted-foreground mb-6">Опишите какая запчасть вам нужна — мы свяжемся с вами в ближайшее время</p>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                        <FormField control={form.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Ваше имя <span className="text-destructive">*</span></FormLabel>
                            <FormControl><Input placeholder="Иван Иванов" className="h-12 rounded-xl" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="phone" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Телефон <span className="text-destructive">*</span></FormLabel>
                            <FormControl><PhoneInput value={field.value} onChange={field.onChange} className="h-12" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="email" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email <span className="text-muted-foreground text-xs">(опционально)</span></FormLabel>
                            <FormControl><Input type="email" placeholder="mail@example.com" className="h-12 rounded-xl" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="message" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Сообщение <span className="text-destructive">*</span></FormLabel>
                            <FormControl><Textarea placeholder="Опишите, какая запчасть вам нужна, марку и модель автомобиля..." rows={5} className="resize-none rounded-xl" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <Button type="submit" className="w-full h-12 text-base rounded-xl" disabled={isSubmitting}>
                          {isSubmitting ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Mail className="h-5 w-5 mr-2" />}
                          {isSubmitting ? "Отправка..." : "Отправить заявку"}
                        </Button>
                        <p className="text-xs text-muted-foreground text-center">
                          Нажимая кнопку, вы соглашаетесь с обработкой персональных данных
                        </p>
                      </form>
                    </Form>
                  </>
                )}
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>
    </MainLayout>
  );
};

export default Contacts;
