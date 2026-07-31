import { Truck, RotateCcw, Package, HelpCircle } from "lucide-react";

interface ChatQuickRepliesProps {
  onSend: (message: string) => void;
  visible: boolean;
}

const quickReplies = [
  { icon: Package, label: "Наличие", message: "Подскажите по наличию запчасти" },
  { icon: Truck, label: "Доставка", message: "Как у вас работает доставка?" },
  { icon: RotateCcw, label: "Возврат", message: "Какие условия возврата?" },
  { icon: HelpCircle, label: "Помощь", message: "Помогите подобрать деталь по VIN" },
];

export function ChatQuickReplies({ onSend, visible }: ChatQuickRepliesProps) {
  if (!visible) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-border bg-secondary/10">
      {quickReplies.map((qr) => (
        <button
          key={qr.label}
          onClick={() => onSend(qr.message)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors"
        >
          <qr.icon className="h-3 w-3" />
          {qr.label}
        </button>
      ))}
    </div>
  );
}
