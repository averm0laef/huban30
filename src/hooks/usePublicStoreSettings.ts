import { useEffect, useState } from "react";

interface PublicStoreSettings {
  id: string;
  title: string;
  phone: string | null;
  address: string | null;
  telegram_nick: string | null;
  timezone: string;
  chat_offline_autoreply: string | null;
  no_item_text: string | null;
  shop_hours: Record<string, { open: string; close: string } | null>;
  chat_hours: Record<string, { open: string; close: string } | null>;
  social_vk: string | null;
  social_whatsapp: string | null;
  social_telegram: string | null;
  social_max: string | null;
}

/**
 * Hook to fetch public store settings from the secure view
 * This view intentionally excludes sensitive data like exchange_login and exchange_password
 */
export function usePublicStoreSettings() {
  const [settings, setSettings] = useState<PublicStoreSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/store_settings_public?select=*&limit=1`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Content-Type': 'application/json',
            },
          }
        );
        
        if (!response.ok) {
          throw new Error('Failed to fetch store settings');
        }
        
        const result = await response.json();
        setSettings(result?.[0] || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Error fetching public store settings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  return { settings, isLoading, error };
}
