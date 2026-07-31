import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { MessageCircle, Phone, MapPin, Package, CheckCircle, Home } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";

const orderSteps = [
  {
    step: 1,
    title: "Выберите товар",
    description: "Найдите нужную запчасть в каталоге. Используйте поиск или фильтры по категориям. Если не можете найти — напишите нам, и мы поможем подобрать нужную деталь.",
  },
  {
    step: 2,
    title: "Свяжитесь с нами",
    description: "Для оформления заказа свяжитесь с нами удобным способом:",
    contacts: true,
  },
  {
    step: 3,
    title: "Подтвердите заказ",
    description: "Мы уточним наличие товара, согласуем стоимость и сроки доставки. Вы получите подтверждение заказа.",
  },
  {
    step: 4,
    title: "Получите товар",
    description: "Заберите заказ в нашем магазине по адресу: Чернышевск, ул. Куйбышева, 118А. Оплата при получении.",
  },
];

const HowToOrder = () => {
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
                <BreadcrumbPage className="text-white">Как сделать заказ</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-3">
            Как сделать заказ
          </h1>
          <p className="text-white/70 text-base sm:text-lg max-w-2xl">
            Простая инструкция по оформлению заказа в нашем магазине
          </p>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container max-w-4xl">
          <div className="space-y-5 mb-10">
            {orderSteps.map((item, index) => (
              <ScrollReveal key={item.step} delay={index * 100}>
                <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-6 sm:p-8 transition-all duration-300 hover:shadow-lg hover:border-primary/20">
                  <div className="flex items-start gap-5">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 font-display text-xl sm:text-2xl font-bold">
                      {item.step}
                    </div>
                    <div className="flex-1">
                      <h2 className="font-display text-lg sm:text-xl font-bold mb-2">{item.title}</h2>
                      <p className="text-muted-foreground">{item.description}</p>
                      {item.contacts && (
                        <div className="grid sm:grid-cols-3 gap-3 mt-4">
                          <a href="tel:+79244742605" className="flex items-center gap-2 p-3 rounded-xl bg-secondary/60 hover:bg-secondary transition-colors">
                            <Phone className="h-5 w-5 text-primary" />
                            <span className="font-medium text-sm">Позвонить</span>
                          </a>
                          <a href="https://wa.me/79244742605" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl bg-secondary/60 hover:bg-secondary transition-colors">
                            <MessageCircle className="h-5 w-5 text-[hsl(var(--success))]" />
                            <span className="font-medium text-sm">WhatsApp</span>
                          </a>
                          <a href="https://t.me/an30_autoparts" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl bg-secondary/60 hover:bg-secondary transition-colors">
                            <MessageCircle className="h-5 w-5 text-primary" />
                            <span className="font-medium text-sm">Telegram</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>

          {/* Benefits */}
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-8 sm:p-10">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/10 to-accent/5" />
              <div className="relative z-10">
                <h2 className="font-display text-xl sm:text-2xl font-bold mb-6 text-center">
                  Почему выбирают нас
                </h2>
                <div className="grid sm:grid-cols-3 gap-5">
                  {[
                    { icon: Package, title: "Быстрая доставка", desc: "Если нет в наличии — привезём очень быстро" },
                    { icon: CheckCircle, title: "Качественные запчасти", desc: "Работаем только с проверенными поставщиками" },
                    { icon: MapPin, title: "Удобное расположение", desc: "Магазин в центре Чернышевска" },
                  ].map((benefit, i) => {
                    const Icon = benefit.icon;
                    return (
                      <div key={i} className="text-center">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                          <Icon className="h-7 w-7 text-primary" />
                        </div>
                        <h3 className="font-semibold mb-1">{benefit.title}</h3>
                        <p className="text-sm text-muted-foreground">{benefit.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </MainLayout>
  );
};

export default HowToOrder;
