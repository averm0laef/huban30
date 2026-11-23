"use client";

import { Chat24Regular } from "@fluentui/react-icons";
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

import type { ChatIntake, ChatIntakeIntent } from "@an30/contracts";

import { MESSENGERS, STORE_PHONE, STORE_PHONE_DISPLAY } from "../../site-config";

import { errorText, readSession } from "../_lib/storefront-api";
import { ChatAvatar, ChatComposer, ChatMessageLog, ChatSystemPill, presenceLine } from "../chat/chat-conversation";
import {
  GUEST_CHAT_STORAGE_KEY,
  chatRequest,
  chatThreadCreateBody,
  chatThreadRequestId,
  isChatThread,
  parseStoredGuestThreads,
  serializeGuestThreads,
  storeGuestThreadStatus,
  threadNumberLabel,
  upsertThread,
  type ChatAccess,
  type ChatThread,
} from "../chat/chat-state";
import { chatLauncherPlacement, OPEN_CHAT_EVENT } from "./chat-launcher";
import { ManagerJoinNotice } from "../chat/manager-join-notice";
import { useChatThread } from "../chat/use-chat-thread";
import styles from "./chat-widget.module.css";
import { MessengerIcon } from "./messenger-icon";
import { computeShopStatusNow, type ShopStatus } from "./shop-status";

type Viewer =
  | { kind: "customer" }
  | { kind: "error"; message: string }
  | { kind: "guest" }
  | { kind: "loading" }
  | { kind: "staff" };

interface GuestThreadResponse extends ChatThread { guestToken: string }

/**
 * The four intake topics as short chips, in the order customers most often
 * need them. The manager still reads the full contract wording
 * (`CHAT_INTAKE_INTENT_LABELS`) in the opening message, built server-side.
 */
const INTAKE_TOPICS: Array<{
  hint: string;
  intent: ChatIntakeIntent;
  label: string;
  placeholder: string;
}> = [
  { hint: "Автомобиль и нужная деталь", intent: "advice", label: "Подобрать деталь", placeholder: "Например: Toyota Corolla 2012, передние тормозные колодки" },
  { hint: "Артикул или название", intent: "part", label: "Есть артикул", placeholder: "Например: W914/2 или 0 986 494 104" },
  { hint: "Номер заказа и вопрос", intent: "order", label: "Мой заказ", placeholder: "Например: АН-1024, когда можно забрать?" },
  { hint: "Ваш вопрос", intent: "other", label: "Другое", placeholder: "Опишите, с чем помочь" },
];

/** Phone and messenger links, for whoever would rather not wait in the chat. */
function OtherChannels() {
  return (
    <div className={styles.channels}>
      <p>Удобнее в мессенджере или по телефону</p>
      <ul>
        {MESSENGERS.map((messenger) => (
          <li key={messenger.id}>
            <a aria-label={messenger.label} href={messenger.href} rel="noreferrer" target="_blank" title={messenger.label}>
              <MessengerIcon id={messenger.id} />
            </a>
          </li>
        ))}
        <li className={styles.channelPhone}><a href={`tel:${STORE_PHONE}`}>{STORE_PHONE_DISPLAY}</a></li>
      </ul>
    </div>
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

function BackIcon() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
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
  const placement = chatLauncherPlacement(pathname ?? "");
  const hidden = placement === "off";

  const [isOpen, setIsOpen] = useState(false);
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const [viewer, setViewer] = useState<Viewer>({ kind: "loading" });
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [draft, setDraft] = useState("");
  const [bootstrapPending, setBootstrapPending] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const [requestIntent, setRequestIntent] = useState<ChatIntakeIntent>("advice");
  const [requestDetails, setRequestDetails] = useState("");
  const [startingNewConversation, setStartingNewConversation] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Read on open (not at render) so server and client HTML match.
  const [shopStatus, setShopStatus] = useState<ShopStatus | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const focusComposerOnOpenRef = useRef(false);
  const previousUnreadRef = useRef(0);
  const threadRequestRef = useRef<{ answers: string; id: string } | null>(null);
  const titleId = useId();

  const viewerKind = viewer.kind === "customer" ? "customer" : viewer.kind === "guest" ? "guest" : null;
  // Tear the channel down while hidden (e.g. the full /chat page took over)
  // instead of keeping a second, redundant subscription alive underneath.
  const channelActive = !hidden;

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
    threadStatusThreadId,
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

  // Same rule as the full chat page: a status the manager set (closed,
  // reopened) is applied here at once and kept for the guest's next visit.
  useEffect(() => {
    if (!threadStatus || !threadStatusThreadId) return;
    setThread((current) => current && current.id === threadStatusThreadId && current.status !== threadStatus
      ? { ...current, status: threadStatus } : current);
    if (viewer.kind === "guest") storeGuestThreadStatus(threadStatusThreadId, threadStatus);
  }, [threadStatus, threadStatusThreadId, viewer.kind]);

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
    }
    if (!isOpen && dialog.open) dialog.close();
    const initialField = textareaRef.current
      ?? dialog.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), textarea:not(:disabled)");
    if (isOpen && dialog.open && focusComposerOnOpenRef.current && initialField) {
      initialField.focus({ preventScroll: true });
      focusComposerOnOpenRef.current = false;
    }
  }, [isOpen, viewer.kind, threadLoading, thread]);

  // Mobile browsers keep the layout viewport tall when the software
  // keyboard opens. Follow the visual viewport so the composer stays above it.
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const viewport = window.visualViewport;
    if (!dialog || !viewport || window.matchMedia("(min-width: 641px)").matches) return;
    let frame = 0;
    const updateViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        dialog.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
        dialog.style.setProperty("--chat-viewport-top", `${viewport.offsetTop}px`);
        if (document.activeElement === textareaRef.current && viewingLatest) {
          messageEndRef.current?.scrollIntoView({ block: "end" });
        }
      });
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
      dialog.style.removeProperty("--chat-viewport-height");
      dialog.style.removeProperty("--chat-viewport-top");
    };
  }, [isOpen, viewingLatest]);

  // iOS Safari keeps scrolling the page under a modal <dialog>: the page slid
  // into the gap above the keyboard and could carry the sheet off screen.
  // Pin the page in place while the full-screen chat is open and put it back
  // exactly where it was on close.
  useEffect(() => {
    if (!isOpen || window.matchMedia("(min-width: 641px)").matches) return;
    const { body, documentElement: root } = document;
    const scrollY = window.scrollY;
    const previous = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      rootOverflow: root.style.overflow,
    };
    root.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      root.style.overflow = previous.rootOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
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
    // Focus returns here on close: the round button, or the page's own link.
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShopStatus(computeShopStatusNow());
    focusComposerOnOpenRef.current = true;
    setHasOpenedOnce(true);
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleDialogClose = useCallback(() => {
    setIsOpen(false);
    (openerRef.current?.isConnected ? openerRef.current : launcherRef.current)?.focus();
  }, []);

  useEffect(() => {
    if (hidden) return;
    window.addEventListener(OPEN_CHAT_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, handleOpen);
  }, [handleOpen, hidden]);

  async function createConversation(intake: ChatIntake): Promise<{ access: ChatAccess; created: ChatThread }> {
    threadRequestRef.current = chatThreadRequestId(threadRequestRef.current, intake);
    const body = chatThreadCreateBody(intake, null, threadRequestRef.current.id);
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
      threadRequestRef.current = null;
      setThread(created);
      setStartingNewConversation(false);
      setRequestIntent("advice");
      setRequestDetails("");
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
    if (result.closed) {
      setThread((current) => current ? { ...current, status: "closed" } : current);
      if (viewer.kind === "guest") storeGuestThreadStatus(thread.id, "closed");
    }
  }

  async function handleFile(file: File): Promise<boolean> {
    if (!online || !thread || thread.status === "closed") return false;
    if (viewer.kind !== "guest" && viewer.kind !== "customer") return false;
    return submitAttachment(file);
  }

  if (hidden) return null;

  const canChat = viewer.kind === "guest" || viewer.kind === "customer";
  const hasOpenThread = Boolean(thread) && thread?.status !== "closed";
  const showStartForm = !thread || (thread.status === "closed" && startingNewConversation);
  const attachDisabled = !hasOpenThread || filePending || !online;
  const sendDisabled = !hasOpenThread || !draft.trim() || !online || sendPending;
  const isRetry = Boolean(sendAttemptId) && !sendPending;
  const presence = viewer.kind === "loading" || threadLoading ? { text: "открываем чат…", tone: "busy" as const }
    : viewer.kind === "error" ? { text: "чат недоступен", tone: "offline" as const }
      : viewer.kind === "staff" ? { text: "только для покупателей", tone: "away" as const }
        : bootstrapPending ? { text: "отправляем…", tone: "busy" as const }
          : presenceLine({
            assignedStaffId: thread ? assignedStaffId ?? thread.assignedStaffId : null,
            assignedStaffName,
            connection: thread && !showStartForm ? connection : null,
            online,
            shopStatus,
            threadClosed: thread?.status === "closed" && !startingNewConversation,
          });
  const topic = INTAKE_TOPICS.find((item) => item.intent === requestIntent) ?? INTAKE_TOPICS[0]!;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        hidden={placement === "inline"}
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={unreadCount > 0
          ? `Открыть чат с магазином. Непрочитанных сообщений: ${unreadCount}`
          : "Открыть чат с магазином"}
      >
        <Chat24Regular aria-hidden="true" />
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
        onClose={handleDialogClose}
      >
        <header className={styles.header}>
          <button type="button" className={`${styles.headerButton} ${styles.backButton}`} onClick={handleClose} aria-label="Назад к сайту">
            <BackIcon />
          </button>
          <ChatAvatar online={presence.tone === "online"} />
          <div className={styles.headerText}>
            <h2 id={titleId}>Магазин АН-30</h2>
            <span className={styles.presence} data-tone={presence.tone}>{presence.text}</span>
            {thread && !showStartForm && threadNumberLabel(thread) ? <span className={styles.threadNumber}>{threadNumberLabel(thread)}</span> : null}
          </div>
          <div className={styles.headerActions}>
            <a className={`${styles.headerButton} ${styles.mobileOnly}`} href={`tel:${STORE_PHONE}`} aria-label={`Позвонить в магазин: ${STORE_PHONE_DISPLAY}`}>
              <PhoneIcon />
            </a>
            <Link className={`${styles.headerButton} ${styles.desktopOnly}`} href="/chat" onClick={handleClose} aria-label="Открыть чат на отдельной странице" title="Открыть на отдельной странице">
              <ExpandIcon />
            </Link>
            <button type="button" className={`${styles.headerButton} ${styles.desktopOnly}`} onClick={handleClose} aria-label="Закрыть чат">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          {viewer.kind === "loading" ? (
            <div className={styles.state} role="status">Подключаемся…</div>
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
          ) : canChat ? (
            <>
              {!online ? <div className={styles.notice} role="status">Нет подключения. Отправка вернётся, когда появится сеть.</div> : null}
              {historyError ? (
                <div className={styles.notice} role="alert">
                  <span>{historyError}</span>
                  <button type="button" onClick={retryHistory}>Повторить</button>
                </div>
              ) : null}
              {connectionError ? <div className={styles.notice} role="alert">{connectionError}</div> : null}
              {downloadError ? <div className={styles.notice} role="alert">Файл не скачан: {downloadError}</div> : null}

              {showStartForm ? (
                <div className={styles.startScreen}>
                  <form
                    className={styles.startCard}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleIntakeSubmit({
                        articleNumber: null,
                        comment: requestDetails.trim() || null,
                        intent: requestIntent,
                        vehicle: null,
                      });
                    }}
                  >
                    <h3>С чем помочь?</h3>
                    <p>Выберите тему — менеджер увидит её сразу. VIN или артикул ускорят подбор.</p>
                    <fieldset className={styles.topics} disabled={!online || bootstrapPending}>
                      <legend className={styles.visuallyHidden}>Тема обращения</legend>
                      <div>
                        {INTAKE_TOPICS.map((item) => (
                          <label className={styles.topic} key={item.intent}>
                            <input
                              checked={requestIntent === item.intent}
                              name={`${titleId}-intent`}
                              onChange={() => setRequestIntent(item.intent)}
                              type="radio"
                              value={item.intent}
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label htmlFor={`${titleId}-details`}>{topic.hint} <span>— можно оставить пустым</span></label>
                    <textarea
                      disabled={!online || bootstrapPending}
                      id={`${titleId}-details`}
                      maxLength={1_000}
                      onChange={(event) => setRequestDetails(event.target.value)}
                      placeholder={topic.placeholder}
                      rows={3}
                      value={requestDetails}
                    />
                    {bootstrapError ? <p className={styles.inlineError} role="alert">{bootstrapError}</p> : null}
                    <button className={styles.primaryButton} disabled={!online || bootstrapPending} type="submit">
                      {bootstrapPending ? "Открываем чат…" : "Написать магазину"}
                    </button>
                    {!online ? <p className={styles.hint} role="status">Для начала обращения нужно подключение к интернету.</p> : null}
                    <p className={styles.legalNote}>
                      Отправляя сообщение, вы соглашаетесь с <Link href="/privacy" onClick={handleClose}>политикой конфиденциальности</Link>.
                    </p>
                  </form>
                  <OtherChannels />
                </div>
              ) : threadLoading || historyLoading || !thread ? (
                <div className={styles.state} role="status">Загружаем сообщения…</div>
              ) : (
                <ChatMessageLog
                  empty={<><strong>Здравствуйте!</strong>Напишите, что нужно: марку, модель и год автомобиля или артикул детали.</>}
                  footer={thread.status === "closed" ? <ChatSystemPill>Обращение завершено</ChatSystemPill> : null}
                  hasOlderMessages={hasOlderMessages}
                  lastStaffReadMessageId={lastStaffReadMessageId}
                  logId={`${titleId}-message-log`}
                  messageEndRef={messageEndRef}
                  messages={messages}
                  newerMessageCount={newerMessageCount}
                  olderHistoryError={olderHistoryError}
                  olderHistoryLoading={olderHistoryLoading}
                  onDownload={(attachment) => void downloadAttachment(attachment)}
                  onShowLatest={showLatestMessages}
                  onShowOlder={() => void showOlderMessages()}
                  renderedMessages={renderedMessages}
                  thread={thread}
                  viewerKind={viewerKind}
                  viewingLatest={viewingLatest}
                />
              )}
            </>
          ) : null}
        </div>

        {canChat && thread && thread.status !== "closed" ? (
          <div className={styles.footer}>
            <ManagerJoinNotice
              key={thread.id}
              assignedStaffId={assignedStaffId}
              assignedStaffName={assignedStaffName}
              managerWaitSince={managerWaitSince}
              messages={messages}
              status={threadStatus ?? thread.status}
            />
            <ChatComposer
              attachDisabled={attachDisabled}
              draft={draft}
              fileError={fileError}
              filePending={filePending}
              idPrefix={titleId}
              isRetry={isRetry}
              onDraftChange={(value) => {
                if (value !== draft) resetSendAttempt();
                setDraft(value);
              }}
              onFile={handleFile}
              onSubmit={(event) => void handleSubmit(event)}
              sendDisabled={sendDisabled}
              sendError={sendError}
              sendPending={sendPending}
              textareaRef={textareaRef}
            />
          </div>
        ) : canChat && thread?.status === "closed" && !startingNewConversation ? (
          <div className={styles.closedBar}>
            <p>Если остался вопрос или нужен новый подбор, начните новое обращение.</p>
            <button className={styles.primaryButton} type="button" onClick={() => setStartingNewConversation(true)}>Новое обращение</button>
            <OtherChannels />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
