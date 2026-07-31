import { useRef, useEffect, useState } from "react";
import { motion, useScroll, useTransform, MotionValue } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import engineBay from "@/assets/engine-bay.png";
import hoodPanel from "@/assets/hood-panel.png";

interface EnginePart {
  id: string;
  label: string;
  description: string | null;
  x_position: number;
  y_position: number;
  color: string;
  sort_order: number;
}

const defaultParts: EnginePart[] = [
  { id: "1", label: "Аккумулятор", description: "АКБ и клеммы", x_position: 78, y_position: 35, color: "#22c55e", sort_order: 1 },
  { id: "2", label: "Моторное масло", description: "Синтетика и полусинтетика", x_position: 45, y_position: 25, color: "#f59e0b", sort_order: 2 },
  { id: "3", label: "Фильтры", description: "Воздушные, масляные, топливные", x_position: 72, y_position: 55, color: "#0ea5e9", sort_order: 3 },
  { id: "4", label: "Ремни", description: "ГРМ и приводные", x_position: 25, y_position: 45, color: "#f43f5e", sort_order: 4 },
  { id: "5", label: "Свечи", description: "Зажигания и накаливания", x_position: 50, y_position: 60, color: "#8b5cf6", sort_order: 5 },
  { id: "6", label: "Охлаждение", description: "Радиаторы, антифриз", x_position: 22, y_position: 25, color: "#06b6d4", sort_order: 6 },
];

export function ScrollRevealSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [parts, setParts] = useState<EnginePart[]>(defaultParts);

  useEffect(() => {
    supabase
      .from("engine_parts")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) setParts(data as EnginePart[]);
      });
  }, []);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  // Section
  const sectionOpacity = useTransform(scrollYProgress, [0.0, 0.08, 0.82, 0.92], [0, 1, 1, 0]);
  const sectionScale = useTransform(scrollYProgress, [0.0, 0.1], [0.96, 1]);

  // Title
  const titleOpacity = useTransform(scrollYProgress, [0.04, 0.12], [0, 1]);
  const titleY = useTransform(scrollYProgress, [0.04, 0.12], [30, 0]);

  // Hood rotates open UPWARD from top edge (like a real hood)
  const hoodRotateX = useTransform(scrollYProgress, [0.14, 0.44], [0, -88]);
  const hoodOpacity = useTransform(scrollYProgress, [0.42, 0.48], [1, 0]);
  const hoodShadowBlur = useTransform(scrollYProgress, [0.14, 0.36], [0, 50]);

  // Engine bay image
  const bayOpacity = useTransform(scrollYProgress, [0.06, 0.14], [0.3, 1]);

  // Labels
  const labelsOpacity = useTransform(scrollYProgress, [0.42, 0.54], [0, 1]);

  // CTA
  const ctaOpacity = useTransform(scrollYProgress, [0.58, 0.66], [0, 1]);
  const ctaY = useTransform(scrollYProgress, [0.58, 0.66], [15, 0]);

  return (
    <div ref={containerRef} className="relative h-[300vh]">
      <div className="sticky top-0 h-screen flex items-center justify-center overflow-hidden">
        <motion.div
          style={{ opacity: sectionOpacity, scale: sectionScale }}
          className="relative w-full max-w-4xl mx-auto px-4 sm:px-6 flex flex-col items-center"
        >
          {/* Title */}
          <motion.div style={{ opacity: titleOpacity, y: titleY }} className="text-center mb-5 sm:mb-8 z-10">
            <h2 className="font-display text-2xl sm:text-3xl lg:text-5xl font-extrabold text-foreground leading-tight">
              Загляните <span className="text-primary">под капот</span>
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-2 max-w-lg mx-auto">
              Всё необходимое для вашего автомобиля — в одном магазине
            </p>
          </motion.div>

          {/* Hood + Engine bay container */}
          <div className="relative w-full max-w-3xl aspect-[16/10] rounded-2xl sm:rounded-3xl overflow-hidden" style={{ perspective: "1400px" }}>
            
            {/* Engine bay (underneath) */}
            <motion.div style={{ opacity: bayOpacity }} className="absolute inset-0 z-[1]">
              <img
                src={engineBay}
                alt="Моторный отсек"
                className="w-full h-full object-cover"
              />
              {/* Subtle dark overlay for label readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/20" />
            </motion.div>

            {/* Hood panel (rotates open from bottom) */}
            <motion.div
              style={{
                rotateX: hoodRotateX,
                opacity: hoodOpacity,
                transformOrigin: "top center",
              }}
              className="absolute inset-0 z-[3] will-change-transform"
            >
              <img
                src={hoodPanel}
                alt="Капот"
                className="w-full h-full object-cover rounded-2xl sm:rounded-3xl"
              />
              {/* Shadow that grows as hood lifts */}
              <motion.div
                style={{
                  boxShadow: useTransform(
                    hoodShadowBlur,
                    (v) => `0 ${v * 0.8}px ${v * 2}px rgba(0,0,0,0.3)`
                  ),
                }}
                className="absolute inset-0 rounded-2xl sm:rounded-3xl pointer-events-none"
              />
            </motion.div>

            {/* Part labels */}
            <motion.div style={{ opacity: labelsOpacity }} className="absolute inset-0 z-[4]">
              {parts.map((part, i) => (
                <PartLabel key={part.id} part={part} index={i} total={parts.length} scrollYProgress={scrollYProgress} />
              ))}
            </motion.div>
          </div>

          {/* CTA */}
          <motion.div style={{ opacity: ctaOpacity, y: ctaY }} className="mt-6 sm:mt-8 z-10">
            <Link to="/catalog">
              <Button size="lg" className="rounded-xl h-11 sm:h-12 px-6 sm:px-8 font-bold shadow-lg shadow-primary/20">
                Смотреть каталог
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

function PartLabel({ part, index, total, scrollYProgress }: {
  part: EnginePart; index: number; total: number; scrollYProgress: MotionValue<number>;
}) {
  const delay = 0.5 + (index / total) * 0.12;
  const opacity = useTransform(scrollYProgress, [delay, delay + 0.04], [0, 1]);
  const scale = useTransform(scrollYProgress, [delay, delay + 0.04], [0.5, 1]);
  const y = useTransform(scrollYProgress, [delay, delay + 0.04], [8, 0]);

  return (
    <motion.div
      style={{ opacity, scale, y, left: `${part.x_position}%`, top: `${part.y_position}%` }}
      className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-default"
    >
      <span className="relative block mx-auto mb-1.5">
        <span className="block w-3 h-3 rounded-full shadow-lg ring-[3px] ring-white/70" style={{ backgroundColor: part.color }} />
        <span className="absolute inset-0 w-3 h-3 rounded-full animate-ping opacity-30" style={{ backgroundColor: part.color }} />
      </span>
      <div className="bg-white/90 dark:bg-card/95 backdrop-blur-md border border-white/40 rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-xl text-center whitespace-nowrap transition-all duration-300 group-hover:scale-110 group-hover:-translate-y-1">
        <p className="font-bold text-[10px] sm:text-xs text-foreground leading-tight">{part.label}</p>
        {part.description && (
          <p className="text-[8px] sm:text-[10px] text-muted-foreground mt-0.5 hidden sm:block">{part.description}</p>
        )}
      </div>
    </motion.div>
  );
}
