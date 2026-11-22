"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  CheckmarkCircle20Regular,
  Delete20Regular,
  Search20Regular,
  Send20Regular,
} from "@fluentui/react-icons";

import { customerAvatarKey, isCustomerAvatarKey, parseChatIntakeMessage, type Role } from "@an30/contracts";

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
import { randomUuid } from "../../_lib/browser-crypto";

type ConnectionState = "connecting" | "live" | "offline";

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) => Number(BigInt(left.sequence) - BigInt(right.sequence)));
}

interface HistoryWindow {
  items: ChatMessage[];
  nextSequence: string;
  olderCursor: string | null;
}

const HISTORY_PAGE_SIZE = 50;
const RENDERED_MESSAGE_LIMIT = 150;

function CustomerAvatar({ thread, size = 36 }: { size?: number; thread: ChatRow }) {
  const key = isCustomerAvatarKey(thread.customerAvatarKey) ? thread.customerAvatarKey : customerAvatarKey(`guest:${thread.id}`);
  return <img alt="" aria-hidden="true" className={styles.customerAvatar} height={size} src={`/avatars/${key}.webp`} width={size} />;
}

/** «7» is too short for the search box; «#7» still finds chat Ч-000007. */
function searchTerm(value: string): string {
  const trimmed = value.trim();
  return /^\d$/u.test(trimmed) ? `#${trimmed}` : trimmed;
}

async function loadHistoryWindow(threadId: string, before: "latest" | string): Promise<HistoryWindow> {
  return api<HistoryWindow>(
    `/chat/threads/${threadId}/messages?before=${encodeURIComponent(before)}&limit=${HISTORY_PAGE_SIZE}`,
  );
}

export function ChatsView({ session }: { session: SessionView }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [assigned, setAssigned] = useState("any");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<"latest" | "older">("latest");
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const [messageText, setMessageText] = useState("");
  const [messageAttemptId, setMessageAttemptId] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<unknown>(null);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const historyViewRef = useRef<"latest" | "older">("latest");
  const olderRequestRef = useRef<symbol | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const limit = 25;
  const renderedMessages = useMemo(() => historyView === "latest"
    ? messages.slice(-RENDERED_MESSAGE_LIMIT)
    : messages.slice(0, RENDERED_MESSAGE_LIMIT), [historyView, messages]);
  const newerMessageCount = historyView === "older"
    ? Math.max(0, messages.length - renderedMessages.length)
    : 0;

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

  useEffect(() => {
    if (historyView === "latest") messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [historyView, renderedMessages]);

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
    if (!selectedId) {
      olderRequestRef.current = null;
      setMessages([]);
      setOlderCursor(null);
      setOlderLoading(false);
      historyViewRef.current = "latest";
      setHistoryView("latest");
      setConnection("offline");
      return;
    }
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let cursor = "0";

    function markLatestIncomingRead(incoming: ChatMessage[]): void {
      if (historyViewRef.current !== "latest" || document.visibilityState !== "visible") return;
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
          if (incoming.senderKind === "staff") {
            historyViewRef.current = "latest";
            setHistoryView("latest");
          }
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
    olderRequestRef.current = null;
    setOlderCursor(null);
    setOlderLoading(false);
    setOlderError(null);
    historyViewRef.current = "latest";
    setHistoryView("latest");
    setMessageText("");
    setMessageAttemptId(null);
    setMessageError(null);
    setConnection("connecting");
    loadHistoryWindow(selectedId, "latest")
      .then((history) => {
        if (!active) return;
        cursor = history.nextSequence;
        setMessages(history.items);
        setOlderCursor(history.olderCursor);
        markLatestIncomingRead(history.items);
      })
      .catch((error: unknown) => { if (active) setMessageError(error); })
      .finally(() => { if (active) connect(); });
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "view_changed");
    };
  }, [reloadQueue, selectedId]);

  async function loadOlderMessages(): Promise<void> {
    if (!selectedId || !olderCursor || olderLoading) return;
    const container = messageListRef.current;
    const requestToken = Symbol("older-history");
    olderRequestRef.current = requestToken;
    const containerTop = container?.getBoundingClientRect().top ?? 0;
    const anchor = container
      ? [...container.querySelectorAll<HTMLElement>("[data-chat-message-id]")]
        .find((item) => item.getBoundingClientRect().bottom >= containerTop)
      : null;
    const anchorTop = anchor?.getBoundingClientRect().top ?? 0;
    setOlderLoading(true);
    setOlderError(null);
    try {
      const history = await loadHistoryWindow(selectedId, olderCursor);
      if (olderRequestRef.current !== requestToken) return;
      setMessages((current) => mergeMessages(history.items, current));
      setOlderCursor(history.olderCursor);
      historyViewRef.current = "older";
      setHistoryView("older");
      window.requestAnimationFrame(() => {
        if (!container || !anchor) return;
        const currentAnchor = container.querySelector<HTMLElement>(`[data-chat-message-id="${anchor.dataset.chatMessageId}"]`);
        if (currentAnchor) container.scrollTop += currentAnchor.getBoundingClientRect().top - anchorTop;
      });
    } catch (error) {
      if (olderRequestRef.current === requestToken) setOlderError(error);
    } finally {
      if (olderRequestRef.current === requestToken) {
        olderRequestRef.current = null;
        setOlderLoading(false);
      }
    }
  }

  function showLatestMessages(): void {
    historyViewRef.current = "latest";
    setHistoryView("latest");
  }

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

  async function deleteThread(): Promise<void> {
    if (!selected || deleteReason.trim().length < 3) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api(`/staff/chats/${selected.id}`, {
        body: JSON.stringify({ reason: deleteReason.trim(), version: selected.version }),
        method: "DELETE",
      });
      setDeleteOpen(false);
      setDeleteReason("");
      setSelectedId(null);
      resource.reload();
    } catch (error) {
      setDeleteError(error);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(): Promise<void> {
    if (!selected || !messageText.trim()) return;
    const body = messageText.trim();
    const clientMessageId = messageAttemptId ?? randomUuid();
    setMessageAttemptId(clientMessageId);
    setBusy(true);
    setMessageError(null);
    try {
      const created = await api<ChatMessage>(`/chat/threads/${selected.id}/messages`, {
        body: JSON.stringify({ body, clientMessageId, replyToId: null }),
        method: "POST",
      });
      setMessages((current) => mergeMessages(current, [created]));
      historyViewRef.current = "latest";
      setHistoryView("latest");
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
        description="Включите «Принимать обращения» в верхней панели. Новые диалоги назначаются доступным менеджерам автоматически."
        eyebrow="Поддержка"
        title="Чаты и обращения"
      />
      <div className={styles.toolbar}>
        <Input
          aria-label="Поиск чатов"
          contentBefore={<Search20Regular />}
          onChange={(_event, data) => setSearch(data.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && searchTerm(search).length !== 1) { setOffset(0); setAppliedSearch(searchTerm(search)); }
          }}
          placeholder="Номер Ч-000123, тема, клиент или заказ"
          value={search}
        />
        <Button disabled={searchTerm(search).length === 1} onClick={() => { setOffset(0); setAppliedSearch(searchTerm(search)); }}>Найти</Button>
        <Select aria-label="Состояние чата" onChange={(event) => { setOffset(0); setStatus(event.target.value); }} value={status}>
          <option value="">Все состояния</option>
          {Object.entries(CHAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="Ответственный" onChange={(event) => { setOffset(0); setAssigned(event.target.value); }} value={assigned}>
          <option value="any">Все ответственные</option>
          <option value="mine">Назначены мне</option>
          <option value="unassigned">Без ответственного</option>
        </Select>
        {searchTerm(search).length === 1 ? <span className={styles.unsavedState}>Введите минимум 2 символа</span>
          : searchTerm(search) !== appliedSearch ? <span className={styles.unsavedState}>Фильтр не применён</span> : null}
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
                <span className={styles.threadWho}>
                  <CustomerAvatar thread={thread} />
                  <strong>{thread.subject ?? "Обращение без темы"}</strong>
                </span>
                {thread.unreadCount > 0 ? <Badge appearance="filled" color="brand">{thread.unreadCount}</Badge> : null}
              </span>
              <span>{thread.number ? <b className={styles.chatNumber}>{thread.number}</b> : null}{thread.customerName ?? thread.customerEmail ?? "Гость"}</span>
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
                <div className={styles.threadWho}>
                  <CustomerAvatar size={44} thread={selected} />
                  <div>
                    <strong>{selected.number ? `${selected.number} · ` : ""}{selected.subject ?? "Обращение без темы"}</strong>
                    <span>{selected.customerName ?? selected.customerEmail ?? "Гость"} · {selected.orderNumber ? `заказ ${selected.orderNumber}` : "без привязки к заказу"}</span>
                  </div>
                </div>
                <Badge appearance="tint" color={connection === "live" ? "success" : connection === "connecting" ? "warning" : "danger"}>
                  {connection === "live" ? "Онлайн" : connection === "connecting" ? "Подключение" : "Нет связи"}
                </Badge>
              </header>
              <div className={styles.threadActions}>
                <span className={styles.muted}>{selected.assignedStaffId ? `Менеджер: ${selected.assignedName ?? "сотрудник АН30"}` : "В очереди. Менеджер назначается автоматически."}</span>
                {selected.status !== "closed" ? (
                  <>
                    <Button disabled={busy || resource.loading} onClick={() => void updateThread({ status: "waiting_customer" })}>Ждём клиента</Button>
                    <Button disabled={busy || resource.loading} icon={<CheckmarkCircle20Regular />} onClick={() => void updateThread({ status: "closed" })}>Закрыть</Button>
                  </>
                ) : canReopen(session.role) ? (
                  <Button disabled={busy || resource.loading} onClick={() => void updateThread({ status: "open" })}>Открыть снова</Button>
                ) : null}
                {canDelete(session.role) ? (
                  <Button disabled={busy || resource.loading} icon={<Delete20Regular />} onClick={() => { setDeleteError(null); setDeleteOpen(true); }}>Удалить</Button>
                ) : null}
              </div>
              <Dialog modalType="alert" onOpenChange={(_event, data) => { if (!busy) setDeleteOpen(data.open); }} open={deleteOpen}>
                <DialogSurface>
                  <DialogBody>
                    <DialogTitle>Удалить {selected.number ?? "обращение"}?</DialogTitle>
                    <DialogContent className={styles.deleteDialog}>
                      <p>Чат исчезнет из очереди и у клиента. Переписка останется в базе и в журнале аудита, вернуть её может только разработчик.</p>
                      {deleteError ? <div className={styles.inlineError} role="alert">{errorText(deleteError)}</div> : null}
                      <Field label="Причина удаления" required hint="Например: спам, дубль обращения. Попадёт в журнал аудита.">
                        <Textarea maxLength={500} onChange={(_event, data) => setDeleteReason(data.value)} value={deleteReason} />
                      </Field>
                    </DialogContent>
                    <DialogActions>
                      <Button disabled={busy} onClick={() => setDeleteOpen(false)}>Отмена</Button>
                      <Button appearance="primary" className={styles.dangerButton} disabled={busy || deleteReason.trim().length < 3} icon={<Delete20Regular />} onClick={() => void deleteThread()}>Удалить чат</Button>
                    </DialogActions>
                  </DialogBody>
                </DialogSurface>
              </Dialog>
              {messageError ? <div className={styles.inlineError}>{errorText(messageError)}</div> : null}
              <div
                aria-busy={olderLoading || undefined}
                aria-live={historyView === "latest" ? "polite" : "off"}
                className={styles.messageList}
                id="staff-chat-message-log"
                ref={messageListRef}
                role="log"
              >
                {olderCursor || historyView === "older" ? (
                  <div className={styles.historyControls}>
                    {olderCursor ? (
                      <Button
                        aria-controls="staff-chat-message-log"
                        disabled={olderLoading}
                        onClick={() => void loadOlderMessages()}
                      >
                        {olderLoading
                          ? "Загружаем предыдущие..."
                          : olderError
                            ? "Повторить загрузку предыдущих"
                            : "Показать предыдущие сообщения"}
                      </Button>
                    ) : <span className={styles.muted}>Это начало переписки.</span>}
                    {historyView === "older" ? (
                      <Button aria-controls="staff-chat-message-log" onClick={showLatestMessages}>
                        {newerMessageCount > 0 ? `К последним (${newerMessageCount})` : "К последним сообщениям"}
                      </Button>
                    ) : null}
                    {olderError ? <span className={styles.inlineHistoryError} role="alert">{errorText(olderError)}</span> : null}
                  </div>
                ) : null}
                {messages.length === 0 ? <span className={styles.muted}>Сообщений пока нет.</span> : null}
                {renderedMessages.map((message, index) => (
                  <article
                    className={styles.message}
                    data-chat-message-id={message.id}
                    data-own={message.senderKind === "staff" || undefined}
                    key={message.id}
                  >
                    <span className={styles.messageAuthor}>
                      {message.senderKind === "customer" || message.senderKind === "guest" ? <CustomerAvatar size={22} thread={selected} /> : null}
                      {message.senderKind === "staff" ? "Сотрудник" : message.senderKind === "system" ? "Система" : selected.customerName ?? "Клиент"}
                    </span>
                    {(() => {
                      const intake = index === 0 && !olderCursor && message.attachments.length === 0 ? parseChatIntakeMessage(message.body) : null;
                      if (!intake) return message.body ? <p>{message.body}</p> : null;
                      return (
                        <div className={styles.intakeCard}>
                          <strong>Заявка: {intake.intent}</strong>
                          <dl>
                            <dt>Автомобиль</dt><dd data-empty={intake.vehicle === null || undefined}>{intake.vehicle ?? "не указан"}</dd>
                            <dt>Номер детали</dt><dd data-empty={intake.article === null || undefined}>{intake.article ?? "не указан"}</dd>
                          </dl>
                          {intake.comment ? <p>{intake.comment}</p> : null}
                        </div>
                      );
                    })()}
                    {message.attachments.map((attachment) => (
                      <a href={`/api/v1/chat/attachments/${attachment.id}`} key={attachment.id}>{attachment.originalName}</a>
                    ))}
                    <time>{formatDate(message.createdAt)}</time>
                  </article>
                ))}
                <div ref={messageEndRef} />
              </div>
              <div className={styles.composer}>
                <Textarea
                  aria-label="Сообщение клиенту"
                  disabled={selected.status === "closed" || selected.assignedStaffId !== session.userId}
                  onChange={(_event, data) => {
                    if (data.value !== messageText) setMessageAttemptId(null);
                    setMessageText(data.value);
                  }}
                  placeholder={selected.status === "closed" ? "Чат закрыт" : selected.assignedStaffId !== session.userId ? "Ожидаем автоматического назначения" : "Напишите ответ"}
                  resize="vertical"
                  value={messageText}
                />
                <Button
                  appearance="primary"
                  disabled={busy || selected.status === "closed" || selected.assignedStaffId !== session.userId || !messageText.trim()}
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

/** Mirrors the API rule: only the director and administrators delete chats. */
function canDelete(role: Role): boolean {
  return role === "director" || role === "admin";
}
