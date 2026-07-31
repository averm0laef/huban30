import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface ChatWelcomeBubbleProps {
  isOpen: boolean;
  hasMessages: boolean;
}

export function ChatWelcomeBubble({ isOpen, hasMessages }: ChatWelcomeBubbleProps) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isOpen || hasMessages || dismissed) return;
    
    const alreadyShown = sessionStorage.getItem('chat_welcome_shown');
    if (alreadyShown) return;

    const timer = setTimeout(() => {
      setVisible(true);
      sessionStorage.setItem('chat_welcome_shown', 'true');
    }, 5000);

    return () => clearTimeout(timer);
  }, [isOpen, hasMessages, dismissed]);

  useEffect(() => {
    if (isOpen) setVisible(false);
  }, [isOpen]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-36 md:bottom-24 right-6 z-50 animate-fade-in">
      <div className="bg-card border border-border rounded-2xl shadow-xl px-4 py-3 max-w-[240px] relative">
        <button
          onClick={() => {
            setVisible(false);
            setDismissed(true);
          }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-muted rounded-full flex items-center justify-center hover:bg-muted-foreground/20 transition-colors"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
        <p className="text-sm text-foreground">
          👋 Нужна помощь с подбором запчастей? Напишите нам!
        </p>
        {/* Triangle pointer */}
        <div className="absolute -bottom-2 right-6 w-4 h-4 bg-card border-r border-b border-border rotate-45" />
      </div>
    </div>
  );
}
