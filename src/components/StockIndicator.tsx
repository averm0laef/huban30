import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface StockIndicatorProps {
  stockQty: number;
  availabilityStatus: string;
  className?: string;
  compact?: boolean;
}

export const StockIndicator = forwardRef<HTMLDivElement, StockIndicatorProps>(
  ({ stockQty, availabilityStatus, className, compact = false }, ref) => {
  const isInStock = availabilityStatus === 'in_stock' || stockQty > 0;

  if (!isInStock) {
    return (
      <div ref={ref} className={cn("flex items-center gap-1.5 text-sm", className)}>
        <div className="flex gap-0.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-3 rounded-[2px] bg-muted-foreground/20" />
          ))}
        </div>
        <span className="text-warning font-medium">{compact ? "Под заказ" : "Под заказ"}</span>
      </div>
    );
  }

  let level: 1 | 2 | 3;
  let label: string;
  let colorClass: string;

  if (stockQty <= 2) {
    level = 1;
    label = compact ? "Мало" : "Осталось мало";
    colorClass = "bg-orange-500";
  } else if (stockQty <= 5) {
    level = 2;
    label = compact ? "Достаточно" : "Достаточно";
    colorClass = "bg-yellow-500";
  } else {
    level = 3;
    label = compact ? "Много" : "На складе много";
    colorClass = "bg-green-500";
  }

  return (
    <div ref={ref} className={cn("flex items-center gap-1.5 text-sm", className)}>
      <div className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={cn(
              "w-1.5 rounded-[2px] transition-colors",
              compact ? "h-2.5" : "h-3",
              i < level ? colorClass : "bg-muted-foreground/20"
            )}
          />
        ))}
      </div>
      <span className={cn(
        "font-medium",
        level === 1 && "text-orange-500",
        level === 2 && "text-yellow-600 dark:text-yellow-400",
        level === 3 && "text-green-600 dark:text-green-400",
      )}>
        {label}
      </span>
    </div>
  );
});

StockIndicator.displayName = "StockIndicator";
