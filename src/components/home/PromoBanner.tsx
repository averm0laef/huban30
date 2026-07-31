import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Percent, Clock } from "lucide-react";

export function PromoBanner() {
  return (
    <section className="mx-3 sm:mx-4 lg:mx-6">
      <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden bg-gradient-to-r from-primary via-primary/90 to-accent/80 p-6 sm:p-8 lg:p-10">
        {/* Decorative */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex items-start gap-4 text-center lg:text-left">
            <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-white/10 items-center justify-center shrink-0">
              <Percent className="h-7 w-7 text-white" />
            </div>
            <div>
              <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-extrabold text-white leading-tight">
                Нет товара в наличии?
              </h2>
              <p className="text-white/70 text-sm sm:text-base mt-2 max-w-lg">
                Привезём любую запчасть под заказ в кратчайшие сроки! Оставьте заявку — и мы найдём деталь по лучшей цене.
              </p>
              <div className="flex items-center gap-2 mt-3 justify-center lg:justify-start">
                <Clock className="h-4 w-4 text-yellow-300" />
                <span className="text-yellow-300 text-sm font-medium">Срок доставки от 1 до 7 дней</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Link to="/expert-help">
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-12 px-8 text-sm font-bold rounded-xl shadow-lg transition-all hover:-translate-y-0.5">
                Оставить заявку
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/contacts">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 h-12 px-8 text-sm rounded-xl">
                Позвонить нам
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
