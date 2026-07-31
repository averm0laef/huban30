import { createContext, useContext, useState, ReactNode, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useChatAvailability } from "@/hooks/useStoreStatus";
import { useChatSound } from "@/hooks/useChatSound";



export interface ChatMessage {
  id: string;
  text: string;
  sender: "user" | "admin" | "system" | "bot";
  timestamp: Date;
  imageUrl?: string;
  isRead?: boolean;
  readAt?: string;
  deliveredAt?: string;
  adminOnly?: boolean;
  /** Локальный статус доставки для сообщений пользователя */
  status?: "sending" | "sent" | "failed";
}

interface ChatContextType {
  isOpen: boolean;
  hasUnread: boolean;
  unreadCount: number;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  setHasUnread: (value: boolean) => void;
  // Shared state
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  threadId: string | null;
  setThreadId: (id: string | null) => void;
  threadStatus: string;
  setThreadStatus: (status: string) => void;
  adminJoined: boolean;
  setAdminJoined: (joined: boolean) => void;
  adminTyping: boolean;
  setAdminTyping: (typing: boolean) => void;
  declinedHelp: boolean;
  setDeclinedHelp: (declined: boolean) => void;
  isOnline: boolean;
  rating: number | null;
  setRating: (rating: number | null) => void;
  showRating: boolean;
  setShowRating: (show: boolean) => void;
  isLoading: boolean;
  processedMsgIds: React.MutableRefObject<Set<string>>;
  guestSessionId: React.MutableRefObject<string>;
  productContext: ProductContext | null;
  setProductContext: (ctx: ProductContext | null) => void;
  waitingSince: string | null;
  loadOrCreateThread: () => Promise<void>;
  loadMessages: (tId: string) => Promise<void>;
  sendMessage: (text: string, imageFile?: File | null, imagePreview?: string | null) => Promise<void>;
  sendTypingStatus: (isTyping: boolean) => void;
  startNewChat: () => void;
}

export interface ProductContext {
  id: string;
  title: string;
  price: number;
  imageUrl?: string | null;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  
  // Shared chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadStatus, setThreadStatus] = useState<string>("new");
  const [adminJoined, setAdminJoined] = useState(false);
  const [adminTyping, setAdminTyping] = useState(false);
  const [declinedHelp, setDeclinedHelp] = useState(false);
  const { isOnline } = useChatAvailability();
  const [rating, setRating] = useState<number | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { playMessageSound } = useChatSound();
  const [productContext, setProductContext] = useState<ProductContext | null>(null);
  const [waitingSince, setWaitingSince] = useState<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const managerJoinedNotified = useRef(false);
  
  const processedMsgIds = useRef<Set<string>>(new Set());
  const guestSessionId = useRef<string>(localStorage.getItem('guest_session_id') || crypto.randomUUID());

  // Refs for values used inside realtime subscription to avoid re-subscriptions
  const threadStatusRef = useRef(threadStatus);
  const ratingRef = useRef(rating);
  const isOpenRef = useRef(isOpen);
  const adminJoinedRef = useRef(adminJoined);

  useEffect(() => { threadStatusRef.current = threadStatus; }, [threadStatus]);
  useEffect(() => { ratingRef.current = rating; }, [rating]);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { adminJoinedRef.current = adminJoined; }, [adminJoined]);

  // Store guest session id
  useEffect(() => {
    if (!localStorage.getItem('guest_session_id')) {
      localStorage.setItem('guest_session_id', guestSessionId.current);
    }
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!threadId) return;

    const channel = supabase
      .channel(`chat-context-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`
        },
        (payload) => {
          const newMsg = payload.new as any;
          if (newMsg.sender !== 'user' && !processedMsgIds.current.has(newMsg.id)) {
            processedMsgIds.current.add(newMsg.id);
            
            if (newMsg.sender === 'admin') {
              // Show "manager joined" notification on first admin message
              if (!adminJoinedRef.current && !managerJoinedNotified.current) {
                managerJoinedNotified.current = true;
                const joinId = crypto.randomUUID();
                processedMsgIds.current.add(joinId);
                setMessages(prev => [...prev, {
                  id: joinId,
                  text: "🟢 Менеджер подключился к чату",
                  sender: "system",
                  timestamp: new Date(),
                }]);
                // Always play sound when manager first joins
                playMessageSound();
                // Browser notification for manager joining
                if ('Notification' in window && Notification.permission === 'granted') {
                  try {
                    const notification = new Notification('Менеджер подключился! 🟢', {
                      body: 'Менеджер подключился к вашему чату',
                      icon: '/favicon.png',
                      badge: '/favicon.png',
                      tag: 'manager-joined',
                    });
                    notification.onclick = () => {
                      window.focus();
                      notification.close();
                    };
                    setTimeout(() => notification.close(), 5000);
                  } catch (e) {
                    console.error('Notification error:', e);
                  }
                }
              }
              setAdminJoined(true);
              setWaitingSince(null);

              // Sound and notification for each admin message (when chat is closed)
              if (!isOpenRef.current) {
                setHasUnread(true);
                setUnreadCount(prev => prev + 1);
                playMessageSound();
                if ('Notification' in window && Notification.permission === 'granted') {
                  try {
                    const notification = new Notification('Новое сообщение', {
                      body: newMsg.content?.substring(0, 100) || 'У вас новое сообщение в чате',
                      icon: '/favicon.png',
                      badge: '/favicon.png',
                      tag: 'chat-message',
                    });
                    notification.onclick = () => {
                      window.focus();
                      notification.close();
                    };
                    setTimeout(() => notification.close(), 5000);
                  } catch (e) {
                    console.error('Notification error:', e);
                  }
                }
              }
            }
            
            const metadata = newMsg.metadata as { imageUrl?: string; adminOnly?: boolean; bot?: boolean } | null;
            // Skip admin-only messages for users
            if (metadata?.adminOnly) return;

            const normalizedSender = newMsg.sender === 'system' && metadata?.bot
              ? 'bot'
              : (newMsg.sender as "user" | "admin" | "system" | "bot");
            
            setMessages(prev => [...prev, {
              id: newMsg.id,
              text: newMsg.content,
              sender: normalizedSender,
              timestamp: new Date(newMsg.created_at),
              imageUrl: metadata?.imageUrl,
              isRead: newMsg.is_read,
              deliveredAt: newMsg.delivered_at,
            }]);

            // Confirm delivery of manager messages to the server
            if (newMsg.sender === 'admin') {
              supabase.rpc('mark_messages_delivered', {
                p_thread_id: threadId,
                p_sender: 'admin',
              }).then(() => {});
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_threads',
          filter: `id=eq.${threadId}`
        },
        (payload) => {
          const updated = payload.new as any;
          const previousStatus = threadStatusRef.current;
          setThreadStatus(updated.status);
          setAdminTyping(updated.admin_typing === true);
          
          if (updated.status === 'closed' && previousStatus !== 'closed' && !updated.rating && !ratingRef.current) {
            const closeId = crypto.randomUUID();
            if (!processedMsgIds.current.has('admin-close-msg')) {
              processedMsgIds.current.add('admin-close-msg');
              const closeMessage: ChatMessage = {
                id: closeId,
                text: "Были рады помочь! 🔧\nЕсли возникнут вопросы — пишите, мы всегда на связи. Хорошего дня! 👋",
                sender: "bot",
                timestamp: new Date(),
              };
              setMessages(prev => [...prev, closeMessage]);
            }
            setShowRating(true);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`
        },
        (payload) => {
          const updated = payload.new as any;
          setMessages(prev => prev.map(msg => 
            msg.id === updated.id
              ? { ...msg, isRead: updated.is_read, readAt: updated.read_at, deliveredAt: updated.delivered_at, status: "sent" as const }
              : msg
          ));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]); // Only re-subscribe when threadId changes

  const loadOrCreateThread = useCallback(async () => {
    // If we already have a thread, refresh messages from DB to ensure consistency
    if (threadId) {
      // Silently refresh messages from DB to ensure consistency
      try {
        const { data } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: true });

        if (data) {
          data.forEach(m => processedMsgIds.current.add(m.id));
          
          const hasAdminMessage = data.some(m => m.sender === 'admin');
          if (hasAdminMessage) {
            setAdminJoined(true);
          }
          
          setMessages(data
            .filter(m => {
              const metadata = m.metadata as { adminOnly?: boolean } | null;
              return !(m.sender === 'system' && metadata?.adminOnly);
            })
            .map(m => {
              const metadata = m.metadata as { imageUrl?: string; adminOnly?: boolean; bot?: boolean } | null;
              const normalizedSender = m.sender === 'system' && metadata?.bot
                ? 'bot'
                : (m.sender as "user" | "admin" | "system" | "bot");
              return {
                id: m.id,
                text: m.content,
                sender: normalizedSender,
                timestamp: new Date(m.created_at),
                imageUrl: metadata?.imageUrl,
                isRead: (m as any).is_read,
                readAt: (m as any).read_at,
                deliveredAt: (m as any).delivered_at,
                adminOnly: metadata?.adminOnly
              };
            }));
        }
      } catch (e) {
        console.error('Error refreshing messages:', e);
      }
      return;
    }

    setIsLoading(true);
    processedMsgIds.current.clear();
    
    try {
      // Migrate guest threads if user is logged in
      if (user) {
        const storedGuestId = localStorage.getItem('guest_session_id');
        if (storedGuestId) {
          const { data: guestThreads } = await supabase
            .from('chat_threads')
            .select('id')
            .eq('guest_session_id', storedGuestId)
            .is('user_id', null);
          
          if (guestThreads && guestThreads.length > 0) {
            await supabase
              .from('chat_threads')
              .update({ user_id: user.id, guest_session_id: null })
              .eq('guest_session_id', storedGuestId)
              .is('user_id', null);
          }
        }
      }

      let query = supabase
        .from('chat_threads')
        .select('id, status, rating, waiting_since')
        .neq('status', 'closed')
        .order('last_message_at', { ascending: false })
        .limit(1);

      if (user) {
        query = query.eq('user_id', user.id);
      } else {
        query = query.eq('guest_session_id', guestSessionId.current);
      }

      const { data: existingThread } = await query.maybeSingle();

      if (existingThread) {
        setThreadId(existingThread.id);
        setThreadStatus(existingThread.status);
        setRating(existingThread.rating);
        setWaitingSince(existingThread.waiting_since);
        await loadMessages(existingThread.id);
      }
    } catch (error) {
      console.error('Error loading thread:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, threadId]);

  const loadMessages = useCallback(async (tId: string) => {
    supabase.rpc('mark_messages_delivered', { p_thread_id: tId, p_sender: 'admin' }).then(() => {});
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('thread_id', tId)
      .order('created_at', { ascending: true });

    if (data) {
      data.forEach(m => processedMsgIds.current.add(m.id));
      
      const hasAdminMessage = data.some(m => m.sender === 'admin');
      if (hasAdminMessage) {
        setAdminJoined(true);
      }
      
      setMessages(data
        .filter(m => {
          const metadata = m.metadata as { adminOnly?: boolean } | null;
          return !(m.sender === 'system' && metadata?.adminOnly);
        })
        .map(m => {
          const metadata = m.metadata as { imageUrl?: string; adminOnly?: boolean; bot?: boolean } | null;
          const normalizedSender = m.sender === 'system' && metadata?.bot
            ? 'bot'
            : (m.sender as "user" | "admin" | "system" | "bot");
          return {
            id: m.id,
            text: m.content,
            sender: normalizedSender,
            timestamp: new Date(m.created_at),
            imageUrl: metadata?.imageUrl,
            isRead: (m as any).is_read,
            readAt: (m as any).read_at,
            deliveredAt: (m as any).delivered_at,
            adminOnly: metadata?.adminOnly
          };
        }));
    }
  }, []);

  const uploadImage = async (file: File, tId: string): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${tId}/${crypto.randomUUID()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-images')
      .upload(fileName, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('chat-images')
      .getPublicUrl(fileName);

    return publicUrl;
  };

  const sendMessage = useCallback(async (text: string, imageFile?: File | null, imagePreview?: string | null) => {
    const messageText = text.trim();
    const hasImage = !!imageFile;
    
    if (!messageText && !hasImage) return;

    const tempId = crypto.randomUUID();
    processedMsgIds.current.add(tempId);
    const newMessage: ChatMessage = {
      id: tempId,
      text: messageText || (hasImage ? '📷 Фото' : ''),
      sender: "user",
      timestamp: new Date(),
      imageUrl: imagePreview || undefined,
      status: "sending",
    };
    setMessages(prev => [...prev, newMessage]);

    const isFirstUserMessage = messages.filter(m => m.sender === 'user').length === 0;
    
    // Check if user declined help
    const isDeclineMessage = messageText.toLowerCase().includes("нет") && 
      (messageText.toLowerCase().includes("просто смотрю") || messageText.toLowerCase().includes("нет, спасибо"));

    if (isDeclineMessage && isFirstUserMessage) {
      const replyId = crypto.randomUUID();
      processedMsgIds.current.add(replyId);
      const replyMessage: ChatMessage = {
        id: replyId,
        text: "Хорошо, обращайтесь если что! 👋",
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, replyMessage]);
      setDeclinedHelp(true);
      return;
    }

    try {
      let currentThreadId = threadId;

      if (!currentThreadId) {
        const { data: newThread, error: threadError } = await supabase
          .from('chat_threads')
          .insert({
            user_id: user?.id || null,
            guest_session_id: user ? null : guestSessionId.current,
            status: 'new',
          })
          .select('id')
          .single();

        if (threadError) throw threadError;
        currentThreadId = newThread.id;
        setThreadId(currentThreadId);
      }

      // Upload image if present
      let uploadedImageUrl: string | null = null;
      if (imageFile && currentThreadId) {
        uploadedImageUrl = await uploadImage(imageFile, currentThreadId);
      }

      const { data: insertedMsg } = await supabase
        .from('chat_messages')
        .insert({
          thread_id: currentThreadId,
          sender: 'user',
          content: messageText || (uploadedImageUrl ? '📷 Фото' : ''),
          metadata: uploadedImageUrl ? { imageUrl: uploadedImageUrl } : null,
        })
        .select('id')
        .single();

      if (insertedMsg) {
        processedMsgIds.current.add(insertedMsg.id);
        setMessages(prev => prev.map(msg =>
          msg.id === tempId ? { ...msg, id: insertedMsg.id, status: "sent" as const } : msg
        ));
      } else {
        setMessages(prev => prev.map(msg =>
          msg.id === tempId ? { ...msg, status: "sent" as const } : msg
        ));
      }

      // Set waiting since for countdown timer (no system message)
      if (isFirstUserMessage && !adminJoined && !isDeclineMessage) {
        setWaitingSince(new Date().toISOString());
      }

      await supabase
        .from('chat_threads')
        .update({
          last_message_at: new Date().toISOString(),
          status: 'waiting',
          waiting_since: new Date().toISOString(),
        })
        .eq('id', currentThreadId);

      // Send Telegram notification
      try {
        const userName = user?.email?.split('@')[0] || 'Гость';
        await supabase.functions.invoke('notify-telegram', {
          body: {
            threadId: currentThreadId,
            message: messageText || (uploadedImageUrl ? '📷 Фото' : ''),
            userName,
            imageUrl: uploadedImageUrl,
          },
        });
      } catch (notifyError) {
        console.error('Failed to send Telegram notification:', notifyError);
      }

      // Show Svechka intro on first user message before AI reply — save to DB
      if (isFirstUserMessage && !adminJoined && !isDeclineMessage && currentThreadId) {
        try {
          const introText = "Привет! Я Свечка — ваш помощник 🔧\nПока менеджер подключается, я могу помочь:\n\n• Подобрать запчасть по марке авто\n• Уточнить наличие и цену\n• Рассказать об условиях доставки и возврата\n\nЗадайте вопрос, и я постараюсь помочь!";
          const { data: introMsg } = await supabase
            .from('chat_messages')
            .insert({
              thread_id: currentThreadId,
              sender: 'system',
              content: introText,
              metadata: { bot: true },
            })
            .select('id, created_at')
            .single();

          if (introMsg) {
            processedMsgIds.current.add(introMsg.id);
            setMessages(prev => [...prev, {
              id: introMsg.id,
              text: introText,
              sender: "bot",
              timestamp: new Date(introMsg.created_at),
            }]);
          }
        } catch (introError) {
          console.error('Error saving intro message:', introError);
        }
      }

      // Call AI bot for auto-reply if manager hasn't joined yet
      if (!adminJoined && messageText && !isFirstUserMessage) {
        try {
          // Build conversation history for context
          const conversationHistory = messages
            .filter(m => m.sender === 'user' || m.sender === 'bot')
            .map(m => ({ sender: m.sender, text: m.text }));

          const { data: botData } = await supabase.functions.invoke('chat-assistant', {
            body: { 
              message: messageText,
              threadId: currentThreadId,
              conversationHistory,
              productContext: productContext ? {
                id: productContext.id,
                title: productContext.title,
                price: productContext.price,
              } : null,
            },
          });

          // Handle close_chat action from bot
          if (botData?.action === 'close_chat' && currentThreadId) {
            setThreadStatus('closed');
            setShowRating(true);
          }

          if (botData?.reply && currentThreadId) {
            const { data: insertedBotMsg, error: botInsertError } = await supabase
              .from('chat_messages')
              .insert({
                thread_id: currentThreadId,
                sender: 'system',
                content: botData.reply,
                metadata: { bot: true },
              })
              .select('id, created_at, is_read')
              .single();

            if (botInsertError) throw botInsertError;

            if (insertedBotMsg) {
              processedMsgIds.current.add(insertedBotMsg.id);
              setMessages(prev => [...prev, {
                id: insertedBotMsg.id,
                text: botData.reply,
                sender: "bot",
                timestamp: new Date(insertedBotMsg.created_at),
                isRead: insertedBotMsg.is_read,
              }]);
            }
          }
        } catch (botError) {
          console.error('Bot auto-reply error:', botError);
        }
      }

    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => prev.map(msg =>
        msg.id === tempId ? { ...msg, status: "failed" as const } : msg
      ));
      throw error;
    }
  }, [threadId, messages, user, isOnline, adminJoined, productContext]);

  const sendTypingStatus = useCallback((isTyping: boolean) => {
    if (!threadId) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    supabase.from('chat_threads')
      .update({ user_typing: isTyping, user_typing_at: isTyping ? new Date().toISOString() : null })
      .eq('id', threadId)
      .then(() => {});

    if (isTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingStatus(false);
      }, 3000);
    }
  }, [threadId]);

  const startNewChat = useCallback(() => {
    setThreadId(null);
    setMessages([]);
    setThreadStatus('new');
    setRating(null);
    setShowRating(false);
    setAdminJoined(false);
    setDeclinedHelp(false);
    setWaitingSince(null);
    managerJoinedNotified.current = false;
    processedMsgIds.current.clear();
  }, []);

  const openChat = useCallback(() => {
    setIsOpen(true);
    setHasUnread(false);
    setUnreadCount(0);
  }, []);
  
  const closeChat = useCallback(() => setIsOpen(false), []);
  
  const toggleChat = useCallback(() => {
    setIsOpen(prev => {
      if (!prev) {
        setHasUnread(false);
        setUnreadCount(0);
      }
      return !prev;
    });
  }, []);

  return (
    <ChatContext.Provider value={{ 
      isOpen, 
      hasUnread,
      unreadCount,
      openChat, 
      closeChat, 
      toggleChat, 
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
      setAdminTyping,
      declinedHelp,
      setDeclinedHelp,
      isOnline,
      rating,
      setRating,
      showRating,
      setShowRating,
      isLoading,
      processedMsgIds,
      guestSessionId,
      loadOrCreateThread,
      loadMessages,
      sendMessage,
      sendTypingStatus,
      productContext,
      setProductContext,
      waitingSince,
      startNewChat
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
