import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FavoriteButtonProps {
  isFavorite: boolean;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function FavoriteButton({ isFavorite, onClick, className, size = 'md' }: FavoriteButtonProps) {
  const sizeClasses = {
    sm: 'h-7 w-7',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  };

  const iconSizes = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        sizeClasses[size],
        'rounded-full bg-background/80 backdrop-blur-sm hover:bg-background',
        className
      )}
      onClick={onClick}
    >
      <Heart
        className={cn(
          iconSizes[size],
          'transition-all',
          isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'
        )}
      />
    </Button>
  );
}
