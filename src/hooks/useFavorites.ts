import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const fetchFavorites = useCallback(async () => {
    if (!user) {
      setFavorites(new Set());
      return;
    }

    try {
      const { data } = await supabase
        .from('user_favorites')
        .select('product_id')
        .eq('user_id', user.id);

      if (data) {
        setFavorites(new Set(data.map(f => f.product_id)));
      }
    } catch (error) {
      console.error('Error fetching favorites:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const toggleFavorite = async (productId: string) => {
    if (!user) {
      toast.error('Войдите в аккаунт, чтобы добавить в избранное');
      return;
    }

    setIsLoading(true);
    const isFavorite = favorites.has(productId);

    try {
      if (isFavorite) {
        await supabase
          .from('user_favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('product_id', productId);

        setFavorites(prev => {
          const newSet = new Set(prev);
          newSet.delete(productId);
          return newSet;
        });
        toast.success('Убрано из избранного');
      } else {
        await supabase
          .from('user_favorites')
          .insert({ user_id: user.id, product_id: productId });

        setFavorites(prev => new Set([...prev, productId]));
        toast.success('Добавлено в избранное');
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      toast.error('Не удалось обновить избранное');
    } finally {
      setIsLoading(false);
    }
  };

  const isFavorite = (productId: string) => favorites.has(productId);

  return {
    favorites,
    isLoading,
    toggleFavorite,
    isFavorite,
    refetch: fetchFavorites,
  };
}
