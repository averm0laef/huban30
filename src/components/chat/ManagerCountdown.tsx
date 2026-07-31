import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

interface ManagerCountdownProps {
  waitingSince: string;
  totalMinutes?: number;
  className?: string;
}

export function ManagerCountdown({ waitingSince, totalMinutes = 10, className = "" }: ManagerCountdownProps) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const update = () => {
      const start = new Date(waitingSince).getTime();
      const deadline = start + totalMinutes * 60 * 1000;
      const now = Date.now();
      const left = deadline - now;

      if (left <= 0) {
        setExpired(true);
        setRemaining("0:00");
        return;
      }

      const mins = Math.floor(left / 60000);
      const secs = Math.floor((left % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
      setExpired(false);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [waitingSince, totalMinutes]);

  return (
    <div className={`flex justify-center my-2 ${className}`}>
      <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-xs font-medium animate-fade-in">
        <Timer className="h-3.5 w-3.5 animate-pulse" />
        {expired ? (
          <span>Менеджер подключится совсем скоро!</span>
        ) : (
          <span>Менеджер подключится в течение <strong>{remaining}</strong></span>
        )}
      </div>
    </div>
  );
}
