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

import type { ChatIntake } from "@an30/contracts";

import { errorText, readSession, type SessionView } from "../_lib/storefront-api";
import { computeShopStatusNow, type ShopStatus } from "../_components/shop-status";
import { ChatAvatar, ChatComposer, ChatMessageLog, ChatSystemPill, presenceLine } from "./chat-conversation";
import { ChatIntakeForm } from "./chat-intake-form";
import {
  GUEST_CHAT_STORAGE_KEY,
  STATUS_LABELS,
  chatRequest,
  chatThreadCreateBody,
  isChatThread,
  parseStoredGuestThreads,
  serializeGuestThreads,
  threadNumberLabel,
  upsertThread,
  type ChatThread,
} from "./chat-state";
import { listTimeLabel, messagePreview } from "./chat-timeline";
import { ManagerJoinNotice } from "./manager-join-notice";
import { useChatThread } from "./use-chat-thread";
import styles from "./chat.module.css";

type Viewer =
  | { kind: "customer"; session: SessionView }
  | { kind: "error"; message: string }
  | { kind: "guest" }
  | { kind: "loading" }
  | { kind: "staff" };

interface ThreadListResponse { items: ChatThread[] }
type Previews = Record<string, { at: string; text: string }>;

/** The thread list endpoint has no last-message text, so the page keeps the
 * last line it has seen per conversation on this device (preview only). */
const PREVIEW_STORAGE_KEY = "an30_chat_previews_v1";
function readPreviews(): Previews {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PREVIEW_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, { at: string; text: string }] => {
      const value = entry[1] as { at?: unknown; text?: unknown } | null;
      return Boolean(value) && typeof value?.text === "string" && typeof value?.at === "string";
    }).slice(-100));
  } catch { return {}; }
}
interface GuestThreadResponse extends ChatThread { guestToken: string }

export function ChatClient() {
  const [viewer, setViewer] = useState<Viewer>({ kind: "loading" });
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"conversation" | "threads">("conversation");
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [forgetId, setForgetId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [previews, setPreviews] = useState<Previews>({});
  const [shopStatus, setShopStatus] = useState<ShopStatus | null>(null);
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const createForm = useRef<HTMLDivElement | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [selectedId, threads],
  );

  // "loading"/"error"/"staff" viewers never resolve to a thread channel.
  const viewerKind = viewer.kind === "customer" ? "customer" : viewer.kind === "guest" ? "guest" : null;

  const {
    assignedStaffId,
    assignedStaffName,
    managerWaitSince,
    connection,
    connectionError,
    downloadAttachment,
    downloadError,
    fileError,
    filePending,
    hasOlderMessages,
    historyError,
    historyLoading,
    loadOlderMessages,
    lastStaffReadMessageId,
    messages,
    newerMessageCount,
    olderHistoryError,
    olderHistoryLoading,
    renderedMessages,
    resetSendAttempt,
    retryHistory,
    sendAttemptId,
    sendError,
    sendMessage: submitDraft,
    sendPending,
    showLatestMessages,
    threadStatus,
    uploadAttachment: submitAttachment,
    viewingLatest,
  } = useChatThread(selectedThread, viewerKind, true);

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
    setPreviews(readPreviews());
    setShopStatus(computeShopStatusNow());
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
    if (viewingLatest) messageEnd.current?.scrollIntoView({ block: "end" });
  }, [renderedMessages, viewingLatest]);

  const lastMessage = messages.at(-1);
  useEffect(() => {
    if (!selectedId || !lastMessage) return;
    const text = messagePreview(lastMessage);
    setPreviews((current) => {
      if (current[selectedId]?.text === text) return current;
      const next = { ...current, [selectedId]: { at: lastMessage.createdAt, text } };
      try { window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(next)); } catch { /* preview only */ }
      return next;
    });
  }, [lastMessage, selectedId]);

  async function showOlderMessages(): Promise<void> {
    const container = messageEnd.current?.parentElement;
    const containerTop = container?.getBoundingClientRect().top ?? 0;
    const anchor = container
      ? [...container.querySelectorAll<HTMLElement>("[data-chat-message-id]")]
        .find((item) => item.getBoundingClientRect().bottom >= containerTop)
      : null;
    const anchorTop = anchor?.getBoundingClientRect().top ?? 0;
    await loadOlderMessages();
    window.requestAnimationFrame(() => {
      if (!container || !anchor) return;
      const currentAnchor = container.querySelector<HTMLElement>(`[data-chat-message-id="${anchor.dataset.chatMessageId}"]`);
      if (currentAnchor) container.scrollTop += currentAnchor.getBoundingClientRect().top - anchorTop;
    });
  }

  async function createThread(intake: ChatIntake): Promise<void> {
    if (createPending || (viewer.kind !== "guest" && viewer.kind !== "customer")) return;
    const body = chatThreadCreateBody(intake);
    setCreatePending(true);
    setCreateError("");
    try {
      const created = viewer.kind === "guest"
        ? await chatRequest<GuestThreadResponse>("/chat/guest/threads", undefined, { body, method: "POST" })
        : await chatRequest<ChatThread>("/chat/threads", { kind: "customer" }, { body, method: "POST" });
      if (!isChatThread(created)
        || (viewer.kind === "guest" && (!created.guestToken || created.guestToken.length < 32 || created.guestToken.length > 256))) {
        throw new Error("Сервер не вернул безопасный доступ к новому чату");
      }
      const next = upsertThread(threads, created);
      setThreads(next);
      if (viewer.kind === "guest") persistGuestThreads(next);
      setSelectedId(created.id);
      setMobileView("conversation");
      setCreateFormOpen(false);
    } catch (caught) {
      setCreateError(errorText(caught));
    } finally {
      setCreatePending(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedThread || !online) return;
    const body = draft.trim();
    if (!body || body.length > 4_000) return;
    const result = await submitDraft(body);
    if (result.ok) setDraft("");
    if (result.closed) {
      setThreads((current) => current.map((thread) => thread.id === selectedThread.id
        ? { ...thread, status: "closed" } : thread));
    }
  }

  async function uploadAttachment(file: File): Promise<boolean> {
    if (!online || !selectedThread || selectedThread.status === "closed") return false;
    return submitAttachment(file);
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

  function openCreateForm(): void {
    setMobileView("threads");
    setCreateFormOpen(true);
    window.requestAnimationFrame(() => {
      createForm.current?.querySelector<HTMLElement>("select, input, textarea, button")?.focus();
    });
  }

  function showThreads(): void {
    setMobileView("threads");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-customer-chat-thread][aria-current='true'], [data-customer-chat-thread]")?.focus();
    });
  }

  function openThread(threadId: string): void {
    setForgetId(null);
    setSelectedId(threadId);
    setMobileView("conversation");
    // Desktop only: on a phone focusing would pop up the keyboard uninvited.
    if (window.matchMedia("(min-width: 768px)").matches) {
      window.requestAnimationFrame(() => document.getElementById("chat-message")?.focus({ preventScroll: true }));
    }
  }

  if (viewer.kind === "loading") {
    return <div className={styles.page}><div className={styles.statePanel} role="status"><h1>Открываем чат</h1><p>Загружаем ваши обращения.</p></div></div>;
  }
  if (viewer.kind === "error") {
    return <div className={styles.page}><div className={styles.statePanel} role="alert"><h1>Чат пока недоступен</h1><p>{viewer.message}</p><button type="button" onClick={() => void initialize()}>Повторить</button></div></div>;
  }
  if (viewer.kind === "staff") {
    return <div className={styles.page}><div className={styles.statePanel}><h1>Клиентский чат</h1><p>Для рабочей очереди сотрудников используйте защищённую админку.</p><Link href="/admin/chats">Открыть рабочее место</Link></div></div>;
  }

  const threadClosed = selectedThread?.status === "closed";
  const query = search.trim().toLocaleLowerCase("ru");
  const visibleThreads = query
    ? threads.filter((thread) => `${thread.subject ?? ""} ${thread.orderId ?? ""} ${previews[thread.id]?.text ?? ""}`.toLocaleLowerCase("ru").includes(query))
    : threads;
  const presence = presenceLine({
    assignedStaffId: selectedThread ? assignedStaffId ?? selectedThread.assignedStaffId : null,
    assignedStaffName,
    connection,
    online,
    shopStatus,
    threadClosed,
  });
  const isRetry = Boolean(sendAttemptId) && !sendPending;

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>Чат с магазином АН-30</h1>
      {!online ? <div className={styles.notice} role="status"><strong>Нет подключения</strong><span>История остаётся на экране, отправка вернётся вместе с сетью.</span></div> : null}
      {storageWarning ? <div className={styles.warning} role="alert"><strong>Доступ сохранён только на этой странице</strong><span>{storageWarning}</span></div> : null}
      <div className={styles.workspace} data-mobile-view={selectedThread ? mobileView : "threads"}>
        <aside className={styles.sidebar} aria-label="Обращения">
          <div className={styles.sidebarTop}>
            <label className={styles.visuallyHidden} htmlFor="chat-thread-search">Поиск по обращениям</label>
            <input
              className={styles.search}
              id="chat-thread-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск"
              type="search"
              value={search}
            />
            <button
              aria-controls="chat-intake-form"
              aria-expanded={createFormOpen}
              className={styles.newButton}
              onClick={() => { if (createFormOpen) setCreateFormOpen(false); else openCreateForm(); }}
              type="button"
            >{createFormOpen ? "Скрыть" : "Новое"}</button>
          </div>
          <div className={styles.createForm} data-open={createFormOpen || undefined} id="chat-intake-form" ref={createForm}>
            <ChatIntakeForm disabled={!online} error={createError} onSubmit={(intake) => void createThread(intake)} pending={createPending} />
          </div>
          {threadsError ? <div className={styles.listError} role="alert"><strong>Список не загружен</strong><span>{threadsError}</span><button type="button" onClick={() => void loadThreads(viewer)}>Повторить</button></div> : null}
          {threadsLoading ? <div className={styles.listState} role="status">Загружаем обращения…</div> : null}
          {!threadsLoading && !threadsError && threads.length === 0 && !createFormOpen ? (
            <div className={styles.listState}>
              <strong>Пока нет обращений</strong>
              <span>Спросите про деталь или заказ — ответит сотрудник магазина.</span>
              <button className={styles.primaryButton} onClick={openCreateForm} type="button">Написать магазину</button>
            </div>
          ) : null}
          {query && threads.length > 0 && visibleThreads.length === 0 ? <div className={styles.listState}>Ничего не нашлось</div> : null}
          <ul className={styles.threadList} aria-label="Ваши обращения">
            {visibleThreads.map((thread, index) => {
              const active = thread.id === selectedId;
              const preview = previews[thread.id];
              const time = preview && (!thread.lastMessageAt || preview.at >= thread.lastMessageAt) ? preview.at : thread.lastMessageAt ?? thread.createdAt;
              const unread = active && !viewingLatest ? newerMessageCount : 0;
              return (
                <li className={styles.threadRow} data-active={active || undefined} key={thread.id}>
                  <button
                    aria-current={active ? "true" : undefined}
                    data-customer-chat-thread
                    onClick={() => openThread(thread.id)}
                    onKeyDown={(event) => focusThread(event, index)}
                    type="button"
                  >
                    <ChatAvatar size="lg" tone={active || thread.status !== "closed" ? "brand" : "muted"} />
                    <span className={styles.threadText}>
                      <span className={styles.threadLine}>
                        <strong>{thread.subject ?? "Обращение"}</strong>
                        <time dateTime={time}>{listTimeLabel(time)}</time>
                      </span>
                      <span className={styles.threadLine}>
                        <span className={styles.threadPreview}>{preview?.text ?? STATUS_LABELS[thread.status]}</span>
                        {unread > 0 ? <span className={styles.unread} aria-label={`Новых сообщений: ${unread}`}>{unread > 99 ? "99+" : unread}</span>
                          : thread.status === "closed" ? <span className={styles.closedTag}>завершено</span> : null}
                      </span>
                    </span>
                  </button>
                  {viewer.kind === "guest" && active ? (
                    forgetId === thread.id ? (
                      <div className={styles.forgetConfirm} role="alert">
                        <span>Переписку на этом устройстве открыть снова не получится.</span>
                        <button type="button" onClick={() => forgetGuestThread(thread.id)}>Удалить доступ</button>
                        <button type="button" onClick={() => setForgetId(null)}>Отмена</button>
                      </div>
                    ) : <button className={styles.forgetButton} type="button" onClick={() => setForgetId(thread.id)}>Убрать с этого устройства</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </aside>
        <section className={styles.conversation} aria-label="Переписка">
          {!selectedThread ? (
            <div className={styles.conversationEmpty}>
              <ChatAvatar size="lg" />
              <h2>{threadsLoading ? "Загружаем беседу" : "Чат с магазином АН-30"}</h2>
              <p>{threadsLoading ? "Сейчас покажем ваши обращения." : threads.length ? "Выберите обращение слева, чтобы продолжить переписку." : "Подскажем по детали или заказу. VIN или артикул помогут быстрее разобраться."}</p>
              {!threadsLoading && !threads.length ? <button className={styles.primaryButton} onClick={openCreateForm} type="button">Написать магазину</button> : null}
            </div>
          ) : (
            <>
              <header className={styles.conversationHeader}>
                <button aria-label="Назад к обращениям" className={styles.backButton} onClick={showThreads} type="button">
                  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5-7 7 7 7" /></svg>
                </button>
                <ChatAvatar online={presence.tone === "online"} />
                <div className={styles.conversationTitle}>
                  <h2>{selectedThread.subject ?? "Обращение"}</h2>
                  <span data-tone={presence.tone}>{presence.text}</span>
                  {threadNumberLabel(selectedThread) ? <small>{threadNumberLabel(selectedThread)}</small> : null}
                </div>
              </header>
              {connectionError ? <div className={styles.inlineError} role="alert">{connectionError}</div> : null}
              {historyError ? <div className={styles.historyError} role="alert"><strong>История не загружена</strong><span>{historyError}</span><button type="button" onClick={retryHistory}>Повторить</button></div> : null}
              {downloadError ? <div className={styles.inlineError} role="alert">Файл не скачан: {downloadError}</div> : null}
              {historyLoading ? <div className={styles.historyState} role="status">Загружаем историю…</div> : (
                <ChatMessageLog
                  key={selectedThread.id}
                  empty={<><strong>Здравствуйте! Вы в чате магазина АН-30</strong>Укажите VIN или марку, модель и год автомобиля и нужную деталь. Фото или короткое видео помогут показать деталь.</>}
                  footer={threadClosed ? <ChatSystemPill>Обращение завершено</ChatSystemPill> : null}
                  hasOlderMessages={hasOlderMessages}
                  lastStaffReadMessageId={lastStaffReadMessageId}
                  logId="chat-message-log"
                  messageEndRef={messageEnd}
                  messages={messages}
                  newerMessageCount={newerMessageCount}
                  olderHistoryError={olderHistoryError}
                  olderHistoryLoading={olderHistoryLoading}
                  onDownload={(attachment) => void downloadAttachment(attachment)}
                  onShowLatest={showLatestMessages}
                  onShowOlder={() => void showOlderMessages()}
                  renderedMessages={renderedMessages}
                  thread={selectedThread}
                  viewerKind={viewerKind}
                  viewingLatest={viewingLatest}
                />
              )}
              {threadClosed ? (
                <div className={styles.closedBar}>
                  <span>Чат закрыт. Если вопрос остался, начните новое обращение.</span>
                  <button className={styles.primaryButton} onClick={openCreateForm} type="button">Новое обращение</button>
                </div>
              ) : (
                <div className={styles.footer}>
                  <ManagerJoinNotice
                    key={selectedThread.id}
                    assignedStaffId={assignedStaffId}
                    assignedStaffName={assignedStaffName}
                    managerWaitSince={managerWaitSince}
                    messages={messages}
                    status={threadStatus ?? selectedThread.status}
                  />
                  <ChatComposer
                    attachDisabled={filePending || !online}
                    draft={draft}
                    fileError={fileError}
                    filePending={filePending}
                    idPrefix="chat"
                    isRetry={isRetry}
                    onDraftChange={(value) => {
                      if (value !== draft) resetSendAttempt();
                      setDraft(value);
                    }}
                    onFile={uploadAttachment}
                    onSubmit={(event) => void sendMessage(event)}
                    sendDisabled={sendPending || !draft.trim() || !online}
                    sendError={sendError}
                    sendPending={sendPending}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
