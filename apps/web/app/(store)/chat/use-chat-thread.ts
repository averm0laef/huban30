"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { StorefrontApiError, errorText } from "../_lib/storefront-api";
import {
  accessFor,
  downloadChatAttachmentBlob,
  isChatMessage,
  isChatThreadAssignment,
  isOwnMessage,
  latestSequence,
  loadLatestHistory,
  loadOlderHistory,
  markChatMessageRead,
  mergeMessages,
  reconnectDelay,
  renderedMessageWindow,
  safeDownloadName,
  sendChatMessageRest,
  uploadChatAttachment,
  type ChatAccess,
  type ChatAttachment,
  type ChatMessage,
  type ChatThread,
  type ConnectionState,
} from "./chat-state";
import { randomUuid } from "../../_lib/browser-crypto";

export interface SendOutcome {
  /** The server rejected the send because the thread is closed (HTTP 409). */
  closed: boolean;
  ok: boolean;
}

export interface UseChatThreadResult {
  /** Live from the server (`ChatThreadAssignment`) — null until a staff member actually takes the thread. Never inferred. */
  assignedStaffId: string | null;
  /** The assignee's display name, only ever set alongside a real `assignedStaffId`. */
  assignedStaffName: string | null;
  managerWaitSince: string | null | undefined;
  connection: ConnectionState;
  connectionError: string;
  downloadAttachment: (attachment: ChatAttachment) => Promise<void>;
  downloadError: string;
  fileError: string;
  filePending: boolean;
  hasOlderMessages: boolean;
  historyError: string;
  historyLoading: boolean;
  loadOlderMessages: () => Promise<void>;
  lastStaffReadMessageId: string | null;
  messages: ChatMessage[];
  newerMessageCount: number;
  olderHistoryError: string;
  olderHistoryLoading: boolean;
  renderedMessages: ChatMessage[];
  resetFileAttempt: () => void;
  resetSendAttempt: () => void;
  retryHistory: () => void;
  sendAttemptId: string | null;
  sendError: string;
  sendMessage: (body: string) => Promise<SendOutcome>;
  sendPending: boolean;
  showLatestMessages: () => void;
  /** Server-confirmed thread status, seeded from the `thread` prop and kept live over the socket (e.g. staff closing the thread elsewhere). */
  threadStatus: ChatThread["status"] | null;
  unreadCount: number;
  uploadAttachment: (file: File) => Promise<boolean>;
  viewingLatest: boolean;
}

/**
 * Owns one thread's realtime channel: history bootstrap, WebSocket
 * subscribe/reconnect, idempotent send, attachment upload/download and
 * read receipts. Both the full `/chat` page and the floating widget
 * mount this over whichever single thread they're currently showing, so
 * the WebSocket protocol (docs/CHAT_AND_ADAPTERS.md) only has one
 * implementation.
 *
 * `isVisible` additionally gates read receipts and unread counting — the
 * page passes `true` (it only cares about tab visibility, handled
 * internally), the widget passes whether its panel is actually open.
 */
export function useChatThread(
  thread: ChatThread | null,
  viewerKind: "customer" | "guest" | null,
  isVisible: boolean,
): UseChatThreadResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [olderHistoryLoading, setOlderHistoryLoading] = useState(false);
  const [olderHistoryError, setOlderHistoryError] = useState("");
  const [historyView, setHistoryView] = useState<"latest" | "older">("latest");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [connectionError, setConnectionError] = useState("");
  const [lastStaffReadMessageId, setLastStaffReadMessageId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [assignedStaffId, setAssignedStaffId] = useState<string | null>(null);
  const [assignedStaffName, setAssignedStaffName] = useState<string | null>(null);
  const [managerWaitSince, setManagerWaitSince] = useState<string | null | undefined>(undefined);
  const [threadStatus, setThreadStatus] = useState<ChatThread["status"] | null>(null);

  const [sendAttemptId, setSendAttemptId] = useState<string | null>(null);
  const [sendPending, setSendPending] = useState(false);
  const [sendError, setSendError] = useState("");

  const [fileAttempt, setFileAttempt] = useState<{ fingerprint: string; id: string } | null>(null);
  const [filePending, setFilePending] = useState(false);
  const [fileError, setFileError] = useState("");

  const [downloadError, setDownloadError] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const cursorRef = useRef("0");
  const sendInFlight = useRef(false);
  const uploadInFlight = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const historyViewRef = useRef<"latest" | "older">("latest");
  const activeThreadIdRef = useRef<string | null>(null);
  const olderLoadInFlight = useRef(false);
  const isVisibleRef = useRef(isVisible);
  const markLatestReadRef = useRef<((incoming: ChatMessage[], socket?: WebSocket | null) => void) | null>(null);
  const ackWaiters = useRef(new Map<string, {
    reject: (error: Error) => void;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }>());

  // Keep a live ref so the connection effect (which must not restart every
  // time the panel opens/closes) can still read the current visibility.
  useEffect(() => {
    isVisibleRef.current = isVisible;
    if (isVisible && historyViewRef.current === "latest") {
      setUnreadCount(0);
      markLatestReadRef.current?.(messagesRef.current, socketRef.current);
    }
  }, [isVisible]);

  const renderedMessages = useMemo(
    () => renderedMessageWindow(messages, historyView),
    [historyView, messages],
  );
  const newerMessageCount = historyView === "older"
    ? Math.max(0, messages.length - renderedMessages.length)
    : 0;

  // Thread lists may be refreshed or restored twice during development's
  // effect replay. Replacing a thread object or its subject must not reset
  // the conversation, loaded older pages, or the realtime subscription.
  const threadId = thread?.id ?? null;
  const guestToken = thread?.guestToken ?? null;
  const readThreadSnapshot = useEffectEvent(() => thread);

  useEffect(() => {
    const thread = readThreadSnapshot();
    const access = thread && viewerKind ? accessFor({ kind: viewerKind }, thread) : null;
    if (!thread || !access) {
      activeThreadIdRef.current = null;
      messagesRef.current = [];
      setMessages([]);
      setConnection("idle");
      setConnectionError("");
      setHistoryError("");
      setHistoryLoading(false);
      setOlderCursor(null);
      setOlderHistoryLoading(false);
      setOlderHistoryError("");
      historyViewRef.current = "latest";
      setHistoryView("latest");
      setLastStaffReadMessageId(null);
      setUnreadCount(0);
      setAssignedStaffId(null);
      setAssignedStaffName(null);
      setManagerWaitSince(undefined);
      setThreadStatus(null);
      return;
    }
    const activeThread = thread;
    const activeAccess = access;
    activeThreadIdRef.current = activeThread.id;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let lastReadMessageId = "";
    let readInFlightMessageId = "";
    messagesRef.current = [];
    setMessages([]);
    setUnreadCount(0);
    setHistoryLoading(true);
    setHistoryError("");
    setOlderCursor(null);
    setOlderHistoryLoading(false);
    setOlderHistoryError("");
    historyViewRef.current = "latest";
    setHistoryView("latest");
    setConnectionError("");
    setLastStaffReadMessageId(null);
    setConnection("connecting");
    // Optimistic seed from the thread we already have — guest threads read
    // from localStorage always carry a nulled assignedStaffId (see
    // parseGuestThread), so this is only ever a safe "not connected"
    // default. The subscribe response below reconciles it against the
    // server moments later, and every reconnect does the same.
    setAssignedStaffId(activeThread.assignedStaffId);
    setAssignedStaffName(null);
    setManagerWaitSince(activeThread.managerWaitSince);
    setThreadStatus(activeThread.status);
    cursorRef.current = "0";

    function rejectAcks(message: string): void {
      for (const waiter of ackWaiters.current.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(message));
      }
      ackWaiters.current.clear();
    }

    function countUnread(incoming: ChatMessage[]): void {
      if (isVisibleRef.current && historyViewRef.current === "latest") return;
      const unread = incoming.filter((message) => !isOwnMessage(message)).length;
      if (unread > 0) setUnreadCount((count) => count + unread);
    }

    function markLatestRead(incoming: ChatMessage[], preferredSocket?: WebSocket | null): void {
      if (!isVisibleRef.current
        || historyViewRef.current !== "latest"
        || document.visibilityState !== "visible") return;
      const latest = [...incoming].reverse().find((message) => !isOwnMessage(message));
      if (!latest || latest.id === lastReadMessageId || latest.id === readInFlightMessageId) return;
      if (preferredSocket?.readyState === WebSocket.OPEN) {
        lastReadMessageId = latest.id;
        preferredSocket.send(JSON.stringify({ messageId: latest.id, type: "receipt.read" }));
      } else {
        readInFlightMessageId = latest.id;
        void markChatMessageRead(activeThread, activeAccess, latest.id)
          .then(() => { if (active) lastReadMessageId = latest.id; })
          .catch((caught: unknown) => { if (active) setConnectionError(errorText(caught)); })
          .finally(() => { if (readInFlightMessageId === latest.id) readInFlightMessageId = ""; });
      }
    }
    markLatestReadRef.current = markLatestRead;

    function connect(): void {
      if (!active) return;
      if (!window.navigator.onLine) {
        setConnection("offline");
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, reconnectDelay(reconnectAttempt));
        return;
      }
      setConnection(reconnectAttempt === 0 ? "connecting" : "reconnecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        socket?.send(JSON.stringify({
          afterSequence: cursorRef.current,
          ...(activeAccess.kind === "guest" ? { guestToken: activeAccess.guestToken } : {}),
          threadId: activeThread.id,
          type: "subscribe",
        }));
      });
      socket.addEventListener("message", (event) => {
        let payload: unknown;
        try { payload = JSON.parse(String(event.data)); } catch { return; }
        if (!payload || typeof payload !== "object" || !("type" in payload)) return;
        const record = payload as Record<string, unknown>;
        if (record.type === "subscribed" && Array.isArray(record.items)) {
          if (record.items.some((message) => !isChatMessage(message))) {
            setConnectionError("Сервер вернул повреждённую историю чата");
            socket?.close(1008, "invalid_payload");
            return;
          }
          const incoming = record.items as ChatMessage[];
          setMessages((current) => {
            const next = mergeMessages(current, incoming);
            messagesRef.current = next;
            return next;
          });
          cursorRef.current = typeof record.nextSequence === "string"
            ? latestSequence(cursorRef.current, record.nextSequence)
            : cursorRef.current;
          countUnread(incoming);
          reconnectAttempt = 0;
          setConnection("live");
          setConnectionError("");
          markLatestRead(incoming, socket);
          // Every (re)subscribe carries the current, real assignment — this
          // is what corrects the "safe null" guess seeded above, and what
          // self-heals the countdown after any dropped connection.
          if (isChatThreadAssignment(record.thread)) {
            setAssignedStaffId(record.thread.assignedStaffId);
            setAssignedStaffName(record.thread.assignedStaffName);
            setManagerWaitSince(record.thread.managerWaitSince);
            setThreadStatus(record.thread.status);
          }
        } else if (record.type === "thread" && isChatThreadAssignment(record)) {
          // A staff member assigned/unassigned themselves or changed status
          // while this channel was already open — apply it live, never on
          // a timer and never inferred from messages.
          setAssignedStaffId(record.assignedStaffId);
          setAssignedStaffName(record.assignedStaffName);
          setManagerWaitSince(record.managerWaitSince);
          setThreadStatus(record.status);
        } else if (record.type === "message") {
          if (!isChatMessage(record.message)) {
            setConnectionError("Сервер вернул повреждённое сообщение");
            socket?.close(1008, "invalid_payload");
            return;
          }
          const incoming = record.message;
          if (isOwnMessage(incoming)) {
            historyViewRef.current = "latest";
            setHistoryView("latest");
          }
          cursorRef.current = latestSequence(cursorRef.current, incoming.sequence);
          setMessages((current) => {
            const next = mergeMessages(current, [incoming]);
            messagesRef.current = next;
            return next;
          });
          countUnread([incoming]);
          markLatestRead([incoming], socket);
        } else if (record.type === "message.ack" && typeof record.clientMessageId === "string") {
          const waiter = ackWaiters.current.get(record.clientMessageId);
          if (waiter) {
            clearTimeout(waiter.timer);
            ackWaiters.current.delete(record.clientMessageId);
            waiter.resolve();
          }
        } else if (record.type === "receipt.read" && record.readerKind === "staff" && typeof record.messageId === "string") {
          setLastStaffReadMessageId(record.messageId);
        } else if (record.type === "error") {
          const message = typeof record.message === "string" ? record.message : "Ошибка канала чата";
          setConnectionError(message);
          rejectAcks(message);
        }
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        socketRef.current = null;
        rejectAcks("Связь прервалась. Повторите отправку тем же сообщением");
        setConnection(window.navigator.onLine ? "reconnecting" : "offline");
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, reconnectDelay(reconnectAttempt));
      });
      socket.addEventListener("error", () => {
        if (active) setConnectionError("Не удалось подключиться к чату");
      });
    }

    loadLatestHistory(activeThread, activeAccess)
      .then((history) => {
        if (!active) return;
        messagesRef.current = history.items;
        setMessages(history.items);
        setOlderCursor(history.olderCursor);
        if (history.thread) {
          setAssignedStaffId(history.thread.assignedStaffId);
          setAssignedStaffName(history.thread.assignedStaffName);
          setManagerWaitSince(history.thread.managerWaitSince);
          setThreadStatus(history.thread.status);
        }
        cursorRef.current = history.nextSequence;
        markLatestRead(history.items);
        connect();
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setHistoryError(errorText(caught));
        setConnection("error");
      })
      .finally(() => { if (active) setHistoryLoading(false); });

    const readVisible = () => {
      if (document.visibilityState === "visible") markLatestRead(messagesRef.current, socket);
    };
    document.addEventListener("visibilitychange", readVisible);
    return () => {
      active = false;
      if (activeThreadIdRef.current === activeThread.id) activeThreadIdRef.current = null;
      document.removeEventListener("visibilitychange", readVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      rejectAcks("Открыт другой чат");
      socket?.close(1000, "view_changed");
      if (socketRef.current === socket) socketRef.current = null;
      if (markLatestReadRef.current === markLatestRead) markLatestReadRef.current = null;
    };
  }, [guestToken, historyRevision, threadId, viewerKind]);

  const retryHistory = useCallback(() => setHistoryRevision((value) => value + 1), []);
  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (olderLoadInFlight.current || !thread || !olderCursor || !viewerKind) return;
    const access = accessFor({ kind: viewerKind }, thread);
    if (!access) return;
    const activeThreadId = thread.id;
    olderLoadInFlight.current = true;
    setOlderHistoryLoading(true);
    setOlderHistoryError("");
    try {
      const history = await loadOlderHistory(thread, access, olderCursor);
      if (activeThreadIdRef.current !== activeThreadId) return;
      setMessages((current) => {
        const next = mergeMessages(history.items, current);
        messagesRef.current = next;
        return next;
      });
      setOlderCursor(history.olderCursor);
      historyViewRef.current = "older";
      setHistoryView("older");
    } catch (caught) {
      if (activeThreadIdRef.current === activeThreadId) setOlderHistoryError(errorText(caught));
    } finally {
      olderLoadInFlight.current = false;
      if (activeThreadIdRef.current === activeThreadId) setOlderHistoryLoading(false);
    }
  }, [olderCursor, thread, viewerKind]);
  const showLatestMessages = useCallback(() => {
    historyViewRef.current = "latest";
    setHistoryView("latest");
    setUnreadCount(0);
    markLatestReadRef.current?.(messagesRef.current, socketRef.current);
  }, []);
  const resetSendAttempt = useCallback(() => setSendAttemptId(null), []);
  const resetFileAttempt = useCallback(() => { setFileAttempt(null); setFileError(""); }, []);

  const sendMessage = useCallback(async (body: string): Promise<SendOutcome> => {
    if (sendInFlight.current || !thread) return { closed: false, ok: false };
    const access = viewerKind ? accessFor({ kind: viewerKind }, thread) : null;
    const trimmed = body.trim();
    if (!access || !trimmed || trimmed.length > 4_000) return { closed: false, ok: false };
    const clientMessageId = sendAttemptId ?? randomUuid();
    setSendAttemptId(clientMessageId);
    sendInFlight.current = true;
    setSendPending(true);
    setSendError("");
    try {
      const socket = socketRef.current;
      if (connection === "live" && socket?.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            ackWaiters.current.delete(clientMessageId);
            reject(new Error("Сервер не подтвердил сообщение. Повторите отправку"));
          }, 8_000);
          ackWaiters.current.set(clientMessageId, { reject, resolve, timer });
          socket.send(JSON.stringify({ body: trimmed, clientMessageId, replyToId: null, type: "message.send" }));
        });
      } else {
        const created = await sendChatMessageRest(thread, access, trimmed, clientMessageId);
        setMessages((current) => {
          const next = mergeMessages(current, [created]);
          messagesRef.current = next;
          return next;
        });
        cursorRef.current = latestSequence(cursorRef.current, created.sequence);
      }
      setSendAttemptId(null);
      historyViewRef.current = "latest";
      setHistoryView("latest");
      return { closed: false, ok: true };
    } catch (caught) {
      setSendError(errorText(caught));
      const closed = caught instanceof StorefrontApiError && caught.status === 409;
      return { closed, ok: false };
    } finally {
      sendInFlight.current = false;
      setSendPending(false);
    }
  }, [connection, sendAttemptId, thread, viewerKind]);

  const uploadAttachment = useCallback(async (file: File): Promise<boolean> => {
    if (uploadInFlight.current || !thread) return false;
    const access = viewerKind ? accessFor({ kind: viewerKind }, thread) : null;
    if (!access) return false;
    uploadInFlight.current = true;
    setFilePending(true);
    setFileError("");
    const fingerprint = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    const clientMessageId = fileAttempt?.fingerprint === fingerprint ? fileAttempt.id : randomUuid();
    setFileAttempt({ fingerprint, id: clientMessageId });
    try {
      const created = await uploadChatAttachment(thread, access, file, clientMessageId);
      setMessages((current) => {
        const next = mergeMessages(current, [created]);
        messagesRef.current = next;
        return next;
      });
      cursorRef.current = latestSequence(cursorRef.current, created.sequence);
      setFileAttempt(null);
      historyViewRef.current = "latest";
      setHistoryView("latest");
      return true;
    } catch (caught) {
      setFileError(errorText(caught));
      return false;
    } finally {
      uploadInFlight.current = false;
      setFilePending(false);
    }
  }, [fileAttempt, thread, viewerKind]);

  const downloadAttachment = useCallback(async (attachment: ChatAttachment): Promise<void> => {
    if (!thread) return;
    const access = viewerKind ? accessFor({ kind: viewerKind }, thread) : null;
    if (!access) return;
    setDownloadError("");
    try {
      const blob = await downloadChatAttachmentBlob(attachment, thread, access);
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = safeDownloadName(attachment.originalName);
        link.hidden = true;
        document.body.append(link);
        try { link.click(); } finally { link.remove(); }
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
    } catch (caught) {
      setDownloadError(errorText(caught));
    }
  }, [thread, viewerKind]);

  return {
    assignedStaffId,
    assignedStaffName,
    managerWaitSince,
    connection,
    connectionError,
    downloadAttachment,
    downloadError,
    fileError,
    filePending,
    hasOlderMessages: olderCursor !== null,
    historyError,
    historyLoading,
    loadOlderMessages,
    lastStaffReadMessageId,
    messages,
    newerMessageCount,
    olderHistoryError,
    olderHistoryLoading,
    renderedMessages,
    resetFileAttempt,
    resetSendAttempt,
    retryHistory,
    sendAttemptId,
    sendError,
    sendMessage,
    sendPending,
    showLatestMessages,
    threadStatus,
    unreadCount,
    uploadAttachment,
    viewingLatest: historyView === "latest",
  };
}
