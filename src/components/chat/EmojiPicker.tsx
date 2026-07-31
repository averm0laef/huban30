import { useState, useRef } from "react";
import { Smile } from "lucide-react";

const EMOJI_LIST = [
  "👍", "👋", "😊", "😂", "❤️", "🔥", "👌", "🙏",
  "😍", "🤔", "😅", "🎉", "💪", "✅", "⚡", "🚗",
  "🔧", "⭐", "📦", "💰", "📞", "🏠", "🛒", "✨",
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="Эмодзи"
      >
        <Smile className="h-4 w-4" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute bottom-full right-0 mb-2 z-50 bg-card border border-border rounded-xl shadow-xl p-2 w-[220px] animate-scale-in">
            <div className="grid grid-cols-6 gap-1">
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onSelect(emoji);
                    setIsOpen(false);
                  }}
                  className="w-8 h-8 flex items-center justify-center text-lg hover:bg-accent rounded-md transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
