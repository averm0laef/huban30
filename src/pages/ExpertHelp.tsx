import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { HelpCircle, MessageCircle, Phone, Wrench, Search, Package, Send, Home } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";

const services = [
  { icon: Search, title: "Подбор по VIN", description: "Отправьте нам VIN-номер вашего автомобиля, и мы подберём точно подходящие запчасти" },
  { icon: Wrench, title: "Консультация по ремонту", description: "Расскажем, какие детали нужны для ремонта и посоветуем качественные аналоги" },
  { icon: Package, title: "Поиск редких деталей", description: "Найдём детали для старых и редких автомобилей через сеть поставщиков" },
  { icon: HelpCircle, title: "Помощь с выбором", description: "Объясним разницу между оригиналом и аналогами, поможем выбрать оптимальный вариант" },
];

const ExpertHelp = () => {
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
                <BreadcrumbPage className="text-white">Помощь эксперта</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-3">
            Помощь эксперта
          </h1>
          <p className="text-white/70 text-base sm:text-lg max-w-2xl">
            Поможем подобрать нужную запчасть для вашего автомобиля
          </p>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container max-w-4xl">
          <ScrollReveal>
            <div className="text-center mb-10">
              <h2 className="font-display text-2xl sm:text-3xl font-bold mb-3">Чем мы можем помочь?</h2>
              <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
                Наши специалисты помогут вам подобрать запчасти, даже если вы не знаете точное название детали
              </p>
            </div>
          </ScrollReveal>

          <div className="grid sm:grid-cols-2 gap-4 sm:gap-5 mb-10">
            {services.map((service, index) => {
              const Icon = service.icon;
              return (
                <ScrollReveal key={index} delay={index * 100}>
                  <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-6 h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="h-7 w-7 text-primary" />
                    </div>
                    <h3 className="font-display text-lg font-bold mb-2">{service.title}</h3>
                    <p className="text-muted-foreground text-sm">{service.description}</p>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>

          {/* Contact CTA */}
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-8 sm:p-10">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/10 to-accent/5" />
              <div className="relative z-10">
                <h2 className="font-display text-xl sm:text-2xl font-bold mb-6 text-center">
                  Свяжитесь с экспертом
                </h2>
                <div className="grid sm:grid-cols-3 gap-3 sm:gap-4">
                  <a href="tel:+79244742605" className="block">
                    <Button variant="outline" size="lg" className="w-full h-auto py-4 flex-col gap-2 rounded-xl backdrop-blur-md bg-card/70 border-border/40 hover:border-primary/30 hover:-translate-y-0.5 transition-all">
                      <Phone className="h-6 w-6 text-primary" />
                      <span className="font-semibold">Позвонить</span>
                      <span className="text-xs text-muted-foreground">+7 (924) 474-26-05</span>
                    </Button>
                  </a>
                  <a href="https://wa.me/79244742605" target="_blank" rel="noopener noreferrer" className="block">
                    <Button variant="outline" size="lg" className="w-full h-auto py-4 flex-col gap-2 rounded-xl backdrop-blur-md bg-card/70 border-border/40 hover:border-primary/30 hover:-translate-y-0.5 transition-all">
                      <MessageCircle className="h-6 w-6 text-[hsl(var(--success))]" />
                      <span className="font-semibold">WhatsApp</span>
                      <span className="text-xs text-muted-foreground">Напишите нам</span>
                    </Button>
                  </a>
                  <a href="https://t.me/an30_autoparts" target="_blank" rel="noopener noreferrer" className="block">
                    <Button variant="outline" size="lg" className="w-full h-auto py-4 flex-col gap-2 rounded-xl backdrop-blur-md bg-card/70 border-border/40 hover:border-primary/30 hover:-translate-y-0.5 transition-all">
                      <Send className="h-6 w-6 text-primary" />
                      <span className="font-semibold">Telegram</span>
                      <span className="text-xs text-muted-foreground">@an30_autoparts</span>
                    </Button>
                  </a>
                </div>
                <p className="text-center text-muted-foreground text-sm mt-6">
                  Работаем ежедневно с 9:00 до 19:00
                </p>
              </div>
            </div>
          </ScrollReveal>

          {/* Preparation */}
          <ScrollReveal>
            <div className="backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-8 mt-8">
              <h2 className="font-display text-xl font-bold mb-4">
                Что подготовить перед обращением
              </h2>
              <ul className="space-y-3 text-muted-foreground">
                {[
                  "VIN-номер автомобиля (17 символов, можно найти в ПТС или на кузове)",
                  "Марка, модель и год выпуска автомобиля",
                  "Описание проблемы или название нужной детали (если знаете)",
                  "Фото детали или места поломки (по возможности)",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </MainLayout>
  );
};

export default ExpertHelp;
