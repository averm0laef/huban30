import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface NotificationToggleProps {
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
}

export function NotificationToggle({ className, size = "icon" }: NotificationToggleProps) {
  const { isSupported, permission, isSubscribed, requestPermission } = usePushNotifications();

  if (!isSupported) {
    return null;
  }

  const handleClick = async () => {
    if (permission === "denied") {
      // Can't do anything programmatically, user must change browser settings
      return;
    }
    
    if (!isSubscribed) {
      await requestPermission();
    }
  };

  const getIcon = () => {
    if (permission === "denied") {
      return <BellOff className="h-4 w-4 text-muted-foreground" />;
    }
    if (isSubscribed) {
      return <BellRing className="h-4 w-4 text-success" />;
    }
    return <Bell className="h-4 w-4" />;
  };

  const getTooltipText = () => {
    if (permission === "denied") {
      return "Уведомления заблокированы в браузере";
    }
    if (isSubscribed) {
      return "Уведомления включены";
    }
    return "Включить уведомления";
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          onClick={handleClick}
          disabled={permission === "denied"}
          className={className}
        >
          {getIcon()}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{getTooltipText()}</p>
      </TooltipContent>
    </Tooltip>
  );
}