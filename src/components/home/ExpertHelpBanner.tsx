import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Headphones, ArrowRight } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import logo from "@/assets/logo.svg";

export function ExpertHelpBanner() {
  return (
    <section className="py-4 sm:py-6">
      <div className="container px-4 sm:px-6">
        <ScrollReveal>
          <div className="section-dark rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10 relative overflow-hidden">
            {/* Glass decorative elements */}
            <div className="absolute top-0 right-0 w-40 h-40 sm:w-56 sm:h-56 opacity-[0.06]">
              <Headphones className="w-full h-full" />
            </div>
            <div className="absolute -bottom-10 -right-10 w-48 h-48 rounded-full bg-accent/10 blur-3xl" />
            <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full bg-primary-foreground/5 blur-2xl" />
            <div className="absolute bottom-4 right-8 opacity-[0.06] hidden lg:block">
              <img src={logo} alt="" className="h-28 w-auto brightness-0 invert" />
            </div>
            
            <div className="relative z-10 max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 backdrop-blur-md bg-accent/20 border border-accent/20 rounded-xl text-accent text-xs font-semibold mb-4">
                <Headphones className="h-3.5 w-3.5" />
                Помощь эксперта
              </div>
              
              <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-extrabold text-background mb-3">
                Нужна помощь с подбором?
              </h2>
              <p className="text-background/65 text-sm sm:text-base mb-5 leading-relaxed max-w-md">
                Наши эксперты помогут подобрать запчасти, которые будут совместимы с Вашим автомобилем
              </p>
              <Link to="/expert-help">
                <Button 
                  size="lg" 
                  className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground h-11 sm:h-12 px-7 text-sm font-semibold rounded-xl shadow-lg shadow-accent/20"
                >
                  Помощь эксперта
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
