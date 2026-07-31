import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Users, Wrench, ShieldCheck, Truck, Home } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import logo from "@/assets/logo.svg";

const values = [
  {
    icon: ShieldCheck,
    title: "Качество",
    description: "Работаем только с проверенными поставщиками оригинальных запчастей и качественных аналогов.",
  },
  {
    icon: Users,
    title: "Клиентоориентированность",
    description: "Каждый клиент для нас важен. Консультируем и помогаем подобрать нужные детали.",
  },
  {
    icon: Truck,
    title: "Оперативность",
    description: "Если нужной детали нет — привезём очень быстро в магазин. Не заставляем ждать.",
  },
  {
    icon: Wrench,
    title: "Профессионализм",
    description: "Наши специалисты разбираются в автозапчастях и всегда готовы помочь советом.",
  },
];

const About = () => {
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
                <BreadcrumbPage className="text-white">О компании</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <img src={logo} alt="АН-30" className="h-16 w-auto brightness-0 invert opacity-20 mb-4" />
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-3">
            О магазине АН-30
          </h1>
          <p className="text-white/70 text-base sm:text-lg max-w-2xl">
            Надёжный поставщик автозапчастей в Чернышевске с многолетним опытом работы
          </p>
        </div>
      </section>

      {/* Main content */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">
            <ScrollReveal>
              <div className="space-y-5">
                <h2 className="font-display text-2xl sm:text-3xl font-bold">Наша история</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Магазин автозапчастей «АН-30» работает в Чернышевске уже более 10 лет. 
                  За это время мы заслужили доверие тысяч автовладельцев, став надёжным 
                  партнёром для всех, кому нужны качественные запчасти по доступным ценам.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Мы специализируемся на запчастях для легковых и грузовых автомобилей 
                  отечественного и зарубежного производства. Наш каталог насчитывает 
                  более 10 000 позиций — от расходных материалов до сложных узлов и агрегатов.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Главный принцип нашей работы — честность и открытость. Мы не продаём 
                  подделки под видом оригинала и всегда честно консультируем клиентов 
                  о качестве и характеристиках товаров.
                </p>

                <div className="grid grid-cols-3 gap-3 pt-4">
                  {[
                    { value: "10+", label: "Лет на рынке" },
                    { value: "5000+", label: "Клиентов" },
                    { value: "10000+", label: "Товаров" },
                  ].map((stat, i) => (
                    <div key={i} className="text-center p-4 rounded-2xl backdrop-blur-md bg-card/70 border border-border/40">
                      <p className="font-display text-2xl sm:text-3xl font-bold text-primary">{stat.value}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal>
              <div className="space-y-4">
                <h2 className="font-display text-2xl sm:text-3xl font-bold mb-5">Наши ценности</h2>
                {values.map((value, index) => {
                  const Icon = value.icon;
                  return (
                    <div key={index} className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30">
                      <div className="flex gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold mb-1">{value.title}</h3>
                          <p className="text-sm text-muted-foreground">{value.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 sm:py-16">
        <div className="container">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-8 sm:p-12 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(var(--primary))]/90 to-[hsl(var(--accent))]" />
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
              <div className="relative z-10">
                <h2 className="font-display text-2xl sm:text-3xl font-bold mb-3 text-white">
                  Не нашли нужную деталь?
                </h2>
                <p className="text-white/70 mb-6 max-w-xl mx-auto">
                  Если нужной запчасти нет в наличии — мы привезём её очень быстро в магазин! 
                  Свяжитесь с нами, и мы поможем найти нужную деталь.
                </p>
                <a 
                  href="tel:+79244742605" 
                  className="inline-flex items-center gap-2 px-7 py-3 bg-white text-primary rounded-xl font-semibold hover:bg-white/90 transition-all shadow-lg hover:-translate-y-0.5"
                >
                  Позвонить: +7 (924) 474-26-05
                </a>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </MainLayout>
  );
};

export default About;
