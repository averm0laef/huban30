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

import type { ChatIntake } from "@an30/contracts";

import { errorText, readSession } from "../_lib/storefront-api";
import { ChatAttachmentMedia } from "../chat/attachment-preview";
import { ChatIntakeForm } from "../chat/chat-intake-form";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CONNECTION_LABELS,
  GUEST_CHAT_STORAGE_KEY,
  chatRequest,
  chatThreadCreateBody,
  formatDate,
  isChatThread,
  isOwnMessage,
  isPreviewableMedia,
  parseStoredGuestThreads,
  senderLabel,
  serializeGuestThreads,
  upsertThread,
  type ChatAccess,
  type ChatThread,
} from "../chat/chat-state";
import { ManagerJoinNotice } from "../chat/manager-join-notice";
import { useChatThread } from "../chat/use-chat-thread";
import styles from "./chat-widget.module.css";

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
    assignedStaffId,
    assignedStaffName,
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
    unreadCount,
    uploadAttachment: submitAttachment,
    viewingLatest,
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
    if (viewingLatest) messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [renderedMessages, viewingLatest]);

  async function showOlderMessages(): Promise<void> {
    const container = messageEndRef.current?.parentElement;
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

  async function createConversation(intake: ChatIntake): Promise<{ access: ChatAccess; created: ChatThread }> {
    const body = chatThreadCreateBody(intake);
    if (viewer.kind === "guest") {
      const created = await chatRequest<GuestThreadResponse>("/chat/guest/threads", undefined, { body, method: "POST" });
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
      return { access: { guestToken: created.guestToken, kind: "guest" }, created };
    }
    if (viewer.kind === "customer") {
      const created = await chatRequest<ChatThread>("/chat/threads", { kind: "customer" }, { body, method: "POST" });
      if (!isChatThread(created)) throw new Error("Сервер не вернул безопасный доступ к новому чату");
      return { access: { kind: "customer" }, created };
    }
    throw new Error("Чат доступен только покупателям");
  }

  // The intake questionnaire's answers become the thread's opening message
  // server-side (see intakeOpeningMessage in chat.service.ts), so creating
  // the thread is the entire "start a conversation" step — there is no
  // separate first message to send from here.
  async function handleIntakeSubmit(intake: ChatIntake): Promise<void> {
    if (!online || bootstrapPending) return;
    setBootstrapPending(true);
    setBootstrapError("");
    try {
      const { created } = await createConversation(intake);
      setThread(created);
    } catch (caught) {
      setBootstrapError(errorText(caught));
    } finally {
      setBootstrapPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!online || !thread || thread.status === "closed" || sendPending) return;
    if (viewer.kind !== "guest" && viewer.kind !== "customer") return;
    const body = draft.trim();
    if (!body || body.length > 4_000) return;
    const result = await submitDraft(body);
    if (result.ok) setDraft("");
    if (result.closed) setThread((current) => current ? { ...current, status: "closed" } : current);
  }

  async function handleFileChange(file: File | null): Promise<void> {
    if (!file || !online || !thread || thread.status === "closed") return;
    if (viewer.kind !== "guest" && viewer.kind !== "customer") return;
    await submitAttachment(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (hidden) return null;

  const canChat = viewer.kind === "guest" || viewer.kind === "customer";
  const hasOpenThread = Boolean(thread) && thread?.status !== "closed";
  const attachDisabled = !hasOpenThread || filePending || !online;
  const sendDisabled = !hasOpenThread || !draft.trim() || !online || sendPending;
  const isRetry = Boolean(sendAttemptId) && !sendPending;
  const statusVariant = viewer.kind === "loading" || threadLoading ? "busy"
    : viewer.kind === "error" ? "error"
      : viewer.kind === "staff" ? "muted"
        : !online ? "error"
          : bootstrapPending ? "busy"
            : !thread ? "muted"
              : connection === "live" ? "live"
                : connection === "error" || connection === "offline" ? "error"
                  : "busy";
  const statusText = viewer.kind === "loading" || threadLoading ? "Открываем чат…"
    : viewer.kind === "error" ? "Чат недоступен"
      : viewer.kind === "staff" ? "Только для покупателей"
        : !online ? "Нет сети"
          : bootstrapPending ? "Отправляем…"
            : !thread ? "Новое обращение"
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
                <div
                  aria-busy={olderHistoryLoading || undefined}
                  aria-live={viewingLatest ? "polite" : "off"}
                  aria-relevant="additions text"
                  className={styles.messages}
                  id={`${titleId}-message-log`}
                  role="log"
                >
                  {hasOlderMessages || !viewingLatest ? (
                    <div className={styles.historyControls}>
                      {hasOlderMessages ? (
                        <button
                          aria-controls={`${titleId}-message-log`}
                          disabled={olderHistoryLoading}
                          onClick={() => void showOlderMessages()}
                          type="button"
                        >
                          {olderHistoryLoading
                            ? "Загружаем предыдущие..."
                            : olderHistoryError
                              ? "Повторить загрузку предыдущих"
                              : "Показать предыдущие"}
                        </button>
                      ) : <span>Это начало переписки.</span>}
                      {!viewingLatest ? (
                        <button aria-controls={`${titleId}-message-log`} onClick={showLatestMessages} type="button">
                          {newerMessageCount > 0 ? `К последним (${newerMessageCount})` : "К последним"}
                        </button>
                      ) : null}
                      {olderHistoryError ? <span role="alert">{olderHistoryError}</span> : null}
                    </div>
                  ) : null}
                  <article className={styles.welcomeMessage}>
                    <header><strong>АН-30</strong></header>
                    <p>Здравствуйте! Поможем подобрать нужную деталь.</p>
                    <p>Отправьте VIN или марку, модель и год автомобиля, затем название детали или артикул. Фото или короткое видео можно прикрепить кнопкой ниже.</p>
                  </article>
                  {renderedMessages.map((message) => (
                    <article
                      className={styles.message}
                      data-chat-message-id={message.id}
                      data-own={isOwnMessage(message) || undefined}
                      key={message.id}
                    >
                      <header>
                        <strong>{senderLabel(message.senderKind)}</strong>
                        <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                      </header>
                      {message.body && message.messageType !== "attachment" ? <p>{message.body}</p> : null}
                      {message.attachments.map((attachment) => (
                        isPreviewableMedia(attachment) && thread && viewerKind ? (
                          <ChatAttachmentMedia
                            attachment={attachment}
                            key={attachment.id}
                            onDownload={() => void downloadAttachment(attachment)}
                            thread={thread}
                            viewerKind={viewerKind}
                          />
                        ) : (
                          <button className={styles.attachment} key={attachment.id} onClick={() => void downloadAttachment(attachment)} type="button">
                            <strong>{attachment.originalName}</strong>
                            <span>{Math.max(1, Math.ceil(attachment.byteSize / 1024))} КБ, скачать</span>
                          </button>
                        )
                      ))}
                      {isOwnMessage(message) && lastStaffReadMessageId === message.id ? <small>Прочитано магазином</small> : null}
                    </article>
                  ))}
                  {thread?.status === "closed" ? (
                    <div className={styles.systemNotice}>Обращение закрыто. Заполните форму ниже, чтобы начать новое.</div>
                  ) : null}
                  <div ref={messageEndRef} />
                </div>
              )}
            </>
          )}
        </div>

        {canChat ? (
          <div className={styles.composer}>
            {thread && thread.status !== "closed" ? (
              <>
                <ManagerJoinNotice
                  assignedStaffId={assignedStaffId}
                  assignedStaffName={assignedStaffName}
                  messages={messages}
                  status={threadStatus ?? thread.status}
                />
                <form onSubmit={(event) => void handleSubmit(event)}>
                  <label className={styles.visuallyHidden} htmlFor={`${titleId}-message`}>Сообщение магазину</label>
                  <div className={styles.composerRow}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={attachDisabled}
                      aria-label="Прикрепить фото или видео"
                    >
                      <AttachImageIcon />
                    </button>
                    <input
                      accept={CHAT_ATTACHMENT_ACCEPT}
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
                      data-pending={sendPending || undefined}
                      disabled={sendDisabled}
                      type="submit"
                    >
                      {isRetry ? <RetryIcon /> : <SendIcon />}
                    </button>
                  </div>
                  {sendError ? <p className={styles.inlineError} role="alert">{sendError}</p> : null}
                  {fileError ? <p className={styles.inlineError} role="alert">{fileError}</p> : null}
                  <p className={styles.hint}>Фото до 5 МБ. Видео до 15 МБ и до 2 минут.</p>
                  {filePending ? <p className={styles.hint} role="status">Загружаем файл…</p> : null}
                </form>
              </>
            ) : (
              <ChatIntakeForm
                disabled={!online}
                error={bootstrapError}
                onSubmit={(intake) => void handleIntakeSubmit(intake)}
                pending={bootstrapPending}
              />
            )}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
