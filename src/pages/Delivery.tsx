import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Truck, Clock, Package, CheckCircle, AlertCircle, Home } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import logo from "@/assets/logo.svg";

const steps = [
  { step: 1, title: "Оформите заказ", description: "Позвоните нам или напишите в чат. Укажите нужную деталь, марку и модель автомобиля." },
  { step: 2, title: "Подтверждение", description: "Мы проверим наличие, уточним цену и сроки доставки в магазин." },
  { step: 3, title: "Ожидание", description: "Деталь будет доставлена в наш магазин в кратчайшие сроки." },
  { step: 4, title: "Получение", description: "Заберите заказ в магазине по адресу: ул. Куйбышева, 118А." },
];

const Delivery = () => {
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
                <BreadcrumbPage className="text-white">Доставка</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center gap-3 mb-4">
            <Truck className="h-8 w-8 sm:h-10 sm:w-10 text-white/80" />
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white">
              Доставка в магазин
            </h1>
          </div>
          <p className="text-white/70 text-base sm:text-lg max-w-2xl">
            Если нужной детали нет в наличии — мы оперативно привезём её в магазин для вас
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container">
          <ScrollReveal>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mb-10">
              Как это работает
            </h2>
          </ScrollReveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {steps.map((item, index) => (
              <ScrollReveal key={item.step} delay={index * 100}>
                <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-6 text-center h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30">
                  <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground font-display font-bold text-xl flex items-center justify-center mx-auto mb-4">
                    {item.step}
                  </div>
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Info cards */}
      <section className="py-12 sm:py-16 bg-secondary/30">
        <div className="container">
          <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
            {[
              {
                icon: Clock,
                title: "Сроки доставки",
                text: "Сроки зависят от наличия детали у поставщиков. Обычно доставка занимает от 1 до 7 рабочих дней.",
                items: ["Популярные детали — 1-2 дня", "Редкие запчасти — до 7 дней"],
              },
              {
                icon: Package,
                title: "Оплата",
                text: "Оплата производится при получении товара в магазине.",
                items: ["Наличными", "Банковской картой", "Переводом"],
              },
              {
                icon: AlertCircle,
                title: "Важно знать",
                text: "Для точного подбора детали сообщите нам:",
                items: ["Марку и модель авто", "Год выпуска", "VIN-код (желательно)"],
              },
            ].map((card, index) => {
              const Icon = card.icon;
              return (
                <ScrollReveal key={index} delay={index * 100}>
                  <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-6 h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">{card.title}</h3>
                    <p className="text-muted-foreground text-sm mb-4">{card.text}</p>
                    <ul className="space-y-2 text-sm">
                      {card.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-[hsl(var(--success))] shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 sm:py-16">
        <div className="container">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-8 sm:p-12 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(var(--primary))]/90 to-[hsl(var(--accent))]" />
              <div className="relative z-10">
                <h2 className="font-display text-2xl sm:text-3xl font-bold mb-3 text-white">
                  Нужна деталь, которой нет в наличии?
                </h2>
                <p className="text-white/70 mb-6 max-w-xl mx-auto">
                  Свяжитесь с нами — мы быстро найдём и привезём нужную запчасть!
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <a href="tel:+79244742605" className="inline-flex items-center gap-2 px-7 py-3 bg-white text-primary rounded-xl font-semibold hover:bg-white/90 transition-all shadow-lg hover:-translate-y-0.5">
                    +7 (924) 474-26-05
                  </a>
                  <a href="https://t.me/an30_autoparts" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-7 py-3 bg-white/15 backdrop-blur-sm text-white border border-white/20 rounded-xl font-semibold hover:bg-white/25 transition-all hover:-translate-y-0.5">
                    Написать в Telegram
                  </a>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </MainLayout>
  );
};

export default Delivery;
