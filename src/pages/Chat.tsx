import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Send, ArrowLeft, ImagePlus, X, Loader2, Star, Clock, FileText, Bot, Headset, History, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useChat } from "@/contexts/ChatContext";
import { toast } from "sonner";
import logo from "@/assets/logo.svg";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { NotificationToggle } from "@/components/chat/NotificationToggle";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import { ManagerCountdown } from "@/components/chat/ManagerCountdown";

export default function Chat() {
  const {
    messages,
    setMessages,
    threadId,
    threadStatus,
    rating,
    setRating,
    showRating,
    setShowRating,
    isLoading,
    adminTyping,
    adminJoined,
    declinedHelp,
    setDeclinedHelp,
    isOnline,
    processedMsgIds,
    loadOrCreateThread,
    sendMessage,
    sendTypingStatus,
    startNewChat,
    productContext,
    loadMessages,
    setThreadId,
    setThreadStatus,
    setAdminJoined,
    waitingSince,
  } = useChat();
  
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyThreads, setHistoryThreads] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingHistoryThread, setViewingHistoryThread] = useState<string | null>(null);
  const [historyMessages, setHistoryMessages] = useState<any[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load thread on mount
  useEffect(() => {
    loadOrCreateThread();
  }, [loadOrCreateThread]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [messages]);

  // Mark messages as read when on this page
  useEffect(() => {
    if (threadId && messages.length > 0) {
      markMessagesAsRead();
    }
  }, [threadId, messages.length]);

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

  // Load chat history (closed threads)
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('chat_threads')
        .select('id, status, created_at, last_message_at, rating')
        .eq('status', 'closed')
        .order('last_message_at', { ascending: false })
        .limit(20);
      setHistoryThreads(data || []);
    } catch (e) {
      console.error('Error loading history:', e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const viewHistoryThread = async (hThreadId: string) => {
    setViewingHistoryThread(hThreadId);
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('thread_id', hThreadId)
      .order('created_at', { ascending: true });
    setHistoryMessages(
      (data || [])
        .filter(m => {
          const metadata = m.metadata as { adminOnly?: boolean } | null;
          return !(m.sender === 'system' && metadata?.adminOnly);
        })
        .map(m => {
          const metadata = m.metadata as { imageUrl?: string } | null;
          return {
            id: m.id,
            text: m.content,
            sender: m.sender as "user" | "admin" | "system" | "bot",
            timestamp: new Date(m.created_at),
            imageUrl: metadata?.imageUrl,
          };
        })
    );
  };

  const exitHistory = () => {
    setViewingHistoryThread(null);
    setHistoryMessages([]);
    setShowHistory(false);
  };

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
    if (!messageText && !selectedImage) return;

    setInput("");
    setIsUploading(!!selectedImage);
    
    try {
      await sendMessage(messageText, selectedImage, imagePreview);
      clearSelectedImage();
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Не удалось отправить сообщение');
    } finally {
      setIsUploading(false);
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
      toast.success('Спасибо за оценку!');
    } catch (e) {
      console.log('Rating update:', e);
    }
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
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-card border-b border-border p-4 shrink-0">
        <div className="container max-w-2xl mx-auto flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
            <span className="hidden sm:inline">На главную</span>
          </Link>
          <div className="flex items-center gap-3 flex-1">
            <img src={logo} alt="АН-30" className="h-10" />
            <div>
              <h1 className="font-semibold">Чат с поддержкой</h1>
              <p className="text-xs text-muted-foreground">
                {adminTyping ? (
                  <span className="text-primary animate-pulse">Менеджер печатает...</span>
                ) : adminJoined ? (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                    Менеджер в чате
                  </span>
                ) : threadId ? (
                  "Ожидание ответа"
                ) : (
                  isOnline ? "Онлайн" : "Оффлайн"
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationToggle />
            <Button 
              variant="outline" 
              size="sm" 
              className="text-xs gap-1.5"
              onClick={() => {
                if (showHistory) {
                  exitHistory();
                } else {
                  setShowHistory(true);
                  loadHistory();
                }
              }}
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{showHistory ? "Текущий чат" : "История"}</span>
            </Button>
            {threadStatus === 'closed' && !showHistory && (
              <Button variant="outline" size="sm" onClick={startNewChat} className="text-xs">
                Новый чат
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4 min-h-0">
        <div className="container max-w-2xl mx-auto space-y-3">
          {showHistory ? (
            viewingHistoryThread ? (
              <>
                <button
                  onClick={() => { setViewingHistoryThread(null); setHistoryMessages([]); }}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Назад к истории
                </button>
                {historyMessages.map((m) => (
                  <ChatMessageBubble
                    key={m.id}
                    message={m}
                    formatTime={formatTime}
                    getRelativeReadTime={getRelativeReadTime}
                  />
                ))}
                {historyMessages.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">Нет сообщений</p>
                )}
              </>
            ) : (
              <>
                <h2 className="font-semibold text-lg mb-4">История обращений</h2>
                {historyLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : historyThreads.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">У вас пока нет завершённых обращений</p>
                ) : (
                  <div className="space-y-2">
                    {historyThreads.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => viewHistoryThread(t.id)}
                        className="w-full text-left p-4 rounded-xl bg-card border border-border hover:border-primary/30 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">
                              Обращение от {new Date(t.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t.last_message_at && `Последнее сообщение: ${new Date(t.last_message_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {t.rating && (
                              <div className="flex gap-0.5">
                                {[1,2,3,4,5].map(s => (
                                  <Star key={s} className={`h-3 w-3 ${s <= t.rating ? 'text-warning fill-warning' : 'text-muted-foreground'}`} />
                                ))}
                              </div>
                            )}
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )
          ) : isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : messages.length === 0 ? (
            isOnline ? (
              <div className="space-y-3 py-8">
                {/* Product context card */}
                {productContext && (
                  <div className="mx-auto max-w-sm p-3 rounded-xl bg-secondary/50 border border-border animate-fade-in mb-4">
                    <div className="flex items-center gap-3">
                      {productContext.imageUrl ? (
                        <img src={productContext.imageUrl} alt={productContext.title} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Bot className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{productContext.title}</p>
                        <p className="text-sm text-primary font-semibold">{productContext.price.toLocaleString('ru-RU')} ₽</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="w-full mt-2 rounded-lg"
                      onClick={() => handleSend(`Здравствуйте! Интересует товар: ${productContext.title} (${productContext.price.toLocaleString('ru-RU')} ₽)`)}
                    >
                      Спросить про этот товар
                    </Button>
                  </div>
                )}
                {/* Bot greeting messages */}
                <div className="flex justify-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="h-4 w-4 text-accent" />
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-2xl px-4 py-2 bg-card text-foreground border border-border rounded-bl-md">
                      <p className="text-sm">Здравствуйте! 👋</p>
                    </div>
                    <div className="rounded-2xl px-4 py-2 bg-card text-foreground border border-border rounded-bl-md">
                      <p className="text-sm">Вам помочь подобрать деталь?</p>
                    </div>
                  </div>
                </div>
                {/* Quick reply buttons */}
                <div className="flex justify-center gap-3 mt-6">
                  <Button
                    variant="default"
                    size="lg"
                    className="rounded-full px-8"
                    onClick={() => handleSend("Да, помогите подобрать деталь")}
                  >
                    Да, помогите
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="rounded-full px-8"
                    onClick={() => handleSend("Нет, я просто смотрю")}
                  >
                    Нет, спасибо
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
                  <Clock className="h-8 w-8 text-warning" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">Сейчас нерабочее время</h3>
                  <p className="text-muted-foreground text-sm max-w-xs">
                    Чат работает ежедневно с 9:00 до 19:00 (по читинскому времени). Мы обязательно ответим вам в рабочие часы!
                  </p>
                </div>
                <Link to="/contacts">
                  <Button variant="outline" className="mt-2">
                    Оставить заявку
                  </Button>
                </Link>
              </div>
            )
          ) : (
            messages.map((m) => (
              <ChatMessageBubble
                key={m.id}
                message={m}
                formatTime={formatTime}
                getRelativeReadTime={getRelativeReadTime}
              />
            ))
          )}

          {/* Manager countdown timer */}
          {waitingSince && !adminJoined && !declinedHelp && threadStatus !== 'closed' && (
            <ManagerCountdown waitingSince={waitingSince} />
          )}

          {/* Button to start conversation after declining */}
          {declinedHelp && (
            <div className="flex justify-center mt-4">
              <Button
                variant="default"
                onClick={() => {
                  setDeclinedHelp(false);
                  setMessages([]);
                  processedMsgIds.current.clear();
                }}
              >
                Написать сообщение
              </Button>
            </div>
          )}
          
          {adminTyping && (
            <div className="flex justify-start gap-2">
              <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0 mt-1">
                <Headset className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          {showRating && (
            <div className="bg-card border border-border rounded-xl p-6 text-center max-w-sm mx-auto">
              <p className="font-medium mb-3">Оцените работу оператора</p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => submitRating(star)}
                    className="p-1.5 hover:scale-125 transition-transform"
                  >
                    <Star className="h-8 w-8 text-warning hover:fill-warning transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {threadStatus === 'closed' && rating && (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-2">Чат завершён</p>
              <Button onClick={startNewChat} variant="outline">
                Начать новый чат
              </Button>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      {!showHistory && threadStatus !== 'closed' && !declinedHelp && (messages.length > 0 || !isOnline) && (
        <div className="bg-card border-t border-border p-3 sm:p-4 shrink-0">
          <div className="container max-w-2xl mx-auto">
            {!isOnline ? (
              <div className="text-center py-2">
                <p className="text-sm text-muted-foreground mb-3 flex items-center justify-center gap-2">
                  <Clock className="h-4 w-4 text-warning" />
                  Нерабочее время — ввод сообщений недоступен
                </p>
                <div className="flex gap-3 justify-center">
                  <Link to="/contacts">
                    <Button size="default" className="rounded-xl px-6 gap-2">
                      <FileText className="h-4 w-4" />
                      Оставить заявку
                    </Button>
                  </Link>
                  <Link to="/expert-help">
                    <Button size="default" variant="outline" className="rounded-xl px-6">
                      Помощь эксперта
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {imagePreview && (
                  <div className="mb-3 relative inline-block">
                    <img src={imagePreview} alt="Preview" className="h-20 rounded-lg" />
                    <button
                      onClick={clearSelectedImage}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
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
                  className="flex items-center gap-2"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                    accept="image/*"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <ImagePlus className="h-5 w-5" />
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
                    className="flex-1"
                    disabled={isUploading}
                  />
                  <EmojiPicker onSelect={(emoji) => setInput(prev => prev + emoji)} />
                  <Button type="submit" disabled={(!input.trim() && !selectedImage) || isUploading}>
                    {isUploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
