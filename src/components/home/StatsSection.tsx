import { useEffect, useRef, useState } from "react";
import { Package, Users, Calendar, ThumbsUp } from "lucide-react";

const stats = [
  { icon: Package, value: 10000, suffix: "+", label: "Запчастей в каталоге" },
  { icon: Users, value: 2000, suffix: "+", label: "Довольных клиентов" },
  { icon: Calendar, value: 10, suffix: " лет", label: "На рынке" },
  { icon: ThumbsUp, value: 98, suffix: "%", label: "Положительных отзывов" },
];

function AnimatedNumber({ value, suffix }: { value: number; suffix: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 2000;
          const steps = 60;
          const increment = value / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= value) {
              setCount(value);
              clearInterval(timer);
            } else {
              setCount(Math.floor(current));
            }
          }, duration / steps);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={ref} className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-primary">
      {count.toLocaleString("ru-RU")}{suffix}
    </div>
  );
}

export function StatsSection() {
  return (
    <section className="mx-3 sm:mx-4 lg:mx-6 py-8 sm:py-12">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div key={index} className="text-center space-y-2 sm:space-y-3 p-4 sm:p-6 rounded-2xl bg-card border border-border shadow-sm">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Icon className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
              </div>
              <AnimatedNumber value={stat.value} suffix={stat.suffix} />
              <p className="text-muted-foreground text-xs sm:text-sm">{stat.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
