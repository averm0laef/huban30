import { Search, Car, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.svg";

export function VehicleSearchBanner() {
  return (
    <section className="py-8 sm:py-12">
      <div className="container px-4 sm:px-6">
        <div className="relative bg-gradient-to-r from-primary to-primary/80 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 overflow-hidden">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-4 left-4 hidden sm:block">
              <Settings2 className="h-16 sm:h-24 w-16 sm:w-24 text-primary-foreground" />
            </div>
            <div className="absolute bottom-4 right-4 hidden sm:block">
              <Car className="h-20 sm:h-32 w-20 sm:w-32 text-primary-foreground" />
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <Settings2 className="h-32 sm:h-48 w-32 sm:w-48 text-primary-foreground rotate-45" />
            </div>
          </div>
          <div className="absolute bottom-4 right-6 opacity-[0.06] hidden lg:block">
            <img src={logo} alt="" className="h-24 w-auto brightness-0 invert" />
          </div>

          <div className="relative z-10 max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 backdrop-blur-md bg-primary-foreground/15 border border-primary-foreground/15 text-primary-foreground rounded-xl px-3 sm:px-4 py-1.5 sm:py-2 mb-4 sm:mb-6">
              <Search className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
              <span className="text-xs sm:text-sm font-medium">Поиск по автомобилю</span>
            </div>

            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-primary-foreground mb-3 sm:mb-4">
              Подберём запчасти<br />
              <span className="text-accent">для вашего авто</span>
            </h2>

            <p className="text-primary-foreground/80 text-sm sm:text-base lg:text-lg mb-6 sm:mb-8 max-w-xl mx-auto px-2">
              Укажите марку, модель и год выпуска — мы найдём нужные детали с гарантией совместимости
            </p>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <Link to="/catalog" className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  className="bg-accent hover:bg-accent/90 text-accent-foreground w-full rounded-xl shadow-lg shadow-accent/25"
                >
                  <Car className="mr-2 h-4 sm:h-5 w-4 sm:w-5" />
                  Подобрать запчасти
                </Button>
              </Link>
              <Link to="/expert-help" className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="border-primary-foreground/50 backdrop-blur-md bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground hover:text-primary w-full rounded-xl"
                >
                  Помощь эксперта
                </Button>
              </Link>
            </div>

            {/* Trust badges */}
            <div className="mt-8 sm:mt-10 grid grid-cols-3 gap-2 sm:gap-4 max-w-md mx-auto">
              {[
                { value: "5000+", label: "позиций" },
                { value: "100%", label: "оригинал" },
                { value: "24ч", label: "доставка" },
              ].map((badge) => (
                <div key={badge.label} className="text-center backdrop-blur-md bg-primary-foreground/5 border border-primary-foreground/10 rounded-xl py-3 px-2">
                  <p className="text-xl sm:text-2xl font-bold text-primary-foreground">{badge.value}</p>
                  <p className="text-[10px] sm:text-xs text-primary-foreground/60">{badge.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
