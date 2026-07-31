import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { RotateCcw, Package, CheckCircle, XCircle, Home } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";

const Returns = () => {
  const sections = [
    {
      icon: Package,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      title: "Возврат товаров, приобретённых дистанционным способом",
      content: (
        <p className="text-muted-foreground">
          В случае приобретения товаров дистанционным способом, Покупатель вправе отказаться от товара в любое время до его передачи, а после передачи товара — в течение 7 дней.
        </p>
      ),
    },
    {
      icon: CheckCircle,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      title: "Условия возврата товара надлежащего качества",
      content: (
        <>
          <p className="text-muted-foreground mb-4">Возврат товара надлежащего качества возможен в случае, если:</p>
          <ul className="space-y-2 text-muted-foreground mb-6">
            {["сохранён его товарный вид;", "сохранены потребительские свойства;", "имеется документ, подтверждающий факт и условия покупки указанного товара."].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mb-4">Под товарным видом понимается:</p>
          <ul className="space-y-2 text-muted-foreground">
            {[
              "отсутствие следов установки и/или эксплуатации товара;",
              "отсутствие повреждений упаковки;",
              "сохранность всех пломб и стикеров;",
              "отсутствие каких-либо механических повреждений.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      icon: XCircle,
      iconBg: "bg-destructive/10",
      iconColor: "text-destructive",
      title: "Товары, не подлежащие возврату и обмену",
      content: (
        <>
          <p className="text-muted-foreground mb-4">Не подлежит возврату и обмену товар надлежащего качества:</p>
          <ul className="space-y-2 text-muted-foreground">
            {[
              "автомобили и мототехника, прицепы к ним, номерные агрегаты;",
              "товары, изготовленные по индивидуальному заказу;",
              "технически сложные товары бытового назначения, на которые установлены гарантийные сроки.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive mt-2 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      icon: RotateCcw,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      title: "Как оформить возврат",
      content: (
        <>
          <p className="text-muted-foreground mb-4">Для оформления возврата товара свяжитесь с нами:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
              <span>Позвоните по номеру <a href="tel:+79244742605" className="text-primary hover:underline">+7 (924) 474-26-05</a></span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
              <span>Напишите в Telegram: <a href="https://t.me/an30_autoparts" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@an30_autoparts</a></span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
              <span>Приезжайте в магазин: Чернышевск, ул. Куйбышева, 118А</span>
            </li>
          </ul>
        </>
      ),
    },
  ];

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
                <BreadcrumbPage className="text-white">Возврат товара</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-3">
            Возврат товара
          </h1>
          <p className="text-white/70 text-base sm:text-lg max-w-2xl">
            Информация о возврате и обмене товаров
          </p>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container max-w-4xl space-y-5">
          {sections.map((section, index) => {
            const Icon = section.icon;
            return (
              <ScrollReveal key={index} delay={index * 80}>
                <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-6 sm:p-8 transition-all duration-300 hover:shadow-lg hover:border-primary/20">
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`w-12 h-12 rounded-xl ${section.iconBg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`h-6 w-6 ${section.iconColor}`} />
                    </div>
                    <h2 className="font-display text-xl sm:text-2xl font-bold pt-1">{section.title}</h2>
                  </div>
                  {section.content}
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </section>
    </MainLayout>
  );
};

export default Returns;
