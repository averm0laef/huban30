import { useState, useEffect, useRef, useCallback, forwardRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessageCircle, Minus, Send, Clock, User, Star, XCircle, RefreshCw, Timer, MessageSquare, ImagePlus, X, Loader2, Maximize2, Check, CheckCheck, Bell, BellOff, BellRing, Headset } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isChatAvailable } from "@/hooks/useStoreStatus";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { ChatWelcomeBubble } from "./ChatWelcomeBubble";
import { ChatQuickReplies } from "./ChatQuickReplies";
import { EmojiPicker } from "./EmojiPicker";
import { ProductContextCard } from "./ProductContextCard";
import sparkPlugAvatar from "@/assets/404-spark-plug.png";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ManagerCountdown } from "./ManagerCountdown";

import { toast } from "sonner";

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Using forwardRef to prevent React warning about function components not being able to receive refs
export const ChatWidget = forwardRef<HTMLDivElement, object>(function ChatWidget(_props, ref) {
  // Forward ref is not used internally but prevents the React warning
  void ref;
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { 
    isOpen, 
    toggleChat, 
    hasUnread,
    unreadCount,
    setHasUnread,
    messages,
    setMessages,
    threadId,
    setThreadId,
    threadStatus,
    setThreadStatus,
    adminJoined,
    setAdminJoined,
    adminTyping,
    declinedHelp,
    setDeclinedHelp,
    isOnline,
    rating,
    setRating,
    showRating,
    setShowRating,
    isLoading,
    processedMsgIds,
    productContext,
    setProductContext,
    loadOrCreateThread,
    sendMessage,
    sendTypingStatus,
    startNewChat,
    waitingSince,
  } = useChat();
  
  
  
  const [input, setInput] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);
  const [chatHours, setChatHours] = useState<string>("9:00–19:00");
  const [showStatusHint, setShowStatusHint] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAdminMessageTimeRef = useRef<Date | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch store settings for offline autoreply and chat hours (using public view without sensitive data)
  useEffect(() => {
    const fetchStoreSettings = async () => {
      try {
        // Use REST API directly for the view since it's not in TypeScript types
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/store_settings_public?select=chat_offline_autoreply,chat_hours&limit=1`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Content-Type': 'application/json',
            },
          }
        );
        const result = await response.json();
        const data = result?.[0];
        
        if (data) {
          if (data.chat_offline_autoreply) {
            setOfflineMessage(data.chat_offline_autoreply);
          }
          const hours = data.chat_hours as Record<string, { open: string; close: string } | null>;
          if (hours) {
            const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            const todayHours = hours[today];
            if (todayHours) {
              setChatHours(`${todayHours.open}–${todayHours.close}`);
            } else {
              setChatHours("выходной");
            }
          }
        }
      } catch (error) {
        console.error('Error fetching store settings:', error);
      }
    };
    fetchStoreSettings();
  }, []);

  // Detect product page and set product context
  useEffect(() => {
    const match = location.pathname.match(/\/catalog\/product\/([a-f0-9-]+)/);
    if (match) {
      const productId = match[1];
      supabase
        .from('products')
        .select('id, title, price, product_images(url, sort_order)')
        .eq('id', productId)
        .single()
        .then(({ data }) => {
          if (data) {
            const images = (data.product_images || []) as any[];
            const sorted = [...images].sort((a: any, b: any) => a.sort_order - b.sort_order);
            setProductContext({
              id: data.id,
              title: data.title,
              price: data.price,
              imageUrl: sorted[0]?.url || null,
            });
          }
        });
    } else {
      setProductContext(null);
    }
  }, [location.pathname, setProductContext]);

  // Scroll to bottom when messages change or chat opens
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [messages]);

  // Scroll to bottom and clear unread when opening chat
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      setHasUnread(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 50);
      // Mark admin messages as read
      if (threadId) {
        markMessagesAsRead();
      }
    }
  }, [isOpen, messages.length, setHasUnread, threadId]);

  // Mark messages as read
  const markMessagesAsRead = async () => {
    if (!threadId) return;
    try {
      await supabase.rpc('mark_messages_as_read', { 
        p_thread_id: threadId, 
        p_sender: 'admin' 
      });
    } catch (e) {
      console.error('Error marking messages as read:', e);
    }
  };

  // Load/sync thread whenever opening widget (restores missed messages while closed)
  useEffect(() => {
    if (isOpen) {
      loadOrCreateThread();
    }
  }, [isOpen, loadOrCreateThread]);

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    setInactivityWarning(false);
    
    if (lastAdminMessageTimeRef.current && threadId && threadStatus !== 'closed') {
      inactivityTimerRef.current = setTimeout(async () => {
        setInactivityWarning(true);
        setTimeout(async () => {
          if (threadId && threadStatus !== 'closed') {
            await autoCloseChat();
          }
        }, 30000);
      }, INACTIVITY_TIMEOUT_MS);
    }
  }, [threadId, threadStatus]);

  const autoCloseChat = async () => {
    if (!threadId) return;
    
    try {
      const autoCloseId = crypto.randomUUID();
      processedMsgIds.current.add(autoCloseId);
      
      const closeMessage = {
        id: autoCloseId,
        text: "Чат был автоматически закрыт из-за неактивности. Вы можете начать новый чат в любое время!",
        sender: "system" as const,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, closeMessage]);

      await supabase
        .from('chat_messages')
        .insert({
          thread_id: threadId,
          sender: 'system',
          content: closeMessage.text,
        });

      await supabase
        .from('chat_threads')
        .update({ status: 'closed' })
        .eq('id', threadId);

      setThreadStatus('closed');
      setShowRating(true);
      lastAdminMessageTimeRef.current = null;
    } catch (error) {
      console.error('Error auto-closing chat:', error);
    }
  };

  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  // Update last admin message time when admin joins
  useEffect(() => {
    if (adminJoined && !lastAdminMessageTimeRef.current) {
      lastAdminMessageTimeRef.current = new Date();
      resetInactivityTimer();
    }
  }, [adminJoined, resetInactivityTimer]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Можно загружать только изображения');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Максимальный размер файла — 5 МБ');
      return;
    }

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearSelectedImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async (messageOverride?: string) => {
    const messageText = messageOverride?.trim() || input.trim();
    const hasImage = !!selectedImage;
    
    if (!messageText && !hasImage) return;

    setInput("");
    setIsUploading(hasImage);
    resetInactivityTimer();

    const isFirstUserMessage = messages.filter(m => m.sender === 'user').length === 0;

    try {
      await sendMessage(messageText, selectedImage, imagePreview);
      clearSelectedImage();

      // Show system notices for first message
      if (isFirstUserMessage && !declinedHelp) {
        const isDeclineMessage = messageText.toLowerCase().includes("нет") && messageText.toLowerCase().includes("просто смотрю");
        
        if (!isDeclineMessage) {
          if (isOnline && !adminJoined) {
            // Show status hint if not shown before
            const hintShown = localStorage.getItem('chat_status_hint_shown');
            if (!hintShown) {
              setTimeout(() => {
                setShowStatusHint(true);
                setTimeout(() => {
                  setShowStatusHint(false);
                  localStorage.setItem('chat_status_hint_shown', 'true');
                }, 6000);
              }, 1500);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Не удалось отправить сообщение');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCloseChat = async () => {
    if (!threadId) return;
    
    if (threadStatus === 'closed') {
      setShowRating(true);
      return;
    }
    
    setIsClosing(true);
    try {
      
      
      
      await supabase
        .from('chat_messages')
        .insert({
          thread_id: threadId,
          sender: 'system',
          content: 'Клиент закрыл чат',
          metadata: { adminOnly: true }
        });

      await supabase
        .from('chat_threads')
        .update({ status: 'closed' })
        .eq('id', threadId);

      try {
        const userName = user?.email?.split('@')[0] || 'Гость';
        await supabase.functions.invoke('notify-telegram', {
          body: {
            threadId: threadId,
            message: '❌ Клиент закрыл чат',
            userName,
          },
        });
      } catch (notifyError) {
        console.error('Failed to notify Telegram about chat close:', notifyError);
      }

      setThreadStatus('closed');
      setShowRating(true);
    } catch (error) {
      console.error('Error closing chat:', error);
    } finally {
      setIsClosing(false);
    }
  };

  const submitRating = async (stars: number) => {
    if (!threadId) return;
    setRating(stars);
    setShowRating(false);
    try {
      await supabase
        .from('chat_threads')
        .update({ rating: stars })
        .eq('id', threadId);

      try {
        const userName = user?.email?.split('@')[0] || 'Гость';
        await supabase.functions.invoke('notify-telegram', {
          body: {
            threadId: threadId,
            message: `⭐ Клиент поставил оценку: ${'⭐'.repeat(stars)} (${stars}/5)`,
            userName,
          },
        });
      } catch (notifyError) {
        console.error('Failed to notify Telegram about rating:', notifyError);
      }
    } catch (e) {
      console.log('Rating update:', e);
    }
  };

  const handleStartNewChat = () => {
    setInactivityWarning(false);
    lastAdminMessageTimeRef.current = null;
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    startNewChat();
  };

  const startConversationAfterDecline = () => {
    setDeclinedHelp(false);
    setMessages([]);
    processedMsgIds.current.clear();
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };

  const getRelativeReadTime = (readAt: string) => {
    const readDate = new Date(readAt);
    const now = new Date();
    const diffMs = now.getTime() - readDate.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "только что";
    if (diffMin < 60) return `${diffMin} мин. назад`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} ч. назад`;
    return readDate.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <>
      {/* Welcome bubble */}
      <ChatWelcomeBubble isOpen={isOpen} hasMessages={messages.length > 0} />
      
      {/* FAB Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleChat}
                  className={`relative w-14 h-14 md:w-16 md:h-16 rounded-full shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center ${
                    hasUnread ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'
                  }`}
                >
                  {hasUnread ? (
                    <>
                      <motion.div
                        animate={{ rotate: [0, -10, 10, -10, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 3 }}
                      >
                        <MessageSquare className="h-6 w-6 md:h-7 md:w-7" />
                      </motion.div>
                      <motion.span 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1 -right-1 min-w-6 h-6 bg-destructive rounded-full flex items-center justify-center px-1.5 shadow-lg"
                      >
                        <span className="text-xs font-bold text-destructive-foreground">{unreadCount > 9 ? '9+' : unreadCount || 1}</span>
                      </motion.span>
                      {/* Pulse ring */}
                      <span className="absolute inset-0 rounded-full bg-green-500/30 animate-ping" />
                    </>
                  ) : (
                    <>
                      <MessageCircle className="h-6 w-6 md:h-7 md:w-7" />
                      {!isOnline && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-warning rounded-full flex items-center justify-center shadow">
                          <Clock className="h-2.5 w-2.5 text-foreground" />
                        </span>
                      )}
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                <p>Онлайн-чат с экспертом</p>
              </TooltipContent>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
            className="fixed bottom-[4.5rem] left-3 right-3 md:left-auto md:bottom-6 md:right-6 z-50 md:w-[400px] max-h-[78vh] md:max-h-[min(700px,calc(100vh-3rem))] bg-card/85 dark:bg-card/75 backdrop-blur-2xl backdrop-saturate-150 rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] border border-white/20 dark:border-white/10 overflow-hidden flex flex-col ring-1 ring-black/5"
          >
          <div className="relative bg-gradient-to-br from-primary via-primary to-primary/85 text-primary-foreground p-3.5 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_60%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(253,224,71,0.08),transparent_50%)] pointer-events-none" />
            <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="relative shrink-0">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={adminJoined ? "manager" : waitingSince && threadStatus !== 'closed' ? "svechka" : "default"}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center overflow-hidden"
                    >
                      {waitingSince && !adminJoined && threadStatus !== 'closed' ? (
                        <img src={sparkPlugAvatar} alt="Свечка" className="h-full w-full object-cover" />
                      ) : (
                        <Headset className="h-4 w-4" />
                      )}
                    </motion.div>
                  </AnimatePresence>
                  <motion.span 
                    key={adminJoined ? "green" : waitingSince ? "amber" : isOnline ? "online" : "offline"}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-primary ${
                      adminJoined ? "bg-green-400 animate-pulse" 
                      : waitingSince && !adminJoined && threadStatus !== 'closed' ? "bg-amber-400 animate-pulse"
                      : isOnline ? "bg-green-400" 
                      : "bg-yellow-400"
                    }`} 
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={adminJoined ? "mgr" : waitingSince && threadStatus !== 'closed' ? "svechka" : "default"}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.2 }}
                      className="text-sm font-semibold leading-tight truncate"
                    >
                      {adminJoined 
                        ? "Менеджер на связи"
                        : waitingSince && !adminJoined && threadStatus !== 'closed'
                          ? "Свечка помогает"
                          : "Помощь эксперта"
                      }
                    </motion.p>
                  </AnimatePresence>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={adminJoined ? "on" : waitingSince && threadStatus !== 'closed' ? "wait" : isOnline ? "online" : "off"}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="text-[10px] text-primary-foreground/60 leading-tight"
                    >
                      {adminJoined 
                        ? "Онлайн" 
                        : waitingSince && !adminJoined && threadStatus !== 'closed'
                          ? "Менеджер скоро подключится"
                          : isOnline 
                            ? "Онлайн" 
                            : "Офлайн"
                      }
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                {'Notification' in window && (
                  <button
                    onClick={async () => {
                      if (Notification.permission === 'default') {
                        const result = await Notification.requestPermission();
                        if (result === 'granted') {
                          toast.success('Уведомления включены! 🔔');
                          // Force re-render
                          setInput(prev => prev);
                        } else if (result === 'denied') {
                          toast.error('Уведомления заблокированы в настройках браузера');
                        }
                      } else if (Notification.permission === 'granted') {
                        toast.info('Уведомления уже включены ✓');
                      } else {
                        toast.error('Уведомления заблокированы. Разрешите их в настройках браузера.');
                      }
                    }}
                    className={`p-2 rounded-full transition-colors ${
                      Notification.permission === 'granted'
                        ? 'bg-primary-foreground/20 hover:bg-primary-foreground/30'
                        : 'hover:bg-primary-foreground/20 animate-pulse'
                    }`}
                    title={
                      Notification.permission === 'granted' 
                        ? 'Уведомления включены' 
                        : Notification.permission === 'denied'
                          ? 'Уведомления заблокированы в браузере'
                          : 'Включить уведомления'
                    }
                  >
                    {Notification.permission === 'granted' 
                      ? <BellRing className="h-4 w-4" />
                      : Notification.permission === 'denied'
                        ? <BellOff className="h-4 w-4 opacity-50" />
                        : <Bell className="h-4 w-4" />
                    }
                  </button>
                )}
                <button 
                  onClick={() => {
                    toggleChat();
                    navigate('/chat');
                  }}
                  className="p-2 rounded-full hover:bg-primary-foreground/20 transition-colors"
                  title="Открыть полноценный чат"
                >
                  <Maximize2 className="h-5 w-5" />
                </button>
                
                {threadId && threadStatus !== 'closed' && messages.length > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button 
                        className="p-2 rounded-full hover:bg-primary-foreground/20 transition-colors"
                        title="Завершить чат"
                      >
                        <XCircle className="h-5 w-5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Завершить чат?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Вы уверены, что хотите завершить этот чат? После завершения вы сможете начать новый разговор.
                          <br /><br />
                          <span className="text-muted-foreground">
                            💡 Чтобы просто свернуть чат и продолжить ожидать ответ — нажмите на кнопку виджета внизу экрана.
                          </span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={handleCloseChat} disabled={isClosing}>
                          Да, завершить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <button 
                  onClick={toggleChat}
                  className="p-2 rounded-full hover:bg-primary-foreground/20 transition-colors"
                  title="Свернуть чат"
                >
                  <Minus className="h-5 w-5" />
                </button>
            </div>
            </div>
            </div>
          </div>

          {/* Status notices */}
          {inactivityWarning && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 text-xs flex items-center gap-2 backdrop-blur-sm">
              <Timer className="h-3.5 w-3.5" />
              Чат будет закрыт через 30 секунд из-за неактивности
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-secondary/10 via-background/40 to-secondary/20">

            {isLoading ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                Загрузка...
              </div>
            ) : offlineNotice ? (
              <div className="space-y-3">
                <div className="flex justify-start">
                  <div className="max-w-[90%] rounded-2xl px-4 py-3 bg-warning/20 text-foreground border border-warning/30 rounded-bl-md">
                    <div className="flex items-start gap-2">
                      <Clock className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium mb-1">Сейчас нерабочее время</p>
                        <p className="text-sm text-muted-foreground">
                          {offlineMessage || `Чат работает сегодня: ${chatHours} (по Чите). Напишите нам в рабочие часы!`}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full px-6"
                    onClick={() => {
                      setOfflineNotice(false);
                      toggleChat();
                    }}
                  >
                    Понятно
                  </Button>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="space-y-3">
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-card text-foreground border rounded-bl-md">
                    <p className="text-sm">Здравствуйте!</p>
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-card text-foreground border rounded-bl-md">
                    <p className="text-sm">Вам помочь подобрать деталь?</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="default"
                    size="sm"
                    className="rounded-full px-6"
                    onClick={() => {
                      if (!isOnline) {
                        setOfflineNotice(true);
                      } else {
                        handleSend("Да, помогите подобрать деталь");
                      }
                    }}
                  >
                    Да
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full px-6"
                    onClick={() => handleSend("Нет, я просто смотрю")}
                  >
                    Нет
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatMessageBubble
                    key={msg.id}
                    message={msg}
                    formatTime={formatTime}
                    getRelativeReadTime={getRelativeReadTime}
                    adminJoined={adminJoined}
                  />
                ))}

                {/* Quick suggestion buttons after Svechka intro */}
                {(() => {
                  const hasSvechkaIntro = messages.some(m => m.sender === 'bot' && m.text.includes('Я Свечка'));
                  if (!hasSvechkaIntro || adminJoined || threadStatus === 'closed') return null;
                  
                  const allSuggestions = [
                    { emoji: "🔍", label: "Подобрать по марке авто", msg: "Помогите подобрать запчасть по марке авто" },
                    { emoji: "📦", label: "Проверить наличие", msg: "Хочу узнать наличие товара" },
                    { emoji: "🚚", label: "Условия доставки", msg: "Расскажите про доставку" },
                    { emoji: "↩️", label: "Условия возврата", msg: "Какие условия возврата?" },
                  ];
                  
                  // Filter out suggestions already sent by user
                  const userMessages = messages.filter(m => m.sender === 'user').map(m => m.text);
                  const remaining = allSuggestions.filter(s => !userMessages.includes(s.msg));
                  if (remaining.length === 0) return null;
                  
                  return (
                    <div className="flex flex-wrap gap-1.5 justify-center mt-1 animate-fade-in">
                      {remaining.map((s) => (
                        <button
                          key={s.label}
                          onClick={() => handleSend(s.msg)}
                          className="text-xs px-3 py-1.5 rounded-full border border-accent/30 bg-accent/5 hover:bg-accent/15 text-foreground transition-colors"
                        >
                          {s.emoji} {s.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {/* Manager countdown timer */}
                {waitingSince && !adminJoined && !declinedHelp && threadStatus !== 'closed' && (
                  <ManagerCountdown waitingSince={waitingSince} />
                )}

                {showStatusHint && (
                  <div className="flex justify-center animate-fade-in">
                    <div className="bg-card border rounded-lg px-4 py-2 text-xs text-muted-foreground shadow-lg max-w-[80%] space-y-1">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span>— отправляется</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-muted-foreground" />
                        <span>— отправлено</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCheck className="h-3 w-3 text-muted-foreground" />
                        <span>— доставлено менеджеру</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCheck className="h-3 w-3 text-green-400" />
                        <span>— прочитано</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {adminTyping && threadStatus !== 'closed' && (
                  <div className="flex justify-start gap-2">
                    <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0 mt-1">
                      <Headset className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="max-w-[75%] rounded-2xl px-4 py-2 bg-card text-foreground border rounded-bl-md">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-medium text-green-600 dark:text-green-400">Менеджер</p>
                        <span className="text-muted-foreground text-sm">печатает</span>
                        <span className="flex gap-0.5">
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Rating UI */}
          {threadStatus === 'closed' && !rating && (
            <div className="p-4 border-t border-border bg-secondary/30">
              <p className="text-sm text-center text-foreground mb-3">Оцените нашу работу</p>
              <div className="flex justify-center gap-2 mb-4">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => submitRating(star)}
                    className="p-1.5 hover:scale-110 transition-transform"
                  >
                    <Star className="h-7 w-7 text-warning hover:fill-warning" />
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <Button 
                  size="sm" 
                  variant="ghost" 
                  className="text-muted-foreground text-xs" 
                  onClick={() => {
                    setShowRating(false);
                    handleStartNewChat();
                  }}
                >
                  Пропустить
                </Button>
              </div>
            </div>
          )}

          {rating && threadStatus === 'closed' && (
            <div className="p-4 border-t border-border bg-secondary/30 text-center">
              <p className="text-sm text-foreground mb-2">Спасибо за оценку!</p>
              <div className="flex justify-center gap-1 mb-4">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className={`h-5 w-5 ${star <= rating ? "text-warning fill-warning" : "text-muted-foreground"}`} />
                ))}
              </div>
              <Button size="sm" variant="default" className="gap-2" onClick={handleStartNewChat}>
                <RefreshCw className="h-4 w-4" />
                Начать новый чат
              </Button>
            </div>
          )}

          {declinedHelp && threadStatus !== 'closed' && (
            <div className="p-4 border-t border-border bg-card">
              <Button 
                size="sm" 
                variant="default" 
                className="w-full gap-2" 
                onClick={startConversationAfterDecline}
              >
                <MessageCircle className="h-4 w-4" />
                Всё-таки нужна помощь
              </Button>
            </div>
          )}


          {threadStatus !== 'closed' && !showRating && !rating && !declinedHelp && (
            <div className="p-3 border-t border-white/20 dark:border-white/10 bg-card/60 backdrop-blur-xl">
              {!isOnline ? (
                <div className="text-center py-2">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center justify-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-warning" />
                    Нерабочее время — ввод сообщений недоступен
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button 
                      size="sm" 
                      variant="default"
                      className="rounded-full px-5 text-xs"
                      onClick={() => {
                        toggleChat();
                        window.location.href = '/contacts';
                      }}
                    >
                      Оставить заявку
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="rounded-full px-5 text-xs"
                      onClick={() => {
                        toggleChat();
                        window.location.href = '/expert-help';
                      }}
                    >
                      Помощь эксперта
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Product context card */}
                  {productContext && messages.length === 0 && (
                    <ProductContextCard
                      product={productContext}
                      onSendWithProduct={() => {
                        handleSend(`Здравствуйте! Интересует товар: ${productContext.title} (${productContext.price.toLocaleString('ru-RU')} ₽)`);
                      }}
                    />
                  )}
                  {imagePreview && (
                    <div className="relative mb-2 mx-3 inline-block">
                      <img 
                        src={imagePreview} 
                        alt="Preview" 
                        className="max-h-20 rounded-lg object-cover"
                      />
                      <button
                        onClick={clearSelectedImage}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center hover:bg-destructive/90"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                      sendTypingStatus(false);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    <Button 
                      type="button" 
                      size="icon" 
                      variant="ghost"
                      className="shrink-0 h-8 w-8"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      title="Прикрепить фото"
                    >
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                    <Input
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        if (e.target.value.trim()) {
                          sendTypingStatus(true);
                        }
                      }}
                      placeholder="Введите сообщение..."
                      className="flex-1 h-9"
                      disabled={isUploading}
                    />
                    <EmojiPicker onSelect={(emoji) => setInput(prev => prev + emoji)} />
                    <Button type="submit" size="icon" className="shrink-0 h-8 w-8" disabled={(!input.trim() && !selectedImage) || isUploading}>
                      {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </form>
                </>
              )}
            </div>
          )}
        </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
