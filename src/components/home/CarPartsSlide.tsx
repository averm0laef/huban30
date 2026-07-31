import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import lc300 from "@/assets/lc300-topdown.png";

interface PartInfo {
  id: string;
  label: string;
  description: string;
  // Position of the dot on the car (percentage)
  dotX: number;
  dotY: number;
  // Card position
  cardSide: "left" | "right";
  cardY: number;
  searchQuery: string;
}

const parts: PartInfo[] = [
  {
    id: "engine",
    label: "Двигатель",
    description: "Фильтры, ремни ГРМ, свечи зажигания, прокладки, масла и охлаждающие жидкости",
    dotX: 50,
    dotY: 25,
    cardSide: "left",
    cardY: 10,
    searchQuery: "двигатель",
  },
  {
    id: "suspension",
    label: "Подвеска",
    description: "Амортизаторы, пружины, сайлентблоки, шаровые опоры, стойки стабилизатора",
    dotX: 35,
    dotY: 45,
    cardSide: "left",
    cardY: 38,
    searchQuery: "подвеска",
  },
  {
    id: "brakes",
    label: "Тормозная система",
    description: "Колодки, диски, суппорты, тормозные шланги и жидкости",
    dotX: 65,
    dotY: 45,
    cardSide: "right",
    cardY: 10,
    searchQuery: "тормоз",
  },
  {
    id: "steering",
    label: "Рулевое управление",
    description: "Рулевые тяги, наконечники, рейки, насосы ГУР и жидкости",
    dotX: 42,
    dotY: 35,
    cardSide: "left",
    cardY: 66,
    searchQuery: "рулевая",
  },
  {
    id: "transmission",
    label: "Трансмиссия",
    description: "Сцепление, фильтры АКПП, масла, крестовины, ШРУСы",
    dotX: 50,
    dotY: 55,
    cardSide: "right",
    cardY: 40,
    searchQuery: "трансмиссия",
  },
  {
    id: "electrics",
    label: "Электрика",
    description: "Генераторы, стартеры, датчики, лампы, аккумуляторы, провода",
    dotX: 58,
    dotY: 68,
    cardSide: "right",
    cardY: 68,
    searchQuery: "электрика",
  },
];

export function CarPartsSlide() {
  const [activePart, setActivePart] = useState<string | null>(null);

  return (
    <div className="relative w-full h-[380px] sm:h-[400px] lg:h-[440px] bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(220,30%,12%)] to-[hsl(220,40%,8%)] overflow-hidden">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `radial-gradient(circle, hsl(var(--primary-foreground)) 1px, transparent 1px)`,
          backgroundSize: "30px 30px",
        }}
      />

      {/* Title */}
      <div className="absolute top-5 sm:top-6 left-5 sm:left-8 z-10">
        <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-extrabold text-white leading-tight">
          ЗАПЧАСТИ ДЛЯ{" "}
          <span className="text-[hsl(var(--accent))]">ЛЮБОГО УЗЛА</span>
        </h2>
        <p className="text-xs sm:text-sm text-white/50 mt-1 max-w-xs">
          Нажмите на точку, чтобы узнать что есть в наличии
        </p>
      </div>

      {/* Car image - centered, larger */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <img
          src={lc300}
          alt="Toyota Land Cruiser 300"
          className="h-[90%] sm:h-[92%] lg:h-[95%] w-auto object-contain drop-shadow-[0_20px_60px_rgba(0,100,255,0.15)]"
        />
      </div>

      {/* Interactive dots on the car */}
      <div className="absolute inset-0">
        {parts.map((part) => (
          <button
            key={part.id}
            className="absolute z-20 group"
            style={{ left: `${part.dotX}%`, top: `${part.dotY}%`, transform: "translate(-50%, -50%)" }}
            onMouseEnter={() => setActivePart(part.id)}
            onMouseLeave={() => setActivePart(null)}
            onClick={() => setActivePart(activePart === part.id ? null : part.id)}
          >
            {/* Static glow ring - no animate-ping */}
            <span className={`absolute w-6 h-6 sm:w-7 sm:h-7 -left-[5px] -top-[5px] sm:-left-[6px] sm:-top-[6px] rounded-full border-2 border-[hsl(var(--accent))] transition-opacity duration-200 ${
              activePart === part.id ? "opacity-60 scale-125" : "opacity-25"
            }`} />
            {/* Dot */}
            <span className={`block w-4 h-4 sm:w-4 sm:h-4 rounded-full shadow-lg transition-transform duration-150 ${
              activePart === part.id
                ? "bg-[hsl(var(--accent))] scale-125"
                : "bg-[hsl(var(--accent))]/80 group-hover:bg-[hsl(var(--accent))] group-hover:scale-110"
            }`} />
          </button>
        ))}
      </div>

      {/* Info cards - positioned on sides */}
      <AnimatePresence mode="wait">
        {activePart && (() => {
          const part = parts.find(p => p.id === activePart);
          if (!part) return null;
          return (
            <motion.div
              key={part.id}
              initial={{ opacity: 0, x: part.cardSide === "left" ? -20 : 20, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`absolute z-30 w-52 sm:w-60 ${
                part.cardSide === "left" ? "left-3 sm:left-6" : "right-3 sm:right-6"
              }`}
              style={{ top: `${part.cardY}%` }}
            >
              <div className="bg-white/10 backdrop-blur-xl rounded-xl p-3 sm:p-4 border border-white/10 shadow-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[hsl(var(--accent))]" />
                  <h3 className="font-bold text-white text-sm sm:text-base">{part.label}</h3>
                </div>
                <p className="text-white/70 text-xs sm:text-sm leading-relaxed mb-3">
                  {part.description}
                </p>
                <Link to={`/catalog?search=${encodeURIComponent(part.searchQuery)}`}>
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/90 text-[hsl(var(--accent-foreground))]"
                  >
                    Смотреть запчасти
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Bottom CTA */}
      <div className="absolute bottom-5 sm:bottom-6 right-5 sm:right-8 z-10">
        <Link to="/catalog">
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 bg-white/5 backdrop-blur-sm text-white hover:bg-white hover:text-foreground text-xs sm:text-sm rounded-xl"
          >
            Весь каталог
            <ArrowRight className="ml-2 h-3 w-3 sm:h-4 sm:w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
