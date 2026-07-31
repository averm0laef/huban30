import { useEffect, useState, useRef } from "react";
import { Send, User, Clock, Bell, BellOff, Trash2, Star, CheckCircle, Timer, Check, CheckCheck, MessageCircle, Square, CheckSquare, ArrowLeft, Bot as BotIcon, EyeOff, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { isChatAvailable } from "@/hooks/useStoreStatus";
import { useAuth } from "@/contexts/AuthContext";

interface ChatThread {
  id: string;
  user_id: string | null;
  guest_session_id: string | null;
  status: string;
  last_message_at: string | null;
  created_at: string;
  rating?: number | null;
  closed_at?: string | null;
  waiting_since?: string | null;
  last_user_message_at?: string | null;
  profile?: { full_name: string | null; email: string | null };
  unread_count?: number;
}

interface ChatMessage {
  id: string;
  thread_id: string;
  sender: string;
  content: string;
  created_at: string;
  is_read?: boolean;
  read_at?: string;
  delivered_at?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}

const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
    
    setTimeout(() => {
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.value = 1000;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      osc2.start(audioContext.currentTime);
      osc2.stop(audioContext.currentTime + 0.3);
    }, 150);
  } catch (e) {
    console.log('Audio not supported');
  }
};

const normalizeChatMessage = (msg: ChatMessage): ChatMessage => {
  const metadata = msg.metadata as { bot?: boolean } | null;
  if (msg.sender === "system" && metadata?.bot) {
    return { ...msg, sender: "bot" };
  }
  return msg;
};

export default function AdminChat() {
  const { isSuperAdmin } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [now, setNow] = useState(new Date());
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [hideBotMessages, setHideBotMessages] = useState(false);
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const processedMsgIds = useRef<Set<string>>(new Set());
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update time every 10 seconds for waiting timer and read timestamps
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setIsOnline(isChatAvailable());
    const interval = setInterval(() => setIsOnline(isChatAvailable()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetchThreads();
    
    const globalChannel = supabase
      .channel('admin-global-messages')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'chat_messages' 
      }, (payload) => {
        const msg = payload.new as ChatMessage;
        if (msg.sender === 'user' && soundEnabled) {
          playNotificationSound();
          toast({
            title: "Новое сообщение",
            description: msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : ''),
          });
        }
      })
      .subscribe();

    const threadChannel = supabase
      .channel('admin-threads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, () => fetchThreads())
      .subscribe();
    
    return () => { 
      supabase.removeChannel(globalChannel);
      supabase.removeChannel(threadChannel); 
    };
  }, [soundEnabled]);

  useEffect(() => {
    if (!selectedThread) return;
    
    const channel = supabase
      .channel(`admin-msg-${selectedThread.id}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'chat_messages', 
        filter: `thread_id=eq.${selectedThread.id}` 
      }, (payload) => {
        const m = normalizeChatMessage(payload.new as ChatMessage);
        if (!processedMsgIds.current.has(m.id)) {
          processedMsgIds.current.add(m.id);
          setMessages(prev => [...prev, m]);
          // Confirm delivery of user messages to the server
          if (m.sender === 'user') {
            supabase.rpc('mark_messages_delivered', {
              p_thread_id: selectedThread.id,
              p_sender: 'user',
            }).then(() => {});
          }
        }
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'chat_messages', 
        filter: `thread_id=eq.${selectedThread.id}` 
      }, (payload) => {
        const updated = payload.new as ChatMessage;
        setMessages(prev => prev.map(msg => 
          msg.id === updated.id
            ? { ...msg, is_read: updated.is_read, read_at: updated.read_at, delivered_at: updated.delivered_at }
            : msg
        ));
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'chat_threads', 
        filter: `id=eq.${selectedThread.id}` 
      }, (payload) => {
        const updated = payload.new as ChatThread;
        setSelectedThread(prev => prev ? { ...prev, ...updated } : null);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedThread?.id]);

  const fetchThreads = async () => {
    const { data } = await supabase.from('chat_threads').select('*').order('last_message_at', { ascending: false });
    const t = await Promise.all((data || []).map(async (th) => {
      let profile = null;
      if (th.user_id) {
        const { data: p } = await supabase.from('profiles').select('full_name, email').eq('user_id', th.user_id).maybeSingle();
        profile = p;
      }
      // Get unread count (messages from user not read by admin) - only for non-closed chats
      let unread_count = 0;
      if (th.status !== 'closed') {
        const { count } = await supabase
          .from('chat_messages')
          .select('*', { count: 'exact', head: true })
          .eq('thread_id', th.id)
          .eq('sender', 'user')
          .eq('is_read', false);
        unread_count = count || 0;
      }
      
      return { ...th, profile, unread_count };
    }));
    setThreads(t);
    setIsLoading(false);
  };

  const markMessagesAsRead = async (threadId: string) => {
    // Mark user messages as read by admin
    await supabase.rpc('mark_messages_delivered', {
      p_thread_id: threadId,
      p_sender: 'user'
    });
    await supabase.rpc('mark_messages_as_read', { 
      p_thread_id: threadId, 
      p_sender: 'user' 
    });
    fetchThreads();
  };

  const handleSelectThread = async (thread: ChatThread) => {
    setSelectedThread(thread);
    processedMsgIds.current.clear();
    const { data } = await supabase.from('chat_messages').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true });
    const msgs = data || [];
    msgs.forEach(m => processedMsgIds.current.add(m.id));
    setMessages(msgs.map(normalizeChatMessage));
    // Mark messages as read when admin opens thread
    markMessagesAsRead(thread.id);
  };

  // Update typing status
  const updateTypingStatus = async (isTyping: boolean) => {
    if (!selectedThread) return;
    
    await supabase
      .from('chat_threads')
      .update({ 
        admin_typing: isTyping,
        admin_typing_at: isTyping ? new Date().toISOString() : null
      })
      .eq('id', selectedThread.id);
  };

  const handleTyping = (value: string) => {
    setNewMessage(value);
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Set typing to true
    if (value.trim()) {
      updateTypingStatus(true);
      
      // Auto-reset typing after 3 seconds of no input
      typingTimeoutRef.current = setTimeout(() => {
        updateTypingStatus(false);
      }, 3000);
    } else {
      updateTypingStatus(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedThread) return;
    
    // Clear typing status
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    updateTypingStatus(false);
    
    const msgId = crypto.randomUUID();
    const messageContent = newMessage.trim();
    processedMsgIds.current.add(msgId);
    
    await supabase.from('chat_messages').insert({ thread_id: selectedThread.id, sender: 'admin', content: messageContent });
    await supabase.from('chat_threads').update({ last_message_at: new Date().toISOString(), status: 'active', waiting_since: null }).eq('id', selectedThread.id);
    setNewMessage("");

    // Notify user via Telegram if they're authenticated with Telegram
    try {
      await supabase.functions.invoke('notify-telegram', {
        body: {
          action: 'notify_user',
          threadId: selectedThread.id,
          message: messageContent.length > 100 ? messageContent.slice(0, 100) + '...' : messageContent,
        },
      });
    } catch (notifyError) {
      console.log('User Telegram notification failed (non-critical):', notifyError);
    }
  };

  const closeThread = async () => {
    if (!selectedThread) return;
    await supabase.from('chat_threads').update({ 
      status: 'closed'
    } as any).eq('id', selectedThread.id);
    
    // System message only for admin view, not shown to client
    await supabase.from('chat_messages').insert({ 
      thread_id: selectedThread.id, 
      sender: 'system', 
      content: 'Чат закрыт',
      metadata: { adminOnly: true }
    });
    
    setSelectedThread(prev => prev ? { ...prev, status: 'closed' } : null);
    toast({ title: "Чат закрыт" });
    fetchThreads();
  };

  const deleteAllClosedThreads = async () => {
    const closedThreads = threads.filter(t => t.status === 'closed');
    
    for (const thread of closedThreads) {
      // Delete mappings first
      await supabase.from('telegram_thread_mapping').delete().eq('chat_thread_id', thread.id);
      // Delete guest contacts
      await supabase.from('guest_contacts').delete().eq('thread_id', thread.id);
      // Delete messages
      await supabase.from('chat_messages').delete().eq('thread_id', thread.id);
      // Delete thread
      await supabase.from('chat_threads').delete().eq('id', thread.id);
    }
    
    if (selectedThread && selectedThread.status === 'closed') {
      setSelectedThread(null);
      setMessages([]);
    }
    
    toast({ title: `Удалено ${closedThreads.length} закрытых чатов` });
    fetchThreads();
  };

  const deleteThread = async (threadId: string) => {
    // Delete mappings first
    await supabase.from('telegram_thread_mapping').delete().eq('chat_thread_id', threadId);
    // Delete guest contacts
    await supabase.from('guest_contacts').delete().eq('thread_id', threadId);
    // Delete messages
    await supabase.from('chat_messages').delete().eq('thread_id', threadId);
    // Delete thread
    await supabase.from('chat_threads').delete().eq('id', threadId);
  };

  const deleteSelectedThreads = async () => {
    const threadsToDelete = threads.filter(t => selectedThreadIds.has(t.id));
    
    // Check if any active threads are selected (only super admin can delete active)
    const hasActiveThreads = threadsToDelete.some(t => t.status !== 'closed');
    if (hasActiveThreads && !isSuperAdmin) {
      toast({ 
        title: "Недостаточно прав", 
        description: "Только суперадмин может удалять активные чаты",
        variant: "destructive"
      });
      return;
    }
    
    for (const thread of threadsToDelete) {
      await deleteThread(thread.id);
    }
    
    if (selectedThread && selectedThreadIds.has(selectedThread.id)) {
      setSelectedThread(null);
      setMessages([]);
    }
    
    toast({ title: `Удалено ${threadsToDelete.length} чатов` });
    setSelectedThreadIds(new Set());
    setIsSelectionMode(false);
    fetchThreads();
  };

  const deleteSingleThread = async () => {
    if (!selectedThread) return;
    
    // Check if active thread (only super admin can delete active)
    if (selectedThread.status !== 'closed' && !isSuperAdmin) {
      toast({ 
        title: "Недостаточно прав", 
        description: "Только суперадмин может удалять активные чаты",
        variant: "destructive"
      });
      return;
    }
    
    await deleteThread(selectedThread.id);
    
    setSelectedThread(null);
    setMessages([]);
    toast({ title: "Чат удалён" });
    fetchThreads();
  };

  const toggleThreadSelection = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedThreadIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(threadId)) {
        newSet.delete(threadId);
      } else {
        newSet.add(threadId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedThreadIds.size === filteredThreads.length) {
      setSelectedThreadIds(new Set());
    } else {
      setSelectedThreadIds(new Set(filteredThreads.map(t => t.id)));
    }
  };

  const canDeleteSelected = () => {
    const hasActiveThreads = threads.filter(t => selectedThreadIds.has(t.id)).some(t => t.status !== 'closed');
    return isSuperAdmin || !hasActiveThreads;
  };

  const getStatusBadge = (s: string, hasAdminReplied: boolean = false) => {
    if (s === 'new' || s === 'waiting') {
      if (hasAdminReplied) {
        return <Badge className="bg-green-500 hover:bg-green-600">В работе</Badge>;
      }
      return <Badge variant="destructive">Ожидает</Badge>;
    }
    if (s === 'active') return <Badge className="bg-green-500 hover:bg-green-600">В работе</Badge>;
    if (s === 'closed') return <Badge variant="outline">Закрыт</Badge>;
    return <Badge variant="outline">{s}</Badge>;
  };

  const formatTime = (d: string) => new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const formatTimeWithSeconds = (d: string) => new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const getName = (t: ChatThread) => t.profile?.full_name || t.profile?.email || (t.guest_session_id ? `Гость ${t.guest_session_id.slice(0,8)}` : "Неизвестный");
  
  const getRelativeReadTime = (readAt: string | undefined) => {
    if (!readAt) return null;
    const readDate = new Date(readAt);
    const diffMs = now.getTime() - readDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) return `${diffSec} сек. назад`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} мин. назад`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} ч. назад`;
    return formatTimeWithSeconds(readAt);
  };
  
  const getWaitingTime = (waitingSince: string | null | undefined) => {
    if (!waitingSince) return null;
    const start = new Date(waitingSince);
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "< 1 мин";
    if (diffMins < 60) return `${diffMins} мин`;
    
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours < 24) return `${hours}ч ${mins}м`;
    
    const days = Math.floor(hours / 24);
    return `${days}д ${hours % 24}ч`;
  };

  const filteredThreads = threads
    .filter(t => {
      if (statusFilter === "all") return true;
      if (statusFilter === "active") return t.status === "active" || t.status === "new" || t.status === "waiting";
      return t.status === statusFilter;
    })
    .sort((a, b) => {
      // Waiting threads first, sorted by waiting time (longest first)
      const aIsWaiting = a.status === 'new' || a.status === 'waiting';
      const bIsWaiting = b.status === 'new' || b.status === 'waiting';
      
      if (aIsWaiting && !bIsWaiting) return -1;
      if (!aIsWaiting && bIsWaiting) return 1;
      
      if (aIsWaiting && bIsWaiting) {
        const aTime = a.waiting_since ? new Date(a.waiting_since).getTime() : 0;
        const bTime = b.waiting_since ? new Date(b.waiting_since).getTime() : 0;
        return aTime - bTime; // Earlier = waiting longer = first
      }
      
      // For non-waiting, sort by last message (most recent first)
      const aLast = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bLast = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bLast - aLast;
    });

  const statusCounts = {
    all: threads.length,
    active: threads.filter(t => t.status === "active" || t.status === "new" || t.status === "waiting").length,
    closed: threads.filter(t => t.status === "closed").length,
  };

  // Count threads waiting more than 5 minutes
  const longWaitingCount = threads.filter(t => {
    if (t.status !== 'new' && t.status !== 'waiting') return false;
    if (!t.waiting_since) return false;
    const waitMs = now.getTime() - new Date(t.waiting_since).getTime();
    return waitMs > 5 * 60 * 1000;
  }).length;

  const isLongWaiting = (waitingSince: string | null | undefined) => {
    if (!waitingSince) return false;
    const waitMs = now.getTime() - new Date(waitingSince).getTime();
    return waitMs > 5 * 60 * 1000;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] min-h-[400px] md:min-h-[500px] max-h-[800px]">
      {/* Long waiting warning */}
      {longWaitingCount > 0 && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-destructive animate-pulse shrink-0">
          <Timer className="h-5 w-5" />
          <span className="font-medium">
            {longWaitingCount} {longWaitingCount === 1 ? 'чат ожидает' : 'чата ожидают'} ответа более 5 минут!
          </span>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-display font-bold">Чат с клиентами</h1>
          {!isOnline && (
            <Badge variant="outline" className="text-warning border-warning">
              <Clock className="h-3 w-3 mr-1" />
              Нерабочее время
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Selection mode controls */}
          {isSelectionMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedThreadIds(new Set());
                }}
              >
                Отмена
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleSelectAll}
              >
                {selectedThreadIds.size === filteredThreads.length ? "Снять все" : "Выбрать все"}
              </Button>
              {selectedThreadIds.size > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={!canDeleteSelected()}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Удалить ({selectedThreadIds.size})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить выбранные чаты?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Это действие нельзя отменить. {selectedThreadIds.size} чатов и их сообщения будут удалены безвозвратно.
                        {!isSuperAdmin && threads.filter(t => selectedThreadIds.has(t.id)).some(t => t.status !== 'closed') && (
                          <span className="block mt-2 text-destructive">
                            Внимание: активные чаты могут удалять только суперадмины.
                          </span>
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={deleteSelectedThreads} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Удалить
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsSelectionMode(true)}
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                Выбрать
              </Button>
              {statusFilter === 'closed' && statusCounts.closed > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Удалить все закрытые
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить все закрытые чаты?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Это действие нельзя отменить. Все {statusCounts.closed} закрытых чатов и их сообщения будут удалены безвозвратно.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={deleteAllClosedThreads} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Удалить все
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          )}
          <Button 
            variant={soundEnabled ? "default" : "outline"} 
            size="sm"
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled ? <Bell className="h-4 w-4 mr-2" /> : <BellOff className="h-4 w-4 mr-2" />}
            {soundEnabled ? "Звук вкл" : "Звук выкл"}
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Thread list - hidden on mobile when thread is selected */}
        <Card className={`lg:col-span-1 overflow-hidden flex flex-col max-h-full ${selectedThread ? 'hidden lg:flex' : 'flex'}`}>
          {/* Filter tabs */}
          <div className="p-2 border-b flex gap-1 shrink-0">
            <button
              onClick={() => setStatusFilter("all")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === "all" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
            >
              Все ({statusCounts.all})
            </button>
            <button
              onClick={() => setStatusFilter("active")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === "active" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
            >
              Активные ({statusCounts.active})
            </button>
            <button
              onClick={() => setStatusFilter("closed")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === "closed" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
            >
              Закрытые ({statusCounts.closed})
            </button>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
              ) : filteredThreads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Нет чатов</div>
              ) : (
                filteredThreads.map((t) => {
                  const longWait = (t.status === 'new' || t.status === 'waiting') && isLongWaiting(t.waiting_since);
                  const isSelected = selectedThreadIds.has(t.id);
                  return (
                  <div 
                    key={t.id} 
                    className={`w-full p-3 rounded-lg text-left transition-colors flex items-start gap-2 ${
                      selectedThread?.id === t.id 
                        ? "bg-primary/10" 
                        : isSelected
                          ? "bg-primary/20"
                          : longWait 
                            ? "bg-destructive/10 hover:bg-destructive/15 border border-destructive/30" 
                            : "hover:bg-secondary"
                    }`}
                  >
                    {isSelectionMode && (
                      <div 
                        className="flex items-center justify-center pt-1 cursor-pointer"
                        onClick={(e) => toggleThreadSelection(t.id, e)}
                      >
                        <Checkbox 
                          checked={isSelected}
                          onCheckedChange={() => {}}
                          className="pointer-events-none"
                        />
                      </div>
                    )}
                    <button
                      onClick={() => isSelectionMode ? toggleThreadSelection(t.id, { stopPropagation: () => {} } as React.MouseEvent) : handleSelectThread(t)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{getName(t)}</span>
                          {t.unread_count && t.unread_count > 0 && (
                            <Badge className="bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center">
                              {t.unread_count}
                            </Badge>
                          )}
                        </div>
                        {getStatusBadge(t.status)}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {t.last_message_at ? formatTime(t.last_message_at) : "—"}
                        </div>
                        <div className="flex items-center gap-2">
                          {(t.status === 'new' || t.status === 'waiting') && t.waiting_since && (
                            <div className="flex items-center gap-1 text-destructive">
                              <Timer className="h-3 w-3" />
                              <span className="font-medium">{getWaitingTime(t.waiting_since)}</span>
                            </div>
                          )}
                          {t.status === 'active' && t.last_message_at && (
                            <div className="flex items-center gap-1 text-green-600">
                              <Timer className="h-3 w-3" />
                              <span className="font-medium">{getWaitingTime(t.last_message_at)}</span>
                            </div>
                          )}
                          {t.rating && (
                            <div className="flex items-center gap-0.5">
                              {[1,2,3,4,5].map(s => (
                                <Star key={s} className={`h-3 w-3 ${s <= t.rating! ? "text-warning fill-warning" : "text-muted-foreground"}`} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </Card>
        
        {/* Chat area - hidden on mobile when no thread selected */}
        <Card className={`lg:col-span-2 overflow-hidden flex flex-col max-h-full ${selectedThread ? 'flex' : 'hidden lg:flex'}`}>
          {selectedThread ? (
            <>
              <div className="p-3 md:p-4 border-b flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 md:gap-3">
                  {/* Mobile back button */}
                  <button 
                    onClick={() => setSelectedThread(null)}
                    className="lg:hidden p-2 -ml-2 hover:bg-secondary rounded-lg"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm md:text-base truncate">{getName(selectedThread)}</p>
                    <p className="text-xs text-muted-foreground truncate">{selectedThread.profile?.email || "Гость"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 md:gap-2 flex-wrap">
                  {selectedThread.rating && (
                    <div className="hidden md:flex items-center gap-1 text-sm">
                      <span className="text-muted-foreground">Оценка:</span>
                      <div className="flex">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} className={`h-4 w-4 ${s <= selectedThread.rating! ? "text-warning fill-warning" : "text-muted-foreground"}`} />
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedThread.status !== 'closed' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs md:text-sm">
                          <CheckCircle className="h-4 w-4 md:mr-1" />
                          <span className="hidden md:inline">Закрыть чат</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Закрыть чат?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Клиент получит уведомление о закрытии чата и сможет оценить работу оператора.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={closeThread}>Закрыть</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {selectedThread.status === 'closed' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" className="text-xs md:text-sm">
                          <Trash2 className="h-4 w-4 md:mr-1" />
                          <span className="hidden md:inline">Удалить</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Удалить чат?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Это действие нельзя отменить. Все сообщения будут удалены безвозвратно.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={deleteSingleThread} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Удалить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
              
              <ScrollArea className="flex-1 p-2 md:p-4">
                <div className="space-y-3">
                  {/* Hide bot toggle */}
                  <div className="flex justify-center mb-2">
                    <button
                      onClick={() => setHideBotMessages(!hideBotMessages)}
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-3 py-1 rounded-full bg-secondary/50"
                    >
                      {hideBotMessages ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      {hideBotMessages ? "Показать сообщения бота" : "Скрыть сообщения бота"}
                    </button>
                  </div>
                  {messages
                    .filter(m => !(hideBotMessages && m.sender === 'bot'))
                    .map((m) => {
                    const imageUrl = (m.metadata as { imageUrl?: string } | null)?.imageUrl;
                    return (
                    <div key={m.id} className={`flex ${m.sender === "admin" ? "justify-end" : "justify-start"} gap-2`}>
                      {m.sender === "bot" && (
                        <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-1">
                          <BotIcon className="h-3.5 w-3.5 text-accent" />
                        </div>
                      )}
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                        m.sender === "admin" 
                          ? "bg-primary text-primary-foreground rounded-br-md" 
                          : m.sender === "system" 
                          ? "bg-warning/20 text-foreground rounded-bl-md" 
                          : m.sender === "bot"
                          ? "bg-accent/10 text-foreground border border-accent/20 rounded-bl-md"
                          : "bg-secondary text-foreground rounded-bl-md"
                      }`}>
                        {m.sender === "bot" && (
                          <p className="text-[11px] font-medium text-accent mb-0.5">🤖 Свечка (ИИ)</p>
                        )}
                        {imageUrl && (
                          <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block mb-2">
                            <img 
                              src={imageUrl} 
                              alt="Изображение" 
                              className="max-w-full max-h-48 rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            />
                          </a>
                        )}
                        {m.content && m.content !== '📷 Фото' && (
                          m.sender === 'bot' ? (
                            <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1">
                              <ReactMarkdown>{m.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                          )
                        )}
                        {m.content === '📷 Фото' && !imageUrl && (
                          <p className="text-sm">{m.content}</p>
                        )}
                        <div className={`flex flex-col gap-0.5 ${m.sender === "admin" ? "items-end" : "items-start"}`}>
                          <div className="flex items-center gap-1">
                            <span className={`text-[10px] ${m.sender === "admin" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                              {formatTime(m.created_at)}
                            </span>
                            {m.sender === "admin" && (
                              m.is_read ? (
                                <CheckCheck className="h-3 w-3 text-green-400" />
                              ) : (
                                <Check className="h-3 w-3 text-primary-foreground/60" />
                              )
                            )}
                          </div>
                          {m.sender === "admin" && m.is_read && m.read_at && (
                            <span className="text-[9px] text-green-400">
                              Прочитано {formatTimeWithSeconds(m.read_at)} ({getRelativeReadTime(m.read_at)})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
              
              {selectedThread.status !== 'closed' ? (
                <div className="border-t">
                  {/* Quick reply buttons */}
                  <div className="px-2 pt-2 flex flex-wrap gap-1.5">
                    {[
                      { label: "👋 Приветствие", text: "Здравствуйте! Меня зовут __, чем могу помочь?" },
                      { label: "📦 Наличие", text: "Уточняю наличие, одну минуту..." },
                      { label: "💰 Цена", text: "Стоимость данной позиции составляет __ ₽" },
                      { label: "🚚 Доставка", text: "Доставка осуществляется в течение __ дней. Стоимость — __ ₽" },
                      { label: "✅ Заказ оформлен", text: "Заказ оформлен! Номер заказа: __. Ожидайте подтверждения." },
                      { label: "🔧 Подбор", text: "Для подбора запчасти уточните, пожалуйста, марку, модель и год выпуска авто." },
                    ].map((tpl) => (
                      <button
                        key={tpl.label}
                        type="button"
                        onClick={() => setNewMessage(tpl.text)}
                        className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-secondary/50 hover:bg-secondary text-foreground transition-colors whitespace-nowrap"
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                  <div className="p-2 md:p-3">
                    <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
                      <Input 
                        value={newMessage} 
                        onChange={(e) => handleTyping(e.target.value)} 
                        placeholder="Введите ответ..." 
                        className="flex-1 text-sm md:text-base" 
                      />
                      <Button type="submit" disabled={!newMessage.trim()} size="sm" className="md:px-4">
                        <Send className="h-4 w-4 md:mr-2" />
                        <span className="hidden md:inline">Отправить</span>
                      </Button>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="p-4 border-t bg-secondary/30 text-center text-muted-foreground">
                  <p>Чат закрыт</p>
                  {selectedThread.rating && (
                    <div className="flex items-center justify-center gap-1 mt-2">
                      <span className="text-sm">Оценка клиента:</span>
                      <div className="flex">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} className={`h-5 w-5 ${s <= selectedThread.rating! ? "text-warning fill-warning" : "text-muted-foreground"}`} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <CardContent className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Выберите чат</p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
