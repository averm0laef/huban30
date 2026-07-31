import { ScrollReveal } from "@/components/ui/ScrollReveal";
import logo from "@/assets/logo.svg";

import whyQuality from "@/assets/why-quality.jpg";
import whyVin from "@/assets/why-vin.jpg";
import whyDelivery from "@/assets/why-delivery.jpg";
import whyPrice from "@/assets/why-price.jpg";
import whySchedule from "@/assets/why-schedule.jpg";
import whyReturn from "@/assets/why-return.jpg";

const advantages = [
  {
    image: whyQuality,
    title: "Только проверенные бренды",
    description: "Работаем с надёжными поставщиками — каждая деталь с гарантией качества",
  },
  {
    image: whyVin,
    title: "Подбор по VIN-номеру",
    description: "Точно подберём запчасти, совместимые именно с вашим автомобилем",
  },
  {
    image: whyDelivery,
    title: "Привезём в магазин",
    description: "Если детали нет в наличии — доставим в кратчайшие сроки",
  },
  {
    image: whyPrice,
    title: "Выгодные цены",
    description: "Прямые поставки без посредников — экономия до 30% от рыночной цены",
  },
  {
    image: whySchedule,
    title: "Работаем ежедневно",
    description: "Без выходных с 9:00 до 19:00 — приходите в удобное время",
  },
  {
    image: whyReturn,
    title: "Возврат и обмен",
    description: "Гарантия возврата в течение 14 дней, если деталь не подошла",
  },
];

export function WhyUsSection() {
  return (
    <section className="py-10 sm:py-14 relative overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
      
      <div className="container px-4 sm:px-6 relative z-10">
        <ScrollReveal>
          <div className="text-center mb-8 sm:mb-10">
            <img src={logo} alt="АН-30" className="h-10 w-auto mx-auto mb-3 opacity-15" />
            <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold text-foreground mb-2">
              Почему выбирают АН-30
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
              Больше 10 лет помогаем автовладельцам Чернышевска и района
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {advantages.map((item, index) => (
            <ScrollReveal key={index} delay={index * 80}>
              <div className="group relative rounded-2xl overflow-hidden h-56 sm:h-64 cursor-default">
                {/* Background image */}
                <img 
                  src={item.image} 
                  alt={item.title}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                {/* Dark overlay for readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-foreground/90 via-foreground/50 to-foreground/20 group-hover:from-foreground/95 group-hover:via-foreground/60 transition-all duration-300" />
                
                {/* Glass content at bottom */}
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                  <div className="backdrop-blur-lg bg-background/10 rounded-xl p-4 border border-background/20 shadow-lg">
                    <h3 className="font-semibold text-background text-sm sm:text-base mb-1">
                      {item.title}
                    </h3>
                    <p className="text-background/80 text-xs sm:text-sm leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
