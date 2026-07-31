import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

interface UsePushNotificationsReturn {
  isSupported: boolean;
  permission: NotificationPermission | "default";
  isSubscribed: boolean;
  requestPermission: () => Promise<boolean>;
  showNotification: (title: string, options?: NotificationOptions) => void;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    // Check if notifications are supported
    const supported = "Notification" in window;
    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);
      setIsSubscribed(Notification.permission === "granted");
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      toast.error("Ваш браузер не поддерживает уведомления");
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      setIsSubscribed(result === "granted");

      if (result === "granted") {
        toast.success("Уведомления включены!");
        // Show test notification
        showNotification("Уведомления включены", {
          body: "Теперь вы будете получать уведомления о новых сообщениях",
          icon: "/favicon.png",
        });
        return true;
      } else if (result === "denied") {
        toast.error("Уведомления заблокированы. Разрешите их в настройках браузера.");
        return false;
      }
      return false;
    } catch (error) {
      console.error("Error requesting notification permission:", error);
      toast.error("Не удалось запросить разрешение на уведомления");
      return false;
    }
  }, [isSupported]);

  const showNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (!isSupported || permission !== "granted") {
      return;
    }

    try {
      const notification = new Notification(title, {
        icon: "/favicon.png",
        badge: "/favicon.png",
        tag: "chat-notification",
        ...options,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
    } catch (error) {
      console.error("Error showing notification:", error);
    }
  }, [isSupported, permission]);

  return {
    isSupported,
    permission,
    isSubscribed,
    requestPermission,
    showNotification,
  };
}