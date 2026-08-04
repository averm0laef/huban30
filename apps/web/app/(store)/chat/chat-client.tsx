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

import { errorText, readSession, type SessionView } from "../_lib/storefront-api";
import { ChatAttachmentImage } from "./attachment-preview";
import {
  CONNECTION_LABELS,
  GUEST_CHAT_STORAGE_KEY,
  STATUS_LABELS,
  chatRequest,
  formatDate,
  isChatThread,
  isOwnMessage,
  isPreviewableImage,
  parseStoredGuestThreads,
  senderLabel,
  serializeGuestThreads,
  upsertThread,
  type ChatThread,
} from "./chat-state";
import { useChatThread } from "./use-chat-thread";
import styles from "./chat.module.css";

type Viewer =
  | { kind: "customer"; session: SessionView }
  | { kind: "error"; message: string }
  | { kind: "guest" }
  | { kind: "loading" }
  | { kind: "staff" };

interface ThreadListResponse { items: ChatThread[] }
interface GuestThreadResponse extends ChatThread { guestToken: string }

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
  const [draft, setDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const messageEnd = useRef<HTMLDivElement | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [selectedId, threads],
  );

  // "loading"/"error"/"staff" viewers never resolve to a thread channel.
  const viewerKind = viewer.kind === "customer" ? "customer" : viewer.kind === "guest" ? "guest" : null;

  const {
    connection,
    connectionError,
    downloadAttachment,
    downloadError,
    fileError,
    filePending,
    historyError,
    historyLoading,
    lastStaffReadMessageId,
    messages,
    resetFileAttempt,
    resetSendAttempt,
    retryHistory,
    sendAttemptId,
    sendError,
    sendMessage: submitDraft,
    sendPending,
    uploadAttachment: submitAttachment,
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
    messageEnd.current?.scrollIntoView({ block: "end" });
  }, [messages]);

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

  async function uploadAttachment(): Promise<void> {
    if (!selectedFile || !online) return;
    const ok = await submitAttachment(selectedFile);
    if (ok) {
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
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
              {historyError ? <div className={styles.historyError} role="alert"><strong>История не загружена</strong><span>{historyError}</span><button type="button" onClick={retryHistory}>Повторить</button></div> : null}
              {historyLoading ? <div className={styles.historyState} role="status">Загружаем историю</div> : (
                <div className={styles.messages} role="log" aria-live="polite" aria-relevant="additions text">
                  {messages.length === 0 ? <div className={styles.emptyMessages}><strong>Сообщений пока нет</strong><span>Напишите вопрос, и сотрудник ответит в этом чате.</span></div> : null}
                  {messages.map((message) => (
                    <article className={styles.message} data-own={isOwnMessage(message) || undefined} key={message.id}>
                      <header><strong>{senderLabel(message.senderKind)}</strong><time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time></header>
                      {message.body && message.messageType !== "attachment" ? <p>{message.body}</p> : null}
                      {message.attachments.map((attachment) => (
                        isPreviewableImage(attachment) && selectedThread && viewerKind ? (
                          <ChatAttachmentImage
                            attachment={attachment}
                            key={attachment.id}
                            onDownload={() => void downloadAttachment(attachment)}
                            thread={selectedThread}
                            viewerKind={viewerKind}
                          />
                        ) : (
                          <button className={styles.attachment} key={attachment.id} onClick={() => void downloadAttachment(attachment)} type="button">
                            <strong>{attachment.originalName}</strong><span>{Math.max(1, Math.ceil(attachment.byteSize / 1024))} КБ, скачать</span>
                          </button>
                        )
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
                          if (event.target.value !== draft) resetSendAttempt();
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
                          resetFileAttempt();
                        }}
                        ref={fileInput}
                        type="file"
                      />
                      <button disabled={!selectedFile || filePending || !online} onClick={() => void uploadAttachment()} type="button">{filePending ? "Проверяем и загружаем..." : fileError ? "Повторить загрузку" : "Отправить изображение"}</button>
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
