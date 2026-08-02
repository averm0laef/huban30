"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { errorText, readSession } from "../_lib/storefront-api";
import {
  CONNECTION_LABELS,
  GUEST_CHAT_STORAGE_KEY,
  chatRequest,
  formatDate,
  isChatThread,
  isOwnMessage,
  parseStoredGuestThreads,
  sendChatMessageRest,
  senderLabel,
  serializeGuestThreads,
  upsertThread,
  type ChatThread,
} from "../chat/chat-state";
import { useChatThread } from "../chat/use-chat-thread";
import styles from "./chat-widget.module.css";

/** Subject staff sees in their queue for a thread the widget started lazily. */
const DEFAULT_SUBJECT = "Обращение из чата на сайте";

type Viewer =
  | { kind: "customer" }
  | { kind: "error"; message: string }
  | { kind: "guest" }
  | { kind: "loading" }
  | { kind: "staff" };

interface GuestThreadResponse extends ChatThread { guestToken: string }

function isHiddenRoute(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/")
    || pathname === "/admin" || pathname.startsWith("/admin/");
}

function ChatBubbleIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4H4v5M15 20h5v-5M4 20l6.5-6.5M20 4l-6.5 6.5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function AttachImageIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m5 18 5-5 3 3 3-4 4 6" />
    </svg>
  );
}

/**
 * Floating "chat with the manager" launcher + panel, mounted once in
 * `layout.tsx` above every storefront page. It is a second presentation of
 * the same chat state as `/chat` (see chat/use-chat-thread.ts) — no
 * separate backend logic lives here, only a compact single-thread UI and
 * the lazy "resolve/bootstrap a thread" glue the full inbox page doesn't
 * need.
 */
export function ChatWidget() {
  const pathname = usePathname();
  const hidden = isHiddenRoute(pathname ?? "");

  const [isOpen, setIsOpen] = useState(false);
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const [viewer, setViewer] = useState<Viewer>({ kind: "loading" });
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [draft, setDraft] = useState("");
  const [bootstrapPending, setBootstrapPending] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const previousUnreadRef = useRef(0);
  const titleId = useId();

  const viewerKind = viewer.kind === "customer" ? "customer" : viewer.kind === "guest" ? "guest" : null;
  // Tear the channel down while hidden (e.g. the full /chat page took over)
  // instead of keeping a second, redundant subscription alive underneath.
  const channelActive = !hidden;

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
    resetSendAttempt,
    retryHistory,
    sendAttemptId,
    sendError,
    sendMessage: submitDraft,
    sendPending,
    unreadCount,
    uploadAttachment: submitAttachment,
  } = useChatThread(channelActive ? thread : null, channelActive ? viewerKind : null, isOpen);

  const resolveConversation = useCallback(async () => {
    setViewer({ kind: "loading" });
    setThreadLoading(true);
    try {
      const session = await readSession();
      const nextViewer: Viewer = !session
        ? { kind: "guest" }
        : session.role === "customer"
          ? { kind: "customer" }
          : { kind: "staff" };
      setViewer(nextViewer);
      if (nextViewer.kind === "guest") {
        const stored = parseStoredGuestThreads(window.localStorage.getItem(GUEST_CHAT_STORAGE_KEY));
        setThread(stored[0] ?? null);
      } else if (nextViewer.kind === "customer") {
        const result = await chatRequest<{ items: ChatThread[] }>("/chat/threads");
        if (!Array.isArray(result.items) || result.items.some((item) => !isChatThread(item))) {
          throw new Error("Сервер вернул повреждённый список чатов");
        }
        setThread(result.items[0] ?? null);
      }
    } catch (caught) {
      setViewer({ kind: "error", message: errorText(caught) });
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasOpenedOnce) void resolveConversation();
  }, [hasOpenedOnce, resolveConversation]);

  useEffect(() => {
    setOnline(window.navigator.onLine);
    const update = () => setOnline(window.navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (viewer.kind !== "guest") return;
    const sync = (event: StorageEvent) => {
      if (event.key !== GUEST_CHAT_STORAGE_KEY) return;
      const next = parseStoredGuestThreads(event.newValue);
      setThread((current) => next.find((item) => item.id === current?.id) ?? next[0] ?? null);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [viewer.kind]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Native <dialog> owns focus-trapping, background inertness and the
  // Escape -> cancel gesture; this effect just keeps it in sync with React
  // state, matching the CartPanel dialog convention used elsewhere here.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      textareaRef.current?.focus();
    }
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  useEffect(() => {
    if (hidden && isOpen) setIsOpen(false);
  }, [hidden, isOpen]);

  useEffect(() => {
    if (unreadCount > previousUnreadRef.current) {
      setAnnouncement(unreadCount === 1
        ? "Пришло новое сообщение от магазина"
        : `Пришли новые сообщения от магазина: ${unreadCount}`);
    }
    previousUnreadRef.current = unreadCount;
  }, [unreadCount]);

  const handleOpen = useCallback(() => {
    setHasOpenedOnce(true);
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    launcherRef.current?.focus();
  }, []);

  async function bootstrapThreadAndSend(body: string): Promise<void> {
    setBootstrapPending(true);
    setBootstrapError("");
    try {
      if (viewer.kind === "guest") {
        const created = await chatRequest<GuestThreadResponse>("/chat/guest/threads", undefined, {
          body: { orderId: null, subject: DEFAULT_SUBJECT }, method: "POST",
        });
        if (!isChatThread(created) || !created.guestToken || created.guestToken.length < 32 || created.guestToken.length > 256) {
          throw new Error("Сервер не вернул безопасный доступ к новому чату");
        }
        const stored = parseStoredGuestThreads(window.localStorage.getItem(GUEST_CHAT_STORAGE_KEY));
        try {
          window.localStorage.setItem(GUEST_CHAT_STORAGE_KEY, serializeGuestThreads(upsertThread(stored, created)));
        } catch {
          // Best effort: the conversation still works for this page view
          // even when the browser refuses persistent storage.
        }
        await sendChatMessageRest(created, { guestToken: created.guestToken, kind: "guest" }, body, crypto.randomUUID());
        setThread(created);
      } else if (viewer.kind === "customer") {
        const created = await chatRequest<ChatThread>("/chat/threads", { kind: "customer" }, {
          body: { orderId: null, subject: DEFAULT_SUBJECT }, method: "POST",
        });
        if (!isChatThread(created)) throw new Error("Сервер не вернул безопасный доступ к новому чату");
        await sendChatMessageRest(created, { kind: "customer" }, body, crypto.randomUUID());
        setThread(created);
      }
      setDraft("");
    } catch (caught) {
      setBootstrapError(errorText(caught));
    } finally {
      setBootstrapPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!online || bootstrapPending || sendPending) return;
    if (viewer.kind !== "guest" && viewer.kind !== "customer") return;
    const body = draft.trim();
    if (!body || body.length > 4_000) return;
    if (!thread || thread.status === "closed") {
      await bootstrapThreadAndSend(body);
      return;
    }
    const result = await submitDraft(body);
    if (result.ok) setDraft("");
    if (result.closed) setThread((current) => current ? { ...current, status: "closed" } : current);
  }

  async function handleFileChange(file: File | null): Promise<void> {
    if (!file || !online || !thread || thread.status === "closed") return;
    await submitAttachment(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (hidden) return null;

  const canChat = viewer.kind === "guest" || viewer.kind === "customer";
  const attachDisabled = !thread || thread.status === "closed" || filePending || !online || bootstrapPending;
  const sendDisabled = !draft.trim() || !online || bootstrapPending || sendPending;
  const isRetry = Boolean(sendAttemptId) && !sendPending;
  const statusVariant = viewer.kind === "loading" || threadLoading ? "busy"
    : viewer.kind === "error" ? "error"
      : viewer.kind === "staff" ? "muted"
        : !online ? "error"
          : !thread ? "muted"
            : bootstrapPending ? "busy"
              : connection === "live" ? "live"
                : connection === "error" || connection === "offline" ? "error"
                  : "busy";
  const statusText = viewer.kind === "loading" || threadLoading ? "Открываем чат…"
    : viewer.kind === "error" ? "Чат недоступен"
      : viewer.kind === "staff" ? "Только для покупателей"
        : !online ? "Нет сети"
          : !thread ? "Новое обращение"
            : bootstrapPending ? "Отправляем…"
              : CONNECTION_LABELS[connection];

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={unreadCount > 0
          ? `Открыть чат с магазином. Непрочитанных сообщений: ${unreadCount}`
          : "Открыть чат с магазином"}
      >
        <ChatBubbleIcon />
        {unreadCount > 0 ? <span className={styles.badge} aria-hidden="true">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
      </button>

      <div aria-live="polite" className={styles.visuallyHidden}>{announcement}</div>

      <dialog
        ref={dialogRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onCancel={handleClose}
        onClose={handleClose}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 id={titleId}>Чат с магазином</h2>
            <span className={styles.headerStatus} data-state={statusVariant}>
              <span aria-hidden="true" className={styles.statusDot} data-state={statusVariant} />
              {statusText}
            </span>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.headerButton} href="/chat" onClick={handleClose} aria-label="Открыть чат на отдельной странице">
              <ExpandIcon />
            </Link>
            <button type="button" className={styles.headerButton} onClick={handleClose} aria-label="Закрыть чат">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          {viewer.kind === "loading" ? (
            <div className={styles.state} role="status">Проверяем сессию…</div>
          ) : viewer.kind === "error" ? (
            <div className={styles.state} role="alert">
              <p>{viewer.message}</p>
              <button type="button" onClick={() => void resolveConversation()}>Повторить</button>
            </div>
          ) : viewer.kind === "staff" ? (
            <div className={styles.state}>
              <p>Этот чат — для покупателей. Обращения от сотрудников обрабатываются в рабочем месте.</p>
              <Link href="/admin/chats" onClick={handleClose}>Открыть рабочее место</Link>
            </div>
          ) : (
            <>
              {!online ? <div className={styles.notice} role="status">Нет подключения. Сообщения отправятся, когда сеть вернётся.</div> : null}
              {historyError ? (
                <div className={styles.notice} role="alert">
                  <span>{historyError}</span>
                  <button type="button" onClick={retryHistory}>Повторить</button>
                </div>
              ) : null}
              {connectionError ? <div className={styles.notice} role="alert">{connectionError}</div> : null}
              {downloadError ? <div className={styles.notice} role="alert">Файл не скачан: {downloadError}</div> : null}

              {threadLoading || historyLoading ? (
                <div className={styles.state} role="status">Загружаем сообщения…</div>
              ) : (
                <div className={styles.messages} role="log" aria-live="polite" aria-relevant="additions text">
                  {messages.length === 0 ? (
                    <div className={styles.empty}>
                      <strong>Сообщений пока нет</strong>
                      <span>Напишите вопрос, и сотрудник магазина ответит здесь.</span>
                    </div>
                  ) : null}
                  {messages.map((message) => (
                    <article className={styles.message} data-own={isOwnMessage(message) || undefined} key={message.id}>
                      <header>
                        <strong>{senderLabel(message.senderKind)}</strong>
                        <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                      </header>
                      {message.body && message.messageType !== "attachment" ? <p>{message.body}</p> : null}
                      {message.attachments.map((attachment) => (
                        <button className={styles.attachment} key={attachment.id} onClick={() => void downloadAttachment(attachment)} type="button">
                          <strong>{attachment.originalName}</strong>
                          <span>{Math.max(1, Math.ceil(attachment.byteSize / 1024))} КБ, скачать</span>
                        </button>
                      ))}
                      {isOwnMessage(message) && lastStaffReadMessageId === message.id ? <small>Прочитано магазином</small> : null}
                    </article>
                  ))}
                  {thread?.status === "closed" ? (
                    <div className={styles.systemNotice}>Обращение закрыто. Отправьте сообщение, чтобы начать новое.</div>
                  ) : null}
                  <div ref={messageEndRef} />
                </div>
              )}
            </>
          )}
        </div>

        {canChat ? (
          <form className={styles.composer} onSubmit={(event) => void handleSubmit(event)}>
            <label className={styles.visuallyHidden} htmlFor={`${titleId}-message`}>Сообщение магазину</label>
            <div className={styles.composerRow}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={attachDisabled}
                aria-label={!thread || thread.status === "closed" ? "Сначала отправьте сообщение, затем можно приложить изображение" : "Прикрепить изображение"}
              >
                <AttachImageIcon />
              </button>
              <input
                accept="image/jpeg,image/png,image/webp"
                className={styles.visuallyHidden}
                id={`${titleId}-file`}
                onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
                ref={fileInputRef}
                tabIndex={-1}
                type="file"
              />
              <textarea
                className={styles.textarea}
                id={`${titleId}-message`}
                maxLength={4_000}
                onChange={(event) => {
                  if (event.target.value !== draft) resetSendAttempt();
                  setDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Введите сообщение..."
                ref={textareaRef}
                rows={1}
                value={draft}
              />
              <button
                aria-label={isRetry ? "Повторить отправку сообщения" : "Отправить сообщение"}
                className={styles.sendButton}
                data-pending={sendPending || bootstrapPending || undefined}
                disabled={sendDisabled}
                type="submit"
              >
                {isRetry ? <RetryIcon /> : <SendIcon />}
              </button>
            </div>
            {sendError || bootstrapError ? <p className={styles.inlineError} role="alert">{sendError || bootstrapError}</p> : null}
            {fileError ? <p className={styles.inlineError} role="alert">{fileError}</p> : null}
            {filePending ? <p className={styles.hint} role="status">Загружаем изображение…</p> : null}
          </form>
        ) : null}
      </dialog>
    </>
  );
}
