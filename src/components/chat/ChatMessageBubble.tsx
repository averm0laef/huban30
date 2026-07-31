import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { Check, CheckCheck, Clock, AlertCircle, Headset } from "lucide-react";
import type { ChatMessage } from "@/contexts/ChatContext";
import sparkPlugAvatar from "@/assets/404-spark-plug.png";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  formatTime: (date: Date) => string;
  getRelativeReadTime?: (readAt: string) => string;
  isAdmin?: boolean; // admin view flips alignment
  showBotLabel?: boolean;
  adminJoined?: boolean; // whether manager has joined (controls "Доставлено" visibility)
}

const messageVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

const sanitizeBotText = (text: string) =>
  text
    .replace(/\*\*\s*\[\s*позвать\s+менеджера\s*\]\s*\*\*/gi, "")
    .replace(/\[\s*позвать\s+менеджера\s*\]\([^\)]*\)/gi, "")
    .replace(/\[\s*позвать\s+менеджера\s*\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function ChatMessageBubbleInner({ message: m, formatTime, getRelativeReadTime, isAdmin = false, showBotLabel = true, adminJoined = false }: ChatMessageBubbleProps) {
  const isUser = isAdmin ? m.sender === "admin" : m.sender === "user";
  const isBot = m.sender === "bot";
  const isManagerMsg = isAdmin ? m.sender === "user" : m.sender === "admin";
  const isSystem = m.sender === "system";
  const displayText = isBot ? sanitizeBotText(m.text) : m.text;

  // System messages rendered as centered pill (like ManagerCountdown)
  if (isSystem) {
    return (
      <motion.div
        variants={messageVariants}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex justify-center my-2"
      >
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-xs font-medium">
          {m.text.includes("подключился") && <Headset className="h-3.5 w-3.5" />}
          <span>{m.text}</span>
        </div>
      </motion.div>
    );
  }

  // Delivery state: sending -> sent -> delivered -> read (or failed)
  const deliveryState: "sending" | "failed" | "read" | "delivered" | "sent" =
    m.status === "sending"
      ? "sending"
      : m.status === "failed"
      ? "failed"
      : m.isRead
      ? "read"
      : m.deliveredAt
      ? "delivered"
      : "sent";

  const statusIcon = !isUser ? null : deliveryState === "sending" ? (
    <Clock className="h-3 w-3 text-primary-foreground/60 animate-pulse" />
  ) : deliveryState === "failed" ? (
    <AlertCircle className="h-3 w-3 text-destructive" />
  ) : deliveryState === "read" ? (
    <CheckCheck className="h-3 w-3 text-green-400" />
  ) : deliveryState === "delivered" ? (
    <CheckCheck className="h-3 w-3 text-primary-foreground/60" />
  ) : (
    <Check className="h-3 w-3 text-primary-foreground/60" />
  );

  const statusLabel = !isUser
    ? null
    : deliveryState === "sending"
    ? "Отправляется…"
    : deliveryState === "failed"
    ? "Не отправлено"
    : deliveryState === "read"
    ? m.readAt && getRelativeReadTime
      ? `Прочитано ${getRelativeReadTime(m.readAt)}`
      : "Прочитано"
    : deliveryState === "delivered"
    ? "Доставлено"
    : "Отправлено";

  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} gap-2`}
    >
      {/* Avatar for non-user messages */}
      {isManagerMsg && !isAdmin && (
        <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0 mt-1">
          <Headset className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        </div>
      )}
      {isBot && (
        <div className="w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center shrink-0 mt-1 overflow-hidden">
          <img src={sparkPlugAvatar} alt="Свечка" className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}

      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : isSystem
            ? "bg-warning/20 text-foreground rounded-bl-md"
            : isBot
            ? "bg-accent/10 text-foreground border border-accent/20 rounded-bl-md"
            : "bg-card text-foreground border border-border rounded-bl-md"
        }`}
      >
        {/* Sender label */}
        {isManagerMsg && !isAdmin && (
          <p className="text-[11px] font-medium text-green-600 dark:text-green-400 mb-0.5">Менеджер</p>
        )}
        {isBot && showBotLabel && (
          <p className="text-[11px] font-medium text-accent mb-0.5">
            {isAdmin ? "🤖 Свечка (ИИ)" : "🔧 Свечка"}
          </p>
        )}

        {/* Image */}
        {m.imageUrl && (
          <a href={m.imageUrl} target="_blank" rel="noopener noreferrer" className="block mb-2">
            <img
              src={m.imageUrl}
              alt="Изображение"
              className="max-w-full max-h-48 rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
            />
          </a>
        )}

        {/* Text content with markdown for bot messages */}
        {displayText && displayText !== "📷 Фото" && (
          isBot ? (
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1 prose-a:text-primary prose-a:underline prose-a:font-medium">
              <ReactMarkdown
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline font-medium hover:text-primary/80">
                      {children}
                    </a>
                  ),
                }}
              >{displayText}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{displayText}</p>
          )
        )}
        {displayText === "📷 Фото" && !m.imageUrl && (
          <p className="text-sm">{displayText}</p>
        )}

        {/* Timestamp + delivery/read status */}
        <div className={`flex flex-col gap-0.5 mt-1 ${isUser ? "items-end" : "items-start"}`}>
          <div className="flex items-center gap-1">
            <span className={`text-[10px] ${isUser ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
              {formatTime(m.timestamp)}
            </span>
            {isUser && statusIcon}
          </div>
          {isUser && statusLabel && (
            <span
              className={`text-[9px] ${
                deliveryState === "read"
                  ? "text-green-400"
                  : deliveryState === "failed"
                  ? "text-destructive"
                  : "text-primary-foreground/50"
              }`}
            >
              {statusLabel}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export const ChatMessageBubble = memo(ChatMessageBubbleInner);
