import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Truck, Clock, ChevronLeft, ChevronRight, Headphones, Search, Phone, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.svg";

import heroBanner from "@/assets/hero-banner.jpg";
import bannerCatalog from "@/assets/banner-catalog.jpg";
import bannerExpert from "@/assets/banner-expert.jpg";
import bannerDelivery from "@/assets/banner-delivery.jpg";
import bannerQuality from "@/assets/banner-quality.jpg";
import bannerSeason from "@/assets/banner-season.jpg";

interface SlideData {
  image: string;
  headline: string;
  accent: string;
  subtitle: string;
  buttonText: string;
  buttonLink: string;
  secondaryButton?: { text: string; link: string };
}

const builtInSlides: SlideData[] = [
  {
    image: heroBanner,
    headline: "Автозапчасти",
    accent: "в Чернышевске",
    subtitle: "Запчасти для легковых и грузовых автомобилей.\nДоставка в магазин, консультация специалиста.",
    buttonText: "Перейти в каталог",
    buttonLink: "/catalog",
    secondaryButton: { text: "Связаться", link: "/contacts" },
  },
  {
    image: bannerCatalog,
    headline: "Более 10 000 запчастей",
    accent: "в наличии и на заказ",
    subtitle: "Фильтры, колодки, масла, ремни, подшипники — всё для вашего авто. Подберём по VIN-номеру за 5 минут.",
    buttonText: "Открыть каталог",
    buttonLink: "/catalog",
  },
  {
    image: bannerExpert,
    headline: "Не знаете какую запчасть выбрать?",
    accent: "Поможем подобрать!",
    subtitle: "Наши специалисты бесплатно подберут нужную деталь по марке и модели вашего автомобиля.",
    buttonText: "Помощь эксперта",
    buttonLink: "/expert-help",
    secondaryButton: { text: "Позвонить", link: "/contacts" },
  },
  {
    image: bannerDelivery,
    headline: "Доставим запчасти",
    accent: "прямо в магазин",
    subtitle: "Закажите нужную деталь — привезём в кратчайшие сроки. Работаем с проверенными поставщиками по всей России.",
    buttonText: "Условия доставки",
    buttonLink: "/delivery",
  },
  {
    image: bannerQuality,
    headline: "Только проверенное",
    accent: "качество",
    subtitle: "Работаем с оригинальными запчастями и надёжными аналогами. Гарантия на всю продукцию — ваша уверенность за рулём.",
    buttonText: "Смотреть каталог",
    buttonLink: "/catalog",
  },
];

interface Banner {
  id: string;
  headline: string | null;
  subheadline: string | null;
  button_text: string | null;
  link_url: string | null;
  image_desktop_url: string | null;
}

export function HeroSection() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHoveringState, setIsHoveringState] = useState(false);
  const autoPlayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHovering = useRef(false);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => { fetchBanners(); }, []);

  const totalSlides = builtInSlides.length + banners.length;

  useEffect(() => {
    if (totalSlides <= 1) return;
    const startAutoPlay = () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
      autoPlayRef.current = setInterval(() => {
        if (!isHovering.current) {
          setCurrentIndex((prev) => prev >= totalSlides - 1 ? 0 : prev + 1);
        }
      }, 6000);
    };
    startAutoPlay();
    return () => { if (autoPlayRef.current) clearInterval(autoPlayRef.current); };
  }, [totalSlides]);

  const fetchBanners = async () => {
    try {
      const { data } = await supabase
        .from("banners")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      setBanners(data || []);
    } catch (error) {
      console.error("Error fetching banners:", error);
    }
  };

  const goToPrev = useCallback(() => {
    if (totalSlides <= 1) return;
    setCurrentIndex((prev) => prev === 0 ? totalSlides - 1 : prev - 1);
  }, [totalSlides]);

  const goToNext = useCallback(() => {
    if (totalSlides <= 1) return;
    setCurrentIndex((prev) => prev >= totalSlides - 1 ? 0 : prev + 1);
  }, [totalSlides]);

  const features = [
    { icon: ShieldCheck, title: "Гарантия качества", subtitle: "На всю продукцию" },
    { icon: Truck, title: "Доставка", subtitle: "Привезём в магазин" },
    { icon: Clock, title: "Ежедневно", subtitle: "09:00 — 19:00" },
    { icon: Headphones, title: "Помощь эксперта", subtitle: "Подберём запчасти" },
  ];

  return (
    <div className="mx-3 sm:mx-4 lg:mx-6 mt-3 sm:mt-4 space-y-3 sm:space-y-4">
      <section
        className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-xl touch-pan-y"
        onMouseEnter={() => { isHovering.current = true; setIsHoveringState(true); }}
        onMouseLeave={() => { isHovering.current = false; setIsHoveringState(false); }}
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchMove={(e) => { touchEndX.current = e.touches[0].clientX; }}
        onTouchEnd={() => {
          const diff = touchStartX.current - touchEndX.current;
          if (Math.abs(diff) > 50) {
            if (diff > 0) goToNext();
            else goToPrev();
          }
        }}
      >
        {/* Built-in slides */}
        {builtInSlides.map((slide, index) => (
          <div
            key={`built-${index}`}
            className={`transition-opacity duration-700 ${
              currentIndex === index ? "opacity-100" : "opacity-0 absolute inset-0 pointer-events-none"
            }`}
          >
            <div className="relative">
              <img src={slide.image} alt={slide.headline} className="w-full h-[440px] sm:h-[480px] lg:h-[520px] object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-[hsl(var(--primary))]/90 via-[hsl(var(--primary))]/70 to-[hsl(var(--primary))]/95" />
            </div>

            <div className={`absolute inset-0 flex flex-col items-center justify-center text-center px-6 sm:px-14 transition-all duration-700 ${
              currentIndex === index ? "opacity-100 translate-y-0 delay-200" : "opacity-0 translate-y-4"
            }`}>
              <img src={logo} alt="АН-30" className="h-36 sm:h-44 lg:h-52 w-auto brightness-0 invert -mb-2 sm:-mb-3 drop-shadow-lg" />

              <h2 className="font-display text-[1.65rem] sm:text-3xl lg:text-[2.75rem] font-extrabold text-white leading-tight tracking-tight max-w-xl lg:max-w-2xl">
                {slide.headline}{" "}
                <span className="text-yellow-300">{slide.accent}</span>
              </h2>

              <p className="text-sm sm:text-base text-white/60 mt-3 mb-6 sm:mb-7 max-w-sm sm:max-w-md leading-relaxed whitespace-pre-line">
                {slide.subtitle}
              </p>

              <div className="flex flex-wrap justify-center gap-3">
                <Link to={slide.buttonLink}>
                  <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground h-11 sm:h-12 px-7 sm:px-8 text-sm font-bold rounded-xl shadow-lg shadow-accent/25 transition-all hover:shadow-xl hover:shadow-accent/35 hover:-translate-y-0.5">
                    {slide.buttonText}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                {slide.secondaryButton && (
                  <Link to={slide.secondaryButton.link}>
                    <Button size="lg" variant="outline" className="border-white/20 bg-white/10 backdrop-blur-sm text-white hover:bg-white hover:text-foreground h-11 sm:h-12 px-7 sm:px-8 text-sm rounded-xl transition-all hover:-translate-y-0.5">
                      {slide.secondaryButton.text}
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Database banners */}
        {banners.map((banner, index) => (
          <div
            key={banner.id}
            className={`transition-opacity duration-700 ${
              currentIndex === index + builtInSlides.length ? "opacity-100" : "opacity-0 absolute inset-0 pointer-events-none"
            }`}
          >
            <div className="relative">
              {banner.image_desktop_url ? (
                <img src={banner.image_desktop_url} alt={banner.headline || "Баннер"} className="w-full h-[440px] sm:h-[480px] lg:h-[520px] object-cover" />
              ) : (
                <div className="w-full h-[440px] sm:h-[480px] lg:h-[520px] bg-gradient-to-br from-primary via-primary/80 to-accent" />
              )}
              <div className="absolute inset-0 bg-[hsl(var(--primary))]/75" />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 sm:px-8">
              <img src={logo} alt="АН-30" className="h-12 sm:h-16 w-auto brightness-0 invert opacity-30 mb-5" />
              {banner.headline && (
                <h2 className="font-display text-2xl sm:text-3xl lg:text-[2.75rem] font-extrabold text-white leading-tight max-w-2xl">{banner.headline}</h2>
              )}
              {banner.subheadline && (
                <p className="text-sm sm:text-base text-white/60 mt-3 mb-6 max-w-md">{banner.subheadline}</p>
              )}
              {banner.button_text && banner.link_url && (
                <Link to={banner.link_url}>
                  <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground h-11 sm:h-12 px-7 sm:px-8 text-sm font-bold rounded-xl shadow-lg shadow-accent/25">
                    {banner.button_text}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ))}

        {/* Dots */}
        {totalSlides > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md">
            {Array.from({ length: totalSlides }).map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentIndex(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentIndex ? "bg-accent w-7" : "bg-white/30 hover:bg-white/50 w-2"
                }`}
                aria-label={`Слайд ${index + 1}`}
              />
            ))}
          </div>
        )}

        {/* Navigation arrows */}
        {totalSlides > 1 && (
          <>
            <button onClick={goToPrev} className={`absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-30 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-all duration-300 flex items-center justify-center ${isHoveringState ? "opacity-100" : "opacity-0 pointer-events-none"}`} aria-label="Предыдущий">
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <button onClick={goToNext} className={`absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 z-30 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-all duration-300 flex items-center justify-center ${isHoveringState ? "opacity-100" : "opacity-0 pointer-events-none"}`} aria-label="Следующий">
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </>
        )}
      </section>

      {/* Features bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div key={index} className="flex items-center gap-3 rounded-xl sm:rounded-2xl p-3 sm:p-4 bg-card border border-border shadow-sm hover:shadow-md transition-shadow">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-xs sm:text-sm leading-tight truncate">{feature.title}</p>
                <p className="text-muted-foreground text-[10px] sm:text-xs mt-0.5 truncate">{feature.subtitle}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
