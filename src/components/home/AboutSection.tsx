import { CheckCircle2, Users, Package, Award, Wrench, TrendingUp, Shield } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import logo from "@/assets/logo.svg";

const stats = [
  { icon: Users, value: "5000+", label: "Клиентов обслужено" },
  { icon: Package, value: "10000+", label: "Позиций в каталоге" },
  { icon: Award, value: "10 лет", label: "Опыт работы" },
];

const features = [
  { icon: Shield, text: "Оригинальные запчасти и качественные аналоги" },
  { icon: Wrench, text: "Профессиональная консультация специалистов" },
  { icon: TrendingUp, text: "Гибкая система ценообразования" },
  { icon: CheckCircle2, text: "Удобное расположение магазина" },
  { icon: Package, text: "Быстрый заказ отсутствующих позиций" },
  { icon: Award, text: "Гарантия на всю продукцию" },
];

export function AboutSection() {
  return (
    <section className="py-12 sm:py-16 lg:py-20 section-dark text-primary-foreground overflow-hidden relative">
      {/* Decorative logo watermark */}
      <div className="absolute top-10 right-10 opacity-[0.04] hidden lg:block">
        <img src={logo} alt="" className="h-40 w-auto brightness-0 invert" />
      </div>
      
      <div className="container px-4 sm:px-6 relative z-10">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Content */}
          <ScrollReveal direction="left">
            <div>
              <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 backdrop-blur-md bg-primary-foreground/10 border border-primary-foreground/10 rounded-xl text-xs sm:text-sm font-medium mb-4 sm:mb-6">
                <Award className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                О компании
              </div>
              
              <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mb-4 sm:mb-6 leading-tight">
                АН-30 — надёжный поставщик автозапчастей с 2014 года
              </h2>
              
              <p className="text-primary-foreground/85 mb-4 sm:mb-6 text-base sm:text-lg leading-relaxed">
                Магазин автозапчастей в Чернышевске с широким ассортиментом деталей для легковых 
                и грузовых автомобилей. Работаем напрямую с проверенными поставщиками, 
                что позволяет предлагать качественные запчасти по выгодным ценам.
              </p>
              
              <p className="text-primary-foreground/75 mb-6 sm:mb-10 border-l-2 border-accent pl-3 sm:pl-4 text-sm sm:text-base">
                Если нужной детали нет в наличии — привезём в кратчайшие сроки!
              </p>

              <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                {features.map((feature, index) => {
                  const Icon = feature.icon;
                  return (
                    <ScrollReveal key={index} delay={index * 50}>
                      <div className="flex items-center gap-2 sm:gap-3 backdrop-blur-md bg-primary-foreground/5 border border-primary-foreground/10 rounded-xl p-2.5 sm:p-3">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                          <Icon className="h-3.5 sm:h-4 w-3.5 sm:w-4 text-accent" />
                        </div>
                        <span className="text-xs sm:text-sm text-primary-foreground/90">{feature.text}</span>
                      </div>
                    </ScrollReveal>
                  );
                })}
              </div>
            </div>
          </ScrollReveal>

          {/* Stats */}
          <div className="grid grid-cols-1 gap-4 sm:gap-6">
            {stats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <ScrollReveal key={index} delay={index * 150} direction="right">
                  <div className="flex items-center gap-4 sm:gap-6 p-4 sm:p-6 backdrop-blur-md bg-primary-foreground/10 rounded-2xl border border-primary-foreground/10 hover:bg-primary-foreground/15 transition-all duration-300">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-accent/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                      <Icon className="h-6 sm:h-8 w-6 sm:w-8 text-accent" />
                    </div>
                    <div>
                      <p className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mb-0.5 sm:mb-1">
                        {stat.value}
                      </p>
                      <p className="text-primary-foreground/70 text-sm sm:text-base">
                        {stat.label}
                      </p>
                    </div>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
