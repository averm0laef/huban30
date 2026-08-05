"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Input, Select, Spinner, Textarea } from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  CheckmarkCircle20Regular,
  PersonAvailable20Regular,
  Search20Regular,
  Send20Regular,
} from "@fluentui/react-icons";

import type { Role } from "@an30/contracts";

import { api, queryString } from "../api";
import type { ChatMessage, ChatRow, Page, SessionView } from "../types";
import {
  CHAT_LABELS,
  errorText,
  formatDate,
  Pagination,
  RequestError,
  SectionHeader,
  useResource,
} from "../workspace-utils";
import styles from "../workspace.module.css";

type ConnectionState = "connecting" | "live" | "offline";

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) => Number(BigInt(left.sequence) - BigInt(right.sequence)));
}

async function loadCompleteHistory(threadId: string): Promise<ChatMessage[]> {
  const collected: ChatMessage[] = [];
  let after = "0";
  for (let page = 0; page < 101; page += 1) {
    const history = await api<{ items: ChatMessage[]; nextSequence: string }>(
      `/chat/threads/${threadId}/messages?after=${after}`,
    );
    collected.push(...history.items);
    if (history.items.length < 100 || history.nextSequence === after) return collected;
    after = history.nextSequence;
  }
  throw new Error("История обращения превышает 10 000 сообщений. Уточните период через архив.");
}

export function ChatsView({ session }: { session: SessionView }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [assigned, setAssigned] = useState("any");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [messageAttemptId, setMessageAttemptId] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<unknown>(null);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const limit = 25;

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedAssignment = parameters.get("assigned");
    const requestedStatus = parameters.get("status");
    if (requestedAssignment && ["any", "mine", "unassigned"].includes(requestedAssignment)) {
      setAssigned(requestedAssignment);
    }
    if (requestedStatus && Object.hasOwn(CHAT_LABELS, requestedStatus)) setStatus(requestedStatus);
  }, []);

  const resource = useResource(
    () => api<Page<ChatRow>>(`/staff/chats${queryString({
      assigned,
      limit,
      offset,
      q: appliedSearch || undefined,
      status: status || undefined,
    })}`),
    [assigned, offset, appliedSearch, status],
  );
  const selected = resource.data?.items.find((item) => item.id === selectedId) ?? null;
  const reloadQueue = resource.reload;

  // Keeps the queue list (left column) live for this whole view — independent
  // of whichever single thread is open on the right. Without this, a second
  // message/thread arriving anywhere but the currently-selected conversation
  // was only ever noticed on the next manual "Обновить очередь" click or page
  // load, which is what made new customer chats look like they "never
  // arrived" and made two staff members' queues drift out of sync. The
  // socket only ever receives a `{ type: "queue.event" }` nudge — never
  // message bodies — so the authorized `/staff/chats` query stays the single
  // source of truth for what's actually shown.
  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleReload(): void {
      // Coalesce bursts (e.g. several messages landing at once) into one
      // refetch instead of one per event.
      if (reloadTimer) return;
      reloadTimer = setTimeout(() => { reloadTimer = null; reloadQueue(); }, 300);
    }

    function connect(): void {
      if (!active) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        socket?.send(JSON.stringify({ type: "subscribe.queue" }));
      });
      socket.addEventListener("message", (event) => {
        let payload: unknown;
        try { payload = JSON.parse(String(event.data)); } catch { return; }
        if (!payload || typeof payload !== "object" || !("type" in payload)) return;
        const record = payload as Record<string, unknown>;
        if (record.type === "queue.event") scheduleReload();
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(8_000, 500 * (2 ** reconnectAttempt)));
      });
    }

    connect();
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reloadTimer) clearTimeout(reloadTimer);
      socket?.close(1000, "view_unmounted");
    };
  }, [reloadQueue]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); setConnection("offline"); return; }
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let cursor = "0";

    function markLatestIncomingRead(incoming: ChatMessage[]): void {
      if (document.visibilityState !== "visible") return;
      const latestCustomer = [...incoming].reverse()
        .find((message) => message.senderKind === "customer" || message.senderKind === "guest");
      if (!latestCustomer) return;
      void api(`/chat/threads/${selectedId}/read/${latestCustomer.id}`, { method: "POST" })
        .then(reloadQueue)
        .catch((error: unknown) => { if (active) setMessageError(error); });
    }

    function connect(): void {
      if (!active) return;
      setConnection("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        socket?.send(JSON.stringify({ afterSequence: cursor, threadId: selectedId, type: "subscribe" }));
      });
      socket.addEventListener("message", (event) => {
        let payload: unknown;
        try { payload = JSON.parse(String(event.data)); } catch { return; }
        if (!payload || typeof payload !== "object" || !("type" in payload)) return;
        const record = payload as Record<string, unknown>;
        if (record.type === "subscribed" && Array.isArray(record.items)) {
          const incoming = record.items as ChatMessage[];
          setMessages((current) => mergeMessages(current, incoming));
          cursor = typeof record.nextSequence === "string" ? record.nextSequence : cursor;
          setConnection("live");
          reloadQueue();
          markLatestIncomingRead(incoming);
        }
        if (record.type === "message" && record.message) {
          const incoming = record.message as ChatMessage;
          cursor = incoming.sequence;
          setMessages((current) => mergeMessages(current, [incoming]));
          reloadQueue();
          markLatestIncomingRead([incoming]);
        }
        if (record.type === "error") setMessageError(new Error(String(record.message ?? "Ошибка канала чата")));
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        setConnection("offline");
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(8_000, 500 * (2 ** reconnectAttempt)));
      });
    }

    setMessages([]);
    setMessageText("");
    setMessageAttemptId(null);
    setMessageError(null);
    setConnection("connecting");
    loadCompleteHistory(selectedId)
      .then((history) => {
        if (!active) return;
        cursor = history.at(-1)?.sequence ?? "0";
        setMessages(history);
        markLatestIncomingRead(history);
      })
      .catch((error: unknown) => { if (active) setMessageError(error); })
      .finally(() => { if (active) connect(); });
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "view_changed");
    };
  }, [reloadQueue, selectedId]);

  async function updateThread(update: Record<string, unknown>): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setMutationError(null);
    try {
      await api(`/staff/chats/${selected.id}`, {
        body: JSON.stringify({ reason: "Изменено в рабочем месте персонала", version: selected.version, ...update }),
        method: "PATCH",
      });
      resource.reload();
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(): Promise<void> {
    if (!selected || !messageText.trim()) return;
    const body = messageText.trim();
    const clientMessageId = messageAttemptId ?? crypto.randomUUID();
    setMessageAttemptId(clientMessageId);
    setBusy(true);
    setMessageError(null);
    try {
      const created = await api<ChatMessage>(`/chat/threads/${selected.id}/messages`, {
        body: JSON.stringify({ body, clientMessageId, replyToId: null }),
        method: "POST",
      });
      setMessages((current) => mergeMessages(current, [created]));
      setMessageText("");
      setMessageAttemptId(null);
      resource.reload();
    } catch (error) {
      setMessageError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить очередь</Button>}
        description="Назначение, переписка и состояние обращения доступны в одном контексте."
        eyebrow="Поддержка"
        title="Чаты и обращения"
      />
      <div className={styles.toolbar}>
        <Input
          aria-label="Поиск чатов"
          contentBefore={<Search20Regular />}
          onChange={(_event, data) => setSearch(data.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && search.trim().length !== 1) { setOffset(0); setAppliedSearch(search.trim()); }
          }}
          placeholder="Тема, клиент или заказ"
          value={search}
        />
        <Button disabled={search.trim().length === 1} onClick={() => { setOffset(0); setAppliedSearch(search.trim()); }}>Найти</Button>
        <Select aria-label="Состояние чата" onChange={(event) => { setOffset(0); setStatus(event.target.value); }} value={status}>
          <option value="">Все состояния</option>
          {Object.entries(CHAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="Ответственный" onChange={(event) => { setOffset(0); setAssigned(event.target.value); }} value={assigned}>
          <option value="any">Все ответственные</option>
          <option value="mine">Назначены мне</option>
          <option value="unassigned">Без ответственного</option>
        </Select>
        {search.trim().length === 1 ? <span className={styles.unsavedState}>Введите минимум 2 символа</span>
          : search.trim() !== appliedSearch ? <span className={styles.unsavedState}>Фильтр не применён</span> : null}
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {mutationError ? <RequestError error={mutationError} onRetry={resource.reload} /> : null}
      <div className={styles.chatWorkspace}>
        <section className={styles.threadQueue} aria-label="Очередь обращений">
          {resource.loading ? <div className={styles.loadingPanel}><Spinner label="Загрузка обращений" /></div> : null}
          {!resource.loading && (resource.data?.items.length ?? 0) === 0 ? (
            <div className={styles.tableState}><strong>Очередь пуста</strong><span>Новых обращений сейчас нет.</span></div>
          ) : null}
          {resource.data?.items.map((thread) => (
            <button
              className={styles.threadCard}
              data-active={thread.id === selectedId || undefined}
              key={thread.id}
              onClick={() => setSelectedId(thread.id)}
              type="button"
            >
              <span className={styles.threadTopline}>
                <strong>{thread.subject ?? "Обращение без темы"}</strong>
                {thread.unreadCount > 0 ? <Badge appearance="filled" color="brand">{thread.unreadCount}</Badge> : null}
              </span>
              <span>{thread.customerName ?? thread.customerEmail ?? "Гость"}</span>
              <small>{thread.lastMessageBody ?? "Сообщений пока нет"}</small>
              <span className={styles.threadMeta}>
                <Badge appearance="tint">{CHAT_LABELS[thread.status]}</Badge>
                <time>{formatDate(thread.lastMessageAt ?? thread.createdAt)}</time>
              </span>
            </button>
          ))}
          {resource.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} /> : null}
        </section>
        <section className={styles.conversation} aria-label="Переписка">
          {!selected ? (
            <div className={styles.tableState}><strong>Выберите обращение</strong><span>Переписка и действия откроются здесь.</span></div>
          ) : (
            <>
              <header className={styles.conversationHeader}>
                <div>
                  <strong>{selected.subject ?? "Обращение без темы"}</strong>
                  <span>{selected.orderNumber ? `Заказ ${selected.orderNumber}` : "Без привязки к заказу"}</span>
                </div>
                <Badge appearance="tint" color={connection === "live" ? "success" : connection === "connecting" ? "warning" : "danger"}>
                  {connection === "live" ? "Онлайн" : connection === "connecting" ? "Подключение" : "Нет связи"}
                </Badge>
              </header>
              <div className={styles.threadActions}>
                {selected.assignedStaffId === session.userId ? (
                  <Button disabled={busy || resource.loading} onClick={() => void updateThread({ assignedStaffId: null })}>Снять назначение</Button>
                ) : selected.assignedStaffId === null || session.role !== "manager" ? (
                  <Button disabled={busy || resource.loading} icon={<PersonAvailable20Regular />} onClick={() => void updateThread({ assignedStaffId: session.userId })}>
                    Взять себе
                  </Button>
                ) : (
                  <span className={styles.muted}>Назначен: {selected.assignedName ?? "другой сотрудник"}</span>
                )}
                {selected.status !== "closed" ? (
                  <>
                    <Button disabled={busy || resource.loading} onClick={() => void updateThread({ status: "waiting_customer" })}>Ждём клиента</Button>
                    <Button disabled={busy || resource.loading} icon={<CheckmarkCircle20Regular />} onClick={() => void updateThread({ status: "closed" })}>Закрыть</Button>
                  </>
                ) : canReopen(session.role) ? (
                  <Button disabled={busy || resource.loading} onClick={() => void updateThread({ status: "open" })}>Открыть снова</Button>
                ) : null}
              </div>
              {messageError ? <div className={styles.inlineError}>{errorText(messageError)}</div> : null}
              <div className={styles.messageList} role="log" aria-live="polite">
                {messages.length === 0 ? <span className={styles.muted}>Сообщений пока нет.</span> : null}
                {messages.map((message) => (
                  <article className={styles.message} data-own={message.senderKind === "staff" || undefined} key={message.id}>
                    <span>{message.senderKind === "staff" ? "Сотрудник" : message.senderKind === "system" ? "Система" : "Клиент"}</span>
                    {message.body ? <p>{message.body}</p> : null}
                    {message.attachments.map((attachment) => (
                      <a href={`/api/v1/chat/attachments/${attachment.id}`} key={attachment.id}>{attachment.originalName}</a>
                    ))}
                    <time>{formatDate(message.createdAt)}</time>
                  </article>
                ))}
              </div>
              <div className={styles.composer}>
                <Textarea
                  aria-label="Сообщение клиенту"
                  disabled={selected.status === "closed"}
                  onChange={(_event, data) => {
                    if (data.value !== messageText) setMessageAttemptId(null);
                    setMessageText(data.value);
                  }}
                  placeholder={selected.status === "closed" ? "Чат закрыт" : "Напишите ответ"}
                  resize="vertical"
                  value={messageText}
                />
                <Button
                  appearance="primary"
                  disabled={busy || selected.status === "closed" || !messageText.trim()}
                  icon={<Send20Regular />}
                  onClick={() => void sendMessage()}
                >
                  Отправить
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function canReopen(role: Role): boolean {
  return role === "director" || role === "admin";
}
