"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  API_PREFIX,
  StorefrontApiError,
  apiErrorMessage,
  errorText,
  readSession,
  type SessionView,
} from "../_lib/storefront-api";
import {
  GUEST_CHAT_STORAGE_KEY,
  attachmentSignatureError,
  isChatMessage,
  isChatThread,
  latestSequence,
  mergeMessages,
  parseStoredGuestThreads,
  reconnectDelay,
  safeDownloadName,
  serializeGuestThreads,
  upsertThread,
  type ChatAttachment,
  type ChatMessage,
  type ChatThread,
} from "./chat-state";
import styles from "./chat.module.css";

type Viewer =
  | { kind: "customer"; session: SessionView }
  | { kind: "error"; message: string }
  | { kind: "guest" }
  | { kind: "loading" }
  | { kind: "staff" };

type ChatAccess = { kind: "customer" } | { guestToken: string; kind: "guest" };
type ConnectionState = "connecting" | "error" | "idle" | "live" | "offline" | "reconnecting";

interface ThreadListResponse { items: ChatThread[] }
interface GuestThreadResponse extends ChatThread { guestToken: string }
interface HistoryResponse { items: ChatMessage[]; nextSequence: string }

const STATUS_LABELS: Record<ChatThread["status"], string> = {
  closed: "Закрыт",
  open: "Открыт",
  waiting_customer: "Ждём ваш ответ",
  waiting_staff: "Ждёт сотрудника",
};

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: "Подключение",
  error: "Ошибка связи",
  idle: "Не подключён",
  live: "Онлайн",
  offline: "Нет сети",
  reconnecting: "Восстановление связи",
};

function cookieValue(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204) return null;
  if (contentType.includes("application/json")) {
    try { return await response.json(); } catch { return null; }
  }
  try { return await response.text(); } catch { return null; }
}

async function chatRequest<T>(
  path: string,
  access?: ChatAccess,
  options: { body?: unknown; method?: string } = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (access?.kind === "guest") headers.set("X-Guest-Chat-Token", access.guestToken);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = cookieValue("an30_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "include",
      headers,
      method,
    });
  } catch {
    throw new StorefrontApiError("Нет соединения с сервером", 0, null);
  }
  const payload = await responsePayload(response);
  if (!response.ok) throw new StorefrontApiError(apiErrorMessage(payload, response.status), response.status, payload);
  return payload as T;
}

function messagePath(threadId: string, access: ChatAccess): string {
  return access.kind === "guest"
    ? `/chat/guest/threads/${threadId}/messages`
    : `/chat/threads/${threadId}/messages`;
}

function readPath(threadId: string, messageId: string, access: ChatAccess): string {
  return access.kind === "guest"
    ? `/chat/guest/threads/${threadId}/read/${messageId}`
    : `/chat/threads/${threadId}/read/${messageId}`;
}

function attachmentPath(attachmentId: string, access: ChatAccess): string {
  return access.kind === "guest"
    ? `/chat/guest/attachments/${attachmentId}`
    : `/chat/attachments/${attachmentId}`;
}

function uploadPath(threadId: string, access: ChatAccess): string {
  return access.kind === "guest"
    ? `/chat/guest/threads/${threadId}/attachments`
    : `/chat/threads/${threadId}/attachments`;
}

function accessFor(viewer: Viewer, thread: ChatThread): ChatAccess | null {
  if (viewer.kind === "customer") return { kind: "customer" };
  if (viewer.kind === "guest" && thread.guestToken) return { guestToken: thread.guestToken, kind: "guest" };
  return null;
}

async function loadCompleteHistory(
  thread: ChatThread,
  access: ChatAccess,
  isActive: () => boolean,
  onPage: (messages: ChatMessage[]) => void,
): Promise<{ cursor: string; messages: ChatMessage[] }> {
  let cursor = "0";
  let messages: ChatMessage[] = [];
  for (let page = 0; page < 101; page += 1) {
    const history = await chatRequest<HistoryResponse>(
      `${messagePath(thread.id, access)}?after=${encodeURIComponent(cursor)}`,
      access,
    );
    if (!isActive()) return { cursor, messages };
    if (!Array.isArray(history.items)
      || history.items.some((message) => !isChatMessage(message))
      || typeof history.nextSequence !== "string"
      || !/^(0|[1-9]\d{0,18})$/u.test(history.nextSequence)) {
      throw new Error("Сервер вернул повреждённую страницу истории");
    }
    if (page === 100 && history.items.length > 0) {
      throw new Error("История превышает 10 000 сообщений. Обратитесь в магазин для получения архива");
    }
    messages = mergeMessages(messages, history.items);
    onPage(messages);
    if (history.items.length < 100 || history.nextSequence === cursor) {
      return { cursor: history.nextSequence, messages };
    }
    cursor = history.nextSequence;
  }
  throw new Error("Не удалось определить конец истории сообщений");
}

function formatDate(value: string | null): string {
  if (!value) return "Нет сообщений";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function senderLabel(kind: ChatMessage["senderKind"]): string {
  return kind === "staff" ? "АН-30" : kind === "system" ? "Система" : "Вы";
}

function isOwnMessage(message: ChatMessage): boolean {
  return message.senderKind === "customer" || message.senderKind === "guest";
}

export function ChatClient() {
  const [viewer, setViewer] = useState<Viewer>({ kind: "loading" });
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [forgetId, setForgetId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [connectionError, setConnectionError] = useState("");
  const [lastStaffReadMessageId, setLastStaffReadMessageId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendAttemptId, setSendAttemptId] = useState<string | null>(null);
  const [sendPending, setSendPending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileAttempt, setFileAttempt] = useState<{ fingerprint: string; id: string } | null>(null);
  const [filePending, setFilePending] = useState(false);
  const [fileError, setFileError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const cursorRef = useRef("0");
  const sendInFlight = useRef(false);
  const uploadInFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const ackWaiters = useRef(new Map<string, {
    reject: (error: Error) => void;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }>());

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [selectedId, threads],
  );

  const persistGuestThreads = useCallback((next: ChatThread[]) => {
    try {
      window.localStorage.setItem(GUEST_CHAT_STORAGE_KEY, serializeGuestThreads(next));
      setStorageWarning("");
    } catch {
      setStorageWarning("Браузер не разрешил постоянное хранение. Не закрывайте страницу, иначе доступ к гостевому чату будет потерян");
    }
  }, []);

  const loadThreads = useCallback(async (targetViewer: Viewer) => {
    setThreadsLoading(true);
    setThreadsError("");
    try {
      if (targetViewer.kind === "guest") {
        const stored = parseStoredGuestThreads(window.localStorage.getItem(GUEST_CHAT_STORAGE_KEY));
        setThreads(stored);
        setSelectedId((current) => current && stored.some((thread) => thread.id === current) ? current : stored[0]?.id ?? null);
      } else if (targetViewer.kind === "customer") {
        const result = await chatRequest<ThreadListResponse>("/chat/threads");
        if (!Array.isArray(result.items) || result.items.some((thread) => !isChatThread(thread))) {
          throw new Error("Сервер вернул повреждённый список чатов");
        }
        setThreads(result.items);
        setSelectedId((current) => current && result.items.some((thread) => thread.id === current) ? current : result.items[0]?.id ?? null);
      }
    } catch (caught) {
      setThreadsError(errorText(caught));
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const initialize = useCallback(async () => {
    setViewer({ kind: "loading" });
    setThreadsError("");
    try {
      const session = await readSession();
      const nextViewer: Viewer = !session
        ? { kind: "guest" }
        : session.role === "customer"
          ? { kind: "customer", session }
          : { kind: "staff" };
      setViewer(nextViewer);
      await loadThreads(nextViewer);
    } catch (caught) {
      setThreadsLoading(false);
      setViewer({ kind: "error", message: errorText(caught) });
    }
  }, [loadThreads]);

  useEffect(() => {
    setOnline(window.navigator.onLine);
    const updateOnline = () => setOnline(window.navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    void initialize();
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [initialize]);

  useEffect(() => {
    if (viewer.kind !== "guest") return;
    const sync = (event: StorageEvent) => {
      if (event.key !== GUEST_CHAT_STORAGE_KEY) return;
      const next = parseStoredGuestThreads(event.newValue);
      setThreads(next);
      setSelectedId((current) => current && next.some((thread) => thread.id === current) ? current : next[0]?.id ?? null);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [viewer.kind]);

  useEffect(() => {
    messagesRef.current = messages;
    messageEnd.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    const thread = selectedThread;
    const access = thread ? accessFor(viewer, thread) : null;
    if (!thread || !access) {
      messagesRef.current = [];
      setMessages([]);
      setConnection("idle");
      return;
    }
    const activeThread = thread;
    const activeAccess = access;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let lastReadMessageId = "";
    let readInFlightMessageId = "";
    messagesRef.current = [];
    setMessages([]);
    setHistoryLoading(true);
    setHistoryError("");
    setConnectionError("");
    setLastStaffReadMessageId(null);
    setConnection("connecting");
    cursorRef.current = "0";

    function rejectAcks(message: string): void {
      for (const waiter of ackWaiters.current.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(message));
      }
      ackWaiters.current.clear();
    }

    function markLatestRead(incoming: ChatMessage[], preferredSocket?: WebSocket | null): void {
      if (document.visibilityState !== "visible") return;
      const latest = [...incoming].reverse().find((message) => !isOwnMessage(message));
      if (!latest || latest.id === lastReadMessageId || latest.id === readInFlightMessageId) return;
      if (preferredSocket?.readyState === WebSocket.OPEN) {
        lastReadMessageId = latest.id;
        preferredSocket.send(JSON.stringify({ messageId: latest.id, type: "receipt.read" }));
      } else {
        readInFlightMessageId = latest.id;
        void chatRequest(readPath(activeThread.id, latest.id, activeAccess), activeAccess, { method: "POST" })
          .then(() => { if (active) lastReadMessageId = latest.id; })
          .catch((caught: unknown) => { if (active) setConnectionError(errorText(caught)); })
          .finally(() => { if (readInFlightMessageId === latest.id) readInFlightMessageId = ""; });
      }
    }

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
          setMessages((current) => mergeMessages(current, incoming));
          cursorRef.current = typeof record.nextSequence === "string"
            ? latestSequence(cursorRef.current, record.nextSequence)
            : cursorRef.current;
          reconnectAttempt = 0;
          setConnection("live");
          setConnectionError("");
          markLatestRead(incoming, socket);
        } else if (record.type === "message") {
          if (!isChatMessage(record.message)) {
            setConnectionError("Сервер вернул повреждённое сообщение");
            socket?.close(1008, "invalid_payload");
            return;
          }
          const incoming = record.message;
          cursorRef.current = latestSequence(cursorRef.current, incoming.sequence);
          setMessages((current) => mergeMessages(current, [incoming]));
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

    loadCompleteHistory(activeThread, activeAccess, () => active, (loaded) => setMessages(loaded))
      .then(({ cursor, messages: loaded }) => {
        if (!active) return;
        cursorRef.current = cursor;
        markLatestRead(loaded);
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
      document.removeEventListener("visibilitychange", readVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      rejectAcks("Открыт другой чат");
      socket?.close(1000, "view_changed");
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [historyRevision, selectedThread, viewer]);

  async function createThread(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (createPending || (viewer.kind !== "guest" && viewer.kind !== "customer")) return;
    const cleanSubject = subject.trim();
    if (cleanSubject.length < 2) {
      setCreateError("Укажите тему минимум из 2 символов");
      return;
    }
    setCreatePending(true);
    setCreateError("");
    try {
      const created = viewer.kind === "guest"
        ? await chatRequest<GuestThreadResponse>("/chat/guest/threads", undefined, {
          body: { orderId: null, subject: cleanSubject }, method: "POST",
        })
        : await chatRequest<ChatThread>("/chat/threads", { kind: "customer" }, {
          body: { orderId: null, subject: cleanSubject }, method: "POST",
        });
      if (!isChatThread(created)
        || (viewer.kind === "guest" && (!created.guestToken || created.guestToken.length < 32 || created.guestToken.length > 256))) {
        throw new Error("Сервер не вернул безопасный доступ к новому чату");
      }
      const next = upsertThread(threads, created);
      setThreads(next);
      if (viewer.kind === "guest") persistGuestThreads(next);
      setSubject("");
      setSelectedId(created.id);
    } catch (caught) {
      setCreateError(errorText(caught));
    } finally {
      setCreatePending(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sendInFlight.current || !selectedThread || !online) return;
    const access = accessFor(viewer, selectedThread);
    const body = draft.trim();
    if (!access || !body || body.length > 4_000) return;
    const clientMessageId = sendAttemptId ?? crypto.randomUUID();
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
          socket.send(JSON.stringify({ body, clientMessageId, replyToId: null, type: "message.send" }));
        });
      } else {
        const created = await chatRequest<ChatMessage>(messagePath(selectedThread.id, access), access, {
          body: { body, clientMessageId, replyToId: null }, method: "POST",
        });
        if (!isChatMessage(created)) throw new Error("Сервер вернул повреждённое сообщение");
        setMessages((current) => mergeMessages(current, [created]));
        cursorRef.current = latestSequence(cursorRef.current, created.sequence);
      }
      setDraft("");
      setSendAttemptId(null);
    } catch (caught) {
      setSendError(errorText(caught));
      if (caught instanceof StorefrontApiError && caught.status === 409) {
        setThreads((current) => current.map((thread) => thread.id === selectedThread.id
          ? { ...thread, status: "closed" } : thread));
      }
    } finally {
      sendInFlight.current = false;
      setSendPending(false);
    }
  }

  async function uploadAttachment(): Promise<void> {
    if (uploadInFlight.current || !selectedThread || !selectedFile || !online) return;
    const access = accessFor(viewer, selectedThread);
    if (!access) return;
    uploadInFlight.current = true;
    setFilePending(true);
    setFileError("");
    const fingerprint = `${selectedFile.name}:${selectedFile.size}:${selectedFile.type}:${selectedFile.lastModified}`;
    const clientMessageId = fileAttempt?.fingerprint === fingerprint ? fileAttempt.id : crypto.randomUUID();
    setFileAttempt({ fingerprint, id: clientMessageId });
    try {
      const signature = new Uint8Array(await selectedFile.slice(0, 16).arrayBuffer());
      const validationError = attachmentSignatureError(selectedFile, signature);
      if (validationError) throw new Error(validationError);
      const form = new FormData();
      form.set("file", selectedFile, selectedFile.name);
      const headers = new Headers({ Accept: "application/json", "X-Client-Message-Id": clientMessageId });
      if (access.kind === "guest") headers.set("X-Guest-Chat-Token", access.guestToken);
      const csrf = cookieValue("an30_csrf");
      if (csrf) headers.set("X-CSRF-Token", csrf);
      let response: Response;
      try {
        response = await fetch(`${API_PREFIX}${uploadPath(selectedThread.id, access)}`, {
          body: form,
          cache: "no-store",
          credentials: "include",
          headers,
          method: "POST",
        });
      } catch {
        throw new StorefrontApiError("Нет соединения с сервером", 0, null);
      }
      const payload = await responsePayload(response);
      if (!response.ok) throw new StorefrontApiError(apiErrorMessage(payload, response.status), response.status, payload);
      if (!isChatMessage(payload)) throw new Error("Сервер вернул повреждённое вложение");
      const created = payload;
      setMessages((current) => mergeMessages(current, [created]));
      cursorRef.current = latestSequence(cursorRef.current, created.sequence);
      setSelectedFile(null);
      setFileAttempt(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (caught) {
      setFileError(errorText(caught));
    } finally {
      uploadInFlight.current = false;
      setFilePending(false);
    }
  }

  async function downloadAttachment(attachment: ChatAttachment): Promise<void> {
    if (!selectedThread) return;
    const access = accessFor(viewer, selectedThread);
    if (!access) return;
    setDownloadError("");
    const headers = new Headers();
    if (access.kind === "guest") headers.set("X-Guest-Chat-Token", access.guestToken);
    try {
      const response = await fetch(`${API_PREFIX}${attachmentPath(attachment.id, access)}`, {
        cache: "no-store", credentials: "include", headers,
      });
      const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw new StorefrontApiError(apiErrorMessage(payload, response.status), response.status, payload);
      }
      const blob = await response.blob();
      if (blob.size !== attachment.byteSize || contentType !== attachment.mimeType) {
        throw new Error("Полученный файл не совпадает с проверенными метаданными");
      }
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
  }

  function forgetGuestThread(threadId: string): void {
    const next = threads.filter((thread) => thread.id !== threadId);
    setThreads(next);
    persistGuestThreads(next);
    setForgetId(null);
    if (selectedId === threadId) setSelectedId(next[0]?.id ?? null);
  }

  function focusThread(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-customer-chat-thread]"));
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowDown" ? Math.min(buttons.length - 1, index + 1)
          : Math.max(0, index - 1);
    buttons[nextIndex]?.focus();
  }

  if (viewer.kind === "loading") {
    return <div className={styles.page}><div className={styles.statePanel} role="status"><h1>Открываем чат</h1><p>Проверяем сессию и сохранённые обращения.</p></div></div>;
  }
  if (viewer.kind === "error") {
    return <div className={styles.page}><div className={styles.statePanel} role="alert"><h1>Чат пока недоступен</h1><p>{viewer.message}</p><button type="button" onClick={() => void initialize()}>Повторить</button></div></div>;
  }
  if (viewer.kind === "staff") {
    return <div className={styles.page}><div className={styles.statePanel}><h1>Клиентский чат</h1><p>Для рабочей очереди сотрудников используйте защищённую админку.</p><Link href="/admin/chats">Открыть рабочее место</Link></div></div>;
  }

  const threadClosed = selectedThread?.status === "closed";
  const ownMessages = messages.filter(isOwnMessage);
  const lastOwnMessageId = ownMessages.at(-1)?.id ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeading}>
        <div><p>Поддержка АН-30</p><h1>Чат с магазином</h1><span>Сообщения сохраняются на сервере. Сотрудник увидит обращение в своей рабочей очереди.</span></div>
        <button type="button" disabled={threadsLoading} onClick={() => void loadThreads(viewer)}>Обновить список</button>
      </header>
      {!online ? <div className={styles.notice} role="status"><strong>Нет подключения</strong><span>История остаётся на экране, но отправка временно недоступна.</span></div> : null}
      {storageWarning ? <div className={styles.warning} role="alert"><strong>Доступ сохранён только на этой странице</strong><span>{storageWarning}</span></div> : null}
      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="Список чатов">
          <form className={styles.createForm} onSubmit={(event) => void createThread(event)}>
            <label htmlFor="chat-subject">Тема нового обращения</label>
            <input
              id="chat-subject"
              maxLength={240}
              minLength={2}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Например, вопрос по заказу"
              required
              value={subject}
            />
            <button disabled={createPending || !online} type="submit">{createPending ? "Создаём..." : "Начать чат"}</button>
            {createError ? <p className={styles.inlineError} role="alert">{createError}</p> : null}
          </form>
          {threadsError ? <div className={styles.listError} role="alert"><strong>Список не загружен</strong><span>{threadsError}</span><button type="button" onClick={() => void loadThreads(viewer)}>Повторить</button></div> : null}
          {threadsLoading ? <div className={styles.listState} role="status">Загружаем чаты</div> : null}
          {!threadsLoading && !threadsError && threads.length === 0 ? <div className={styles.listState}>Здесь появятся ваши обращения.</div> : null}
          <div className={styles.threadList} role="list" aria-label="Ваши чаты">
            {threads.map((thread, index) => (
              <article className={styles.threadRow} data-active={thread.id === selectedId || undefined} key={thread.id} role="listitem">
                <button
                  aria-pressed={thread.id === selectedId}
                  data-customer-chat-thread
                  onClick={() => { setForgetId(null); setSelectedId(thread.id); }}
                  onKeyDown={(event) => focusThread(event, index)}
                  type="button"
                >
                  <strong>{thread.subject ?? "Обращение без темы"}</strong>
                  <span>{STATUS_LABELS[thread.status]}</span>
                  <time dateTime={thread.lastMessageAt ?? thread.createdAt}>{formatDate(thread.lastMessageAt ?? thread.createdAt)}</time>
                </button>
                {viewer.kind === "guest" ? (
                  forgetId === thread.id ? (
                    <div className={styles.forgetConfirm} role="alert">
                      <span>После удаления восстановить доступ без токена нельзя.</span>
                      <button type="button" onClick={() => forgetGuestThread(thread.id)}>Удалить доступ</button>
                      <button type="button" onClick={() => setForgetId(null)}>Отмена</button>
                    </div>
                  ) : <button className={styles.forgetButton} type="button" onClick={() => setForgetId(thread.id)}>Убрать с устройства</button>
                ) : null}
              </article>
            ))}
          </div>
        </aside>
        <section className={styles.conversation} aria-label="Переписка">
          {!selectedThread ? (
            <div className={styles.statePanel}><h2>Выберите чат</h2><p>Или создайте новое обращение слева.</p></div>
          ) : (
            <>
              <header className={styles.conversationHeader}>
                <div><h2>{selectedThread.subject ?? "Обращение без темы"}</h2><span>{STATUS_LABELS[selectedThread.status]}</span></div>
                <span className={styles.connection} data-state={connection}>{CONNECTION_LABELS[connection]}</span>
              </header>
              {connectionError ? <div className={styles.inlineError} role="alert">{connectionError}</div> : null}
              {historyError ? <div className={styles.historyError} role="alert"><strong>История не загружена</strong><span>{historyError}</span><button type="button" onClick={() => setHistoryRevision((value) => value + 1)}>Повторить</button></div> : null}
              {historyLoading ? <div className={styles.historyState} role="status">Загружаем историю</div> : (
                <div className={styles.messages} role="log" aria-live="polite" aria-relevant="additions text">
                  {messages.length === 0 ? <div className={styles.emptyMessages}><strong>Сообщений пока нет</strong><span>Напишите вопрос, и сотрудник ответит в этом чате.</span></div> : null}
                  {messages.map((message) => (
                    <article className={styles.message} data-own={isOwnMessage(message) || undefined} key={message.id}>
                      <header><strong>{senderLabel(message.senderKind)}</strong><time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time></header>
                      {message.body && message.messageType !== "attachment" ? <p>{message.body}</p> : null}
                      {message.attachments.map((attachment) => (
                        <button className={styles.attachment} key={attachment.id} onClick={() => void downloadAttachment(attachment)} type="button">
                          <strong>{attachment.originalName}</strong><span>{Math.max(1, Math.ceil(attachment.byteSize / 1024))} КБ, скачать</span>
                        </button>
                      ))}
                      {isOwnMessage(message) && lastStaffReadMessageId === message.id ? <small>Прочитано магазином</small> : null}
                    </article>
                  ))}
                  {lastStaffReadMessageId && lastOwnMessageId && lastStaffReadMessageId !== lastOwnMessageId ? <span className={styles.readNote}>Магазин прочитал предыдущие сообщения</span> : null}
                  <div ref={messageEnd} />
                </div>
              )}
              {downloadError ? <div className={styles.inlineError} role="alert">Файл не скачан: {downloadError}</div> : null}
              <div className={styles.composer}>
                {threadClosed ? <div className={styles.closedNotice}>Чат закрыт. Создайте новое обращение, если вопрос остался.</div> : (
                  <>
                    <form onSubmit={(event) => void sendMessage(event)}>
                      <label className={styles.visuallyHidden} htmlFor="chat-message">Сообщение магазину</label>
                      <textarea
                        id="chat-message"
                        maxLength={4_000}
                        onChange={(event) => {
                          if (event.target.value !== draft) setSendAttemptId(null);
                          setDraft(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit();
                        }}
                        placeholder="Напишите сообщение"
                        rows={3}
                        value={draft}
                      />
                      <div><span>{draft.length} из 4000</span><button disabled={sendPending || !draft.trim() || !online} type="submit">{sendPending ? "Отправляем..." : sendAttemptId ? "Повторить отправку" : "Отправить"}</button></div>
                    </form>
                    {sendError ? <div className={styles.inlineError} role="alert">{sendError}</div> : null}
                    <div className={styles.uploadRow}>
                      <label htmlFor="chat-attachment">Изображение JPEG, PNG или WebP до 5 МБ</label>
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        id="chat-attachment"
                        onChange={(event) => {
                          setSelectedFile(event.target.files?.[0] ?? null);
                          setFileAttempt(null);
                          setFileError("");
                        }}
                        ref={fileInput}
                        type="file"
                      />
                      <button disabled={!selectedFile || filePending || !online} onClick={() => void uploadAttachment()} type="button">{filePending ? "Проверяем и загружаем..." : fileAttempt ? "Повторить загрузку" : "Отправить изображение"}</button>
                    </div>
                    {fileError ? <div className={styles.inlineError} role="alert">{fileError}</div> : null}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
