import { Package } from "lucide-react";

interface ProductContextCardProps {
  product: {
    id: string;
    title: string;
    price: number;
    imageUrl?: string | null;
  };
  onSendWithProduct: () => void;
}

export function ProductContextCard({ product, onSendWithProduct }: ProductContextCardProps) {
  return (
    <div className="mx-3 mb-2 p-2.5 rounded-xl bg-secondary/50 border border-border animate-fade-in">
      <div className="flex items-center gap-2.5">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-10 h-10 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{product.title}</p>
          <p className="text-xs text-primary font-semibold">{product.price.toLocaleString('ru-RU')} ₽</p>
        </div>
        <button
          onClick={onSendWithProduct}
          className="text-[10px] px-2 py-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          Спросить
        </button>
      </div>
    </div>
  );
}
