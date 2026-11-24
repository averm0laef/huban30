"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { parseChatIntakeMessage } from "@an30/contracts";

import { BrandWheel } from "../_components/brand-mark";
import type { ShopStatus } from "../_components/shop-status";
import { ChatAttachmentMedia } from "./attachment-preview";
import { ChatIntakeCard } from "./chat-intake-card";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isPreviewableMedia,
  type ChatAttachment,
  type ChatMessage,
  type ChatThread,
  type ConnectionState,
} from "./chat-state";
import { buildTimeline, timeLabel, type DeliveryMark } from "./chat-timeline";
import styles from "./chat-conversation.module.css";
import { checkChatAttachment, formatSize } from "./attachment-check";

/**
 * Messenger-style pieces shared by the floating widget and the /chat page:
 * avatar, presence line, message log (date pills, grouped bubbles, ticks)
 * and the composer. They render only; all chat state stays in
 * `useChatThread` and the two surfaces.
 */

export type PresenceTone = "away" | "busy" | "offline" | "online";

export function ChatAvatar({ online = false, size = "md", tone = "brand" }: { online?: boolean; size?: "lg" | "md" | "sm"; tone?: "brand" | "muted" }) {
  return (
    <span aria-hidden="true" className={styles.avatar} data-size={size} data-tone={tone}>
      <BrandWheel className={styles.avatarWheel} />
      {online ? <span className={styles.onlineDot} /> : null}
    </span>
  );
}

/**
 * One honest status line: the backend reports connection state and the
 * assigned manager, the schedule says whether managers are at work. There
 * is no typing or presence signal, so none is invented.
 */
export function presenceLine(input: {
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  connection?: ConnectionState | null;
  online: boolean;
  shopStatus: ShopStatus | null;
  threadClosed?: boolean;
}): { text: string; tone: PresenceTone } {
  if (!input.online) return { text: "нет сети", tone: "offline" };
  if (input.connection === "connecting" || input.connection === "reconnecting") return { text: "подключаемся…", tone: "busy" };
  if (input.connection === "error" || input.connection === "offline") return { text: "нет связи с чатом", tone: "offline" };
  if (input.threadClosed) return { text: "обращение завершено", tone: "away" };
  if (input.assignedStaffId) {
    return { text: input.assignedStaffName ? `${input.assignedStaffName} на связи` : "менеджер на связи", tone: "online" };
  }
  if (!input.shopStatus) return { text: "чат магазина", tone: "away" };
  return input.shopStatus.open
    ? { text: "менеджеры на связи", tone: "online" }
    : { text: `ответим ${input.shopStatus.detail.replace(/^откроется /u, "").replace(/ в (\d)/u, " с $1")}`, tone: "away" };
}

function Ticks({ mark }: { mark: DeliveryMark }) {
  return (
    <span className={styles.ticks} data-read={mark === "read" || undefined}>
      <svg aria-hidden="true" viewBox="0 0 18 12" width="16" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6.5 4.5 10 11 2" />
        {mark === "read" ? <path d="M7.5 9.2 8.5 10 15 2" /> : null}
      </svg>
      <span className={styles.visuallyHidden}>{mark === "read" ? "прочитано магазином" : "отправлено"}</span>
    </span>
  );
}

function FileChip({ attachment, onDownload }: { attachment: ChatAttachment; onDownload: () => void }) {
  return (
    <button className={styles.fileChip} onClick={onDownload} type="button">
      <strong>{attachment.originalName}</strong>
      <span>{Math.max(1, Math.ceil(attachment.byteSize / 1024))} КБ · скачать</span>
    </button>
  );
}

export interface ChatMessageLogProps {
  /** Shown when the conversation has no messages yet. */
  empty?: ReactNode;
  /** Static notes after the last bubble (e.g. «Обращение завершено»). */
  footer?: ReactNode;
  hasOlderMessages: boolean;
  lastStaffReadMessageId: string | null;
  logId: string;
  messageEndRef: RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  newerMessageCount: number;
  olderHistoryError: string;
  olderHistoryLoading: boolean;
  onDownload: (attachment: ChatAttachment) => void;
  onShowLatest: () => void;
  onShowOlder: () => void;
  renderedMessages: ChatMessage[];
  thread: ChatThread;
  viewerKind: "customer" | "guest" | null;
  viewingLatest: boolean;
}

/** The scrollable `role="log"`. `messageEndRef` stays its direct child so the
 * surfaces can keep the scroll anchor when older history is prepended. */
export function ChatMessageLog(props: ChatMessageLogProps) {
  const {
    empty, footer, hasOlderMessages, lastStaffReadMessageId, logId, messageEndRef, messages, newerMessageCount,
    olderHistoryError, olderHistoryLoading, onDownload, onShowLatest, onShowOlder, renderedMessages, thread, viewerKind, viewingLatest,
  } = props;
  // Read state comes from the full window; drawing uses the rendered window.
  const items = useMemo(() => {
    const read = buildTimeline(messages, { lastStaffReadMessageId });
    const delivery = new Map(read.flatMap((item) => item.kind === "message" ? [[item.key, item.delivery] as const] : []));
    return buildTimeline(renderedMessages).map((item) => item.kind === "message" ? { ...item, delivery: delivery.get(item.key) ?? item.delivery } : item);
  }, [lastStaffReadMessageId, messages, renderedMessages]);

  // The questionnaire card is only the opening message of the whole thread.
  const firstMessageKey = hasOlderMessages ? null : items.find((item) => item.kind === "message")?.key ?? null;

  // Only messages that arrive after the history was shown slide in; older
  // pages prepended at the top and the first paint stay still.
  const seenRef = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const log = document.getElementById(logId);
    if (!log) return;
    const rows = [...log.querySelectorAll<HTMLElement>(`.${styles.row}`)];
    if (seenRef.current === null) {
      if (rows.length) seenRef.current = new Set(rows.map((row) => row.dataset.chatMessageId ?? ""));
      return;
    }
    const seen = seenRef.current;
    rows.forEach((row, index) => {
      const id = row.dataset.chatMessageId ?? "";
      if (seen.has(id)) return;
      seen.add(id);
      if (index >= rows.length - 3) row.classList.add(styles.fresh!);
    });
  }, [items, logId]);

  return (
    <div
      aria-busy={olderHistoryLoading || undefined}
      aria-label="Переписка"
      aria-live={viewingLatest ? "polite" : "off"}
      aria-relevant="additions text"
      className={styles.log}
      id={logId}
      role="log"
    >
      {hasOlderMessages || !viewingLatest ? (
        <div className={styles.historyControls}>
          {hasOlderMessages ? (
            <button aria-controls={logId} disabled={olderHistoryLoading} onClick={onShowOlder} type="button">
              {olderHistoryLoading ? "Загружаем предыдущие…" : olderHistoryError ? "Повторить загрузку" : "Показать предыдущие"}
            </button>
          ) : <span>Это начало переписки</span>}
          {olderHistoryError ? <span role="alert">{olderHistoryError}</span> : null}
        </div>
      ) : null}
      {messages.length === 0 && empty ? <div className={styles.empty}>{empty}</div> : null}
      {items.map((item) => {
        if (item.kind === "date") return <div className={styles.pill} key={item.key}><span>{item.label}</span></div>;
        if (item.kind === "system") {
          return <div className={styles.pill} data-chat-message-id={item.message.id} key={item.key}><span>{item.message.body ?? "Служебное сообщение"}</span></div>;
        }
        const { message } = item;
        const intake = message.attachments.length === 0 && item.key === firstMessageKey ? parseChatIntakeMessage(message.body) : null;
        if (intake) {
          return (
            <div className={styles.row} data-chat-message-id={message.id} data-first data-last data-own={item.own || undefined} key={item.key}>
              <span className={styles.visuallyHidden}>{item.own ? "Вы" : "Покупатель"}: </span>
              <ChatIntakeCard intake={intake} time={timeLabel(message.createdAt)} />
            </div>
          );
        }
        const hasText = Boolean(message.body) && message.messageType !== "attachment";
        return (
          <div
            className={styles.row}
            data-chat-message-id={message.id}
            data-first={item.firstInGroup || undefined}
            data-last={item.lastInGroup || undefined}
            data-own={item.own || undefined}
            key={item.key}
          >
            {!item.own ? <span className={styles.avatarSlot}>{item.lastInGroup ? <ChatAvatar size="sm" /> : null}</span> : null}
            <article className={styles.bubble} data-media={!hasText || undefined}>
              {!item.own && item.firstInGroup && hasText ? <span aria-hidden="true" className={styles.sender}>Магазин АН-30</span> : null}
              <span className={styles.visuallyHidden}>{item.own ? "Вы" : "Магазин АН-30"}: </span>
              {message.attachments.map((attachment) => (
                isPreviewableMedia(attachment) && viewerKind ? (
                  <div className={styles.media} key={attachment.id}>
                    <ChatAttachmentMedia attachment={attachment} onDownload={() => onDownload(attachment)} thread={thread} viewerKind={viewerKind} />
                  </div>
                ) : <FileChip attachment={attachment} key={attachment.id} onDownload={() => onDownload(attachment)} />
              ))}
              {hasText ? <p className={styles.text}>{message.body}</p> : null}
              <span className={styles.meta}>
                <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
                {item.delivery ? <Ticks mark={item.delivery} /> : null}
              </span>
            </article>
          </div>
        );
      })}
      {footer}
      {!viewingLatest ? (
        <button aria-controls={logId} className={styles.toLatest} onClick={onShowLatest} type="button">
          {newerMessageCount > 0 ? `Новые сообщения · ${newerMessageCount}` : "К последним сообщениям"}
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      ) : null}
      <div ref={messageEndRef} />
    </div>
  );
}

/** A centred muted note inside the log, e.g. «Обращение завершено». */
export function ChatSystemPill({ children }: { children: ReactNode }) {
  return <div className={styles.pill}><span>{children}</span></div>;
}

export interface ChatComposerProps {
  attachDisabled: boolean;
  draft: string;
  fileError: string;
  filePending: boolean;
  idPrefix: string;
  inputDisabled?: boolean;
  isRetry: boolean;
  onDraftChange: (value: string) => void;
  /** Resolves to true when the upload succeeded. */
  onFile: (file: File) => Promise<boolean>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  sendDisabled: boolean;
  sendError: string;
  sendPending: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

const MAX_ROWS = 5;

export function ChatComposer(props: ChatComposerProps) {
  const {
    attachDisabled, draft, fileError, filePending, idPrefix, inputDisabled = false, isRetry, onDraftChange, onFile, onSubmit,
    sendDisabled, sendError, sendPending, textareaRef,
  } = props;
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  // A chosen file waits here, shown, until «Отправить» (board «Маски полей и предпросмотр фото»).
  const [staged, setStaged] = useState<{ file: File; kind: "image" | "video"; url: string | null } | null>(null);
  const [stageError, setStageError] = useState("");

  useEffect(() => () => { if (staged?.url) URL.revokeObjectURL(staged.url); }, [staged]);

  function stage(file: File): void {
    if (fileInputRef.current) fileInputRef.current.value = "";
    const check = checkChatAttachment(file);
    if (!check.ok) { setStaged(null); setStageError(check.message); return; }
    setStageError("");
    setStaged({ file, kind: check.kind, url: check.kind === "image" ? URL.createObjectURL(file) : null });
  }

  async function sendStaged(): Promise<void> {
    if (!staged) return;
    const { file } = staged;
    setStaged(null);
    await upload(file);
  }
  const setTextarea = (node: HTMLTextAreaElement | null) => {
    ownRef.current = node;
    if (textareaRef) textareaRef.current = node;
  };

  // Grow with the text up to five lines, then scroll inside the field.
  useLayoutEffect(() => {
    const field = ownRef.current;
    if (!field) return;
    field.style.height = "auto";
    const style = window.getComputedStyle(field);
    const line = Number.parseFloat(style.lineHeight) || 21;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const max = line * MAX_ROWS + padding;
    field.style.height = `${Math.min(field.scrollHeight, max)}px`;
    field.style.overflowY = field.scrollHeight > max ? "auto" : "hidden";
  }, [draft]);

  async function upload(file: File): Promise<void> {
    setFileName(file.name);
    const ok = await onFile(file);
    setFailedFile(ok ? null : file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      {filePending ? (
        <div className={styles.upload} role="status">
          <span className={styles.uploadName}>Отправляем {fileName || "файл"}…</span>
          <span aria-hidden="true" className={styles.uploadBar}><span /></span>
        </div>
      ) : null}
      {staged && !filePending ? (
        <div className={styles.stage}>
          {staged.url
            // A picture of the customer's own file, made in the browser: nothing is uploaded until «Отправить».
            ? <img alt="Выбранное фото" className={styles.stageThumb} height={64} src={staged.url} width={64} />
            : <span aria-hidden="true" className={styles.stageThumb} data-video="">▶</span>}
          <div className={styles.stageInfo}>
            <strong>{staged.file.name}</strong>
            <span>{staged.kind === "image" ? "Фото" : "Видео"} · {formatSize(staged.file.size)}</span>
          </div>
          <div className={styles.stageActions}>
            <button className={styles.stageQuiet} onClick={() => setStaged(null)} type="button">Убрать</button>
            <button className={styles.stageSend} disabled={attachDisabled} onClick={() => void sendStaged()} type="button">
              {staged.kind === "image" ? "Отправить фото" : "Отправить видео"}
            </button>
          </div>
        </div>
      ) : null}
      {stageError ? <p className={styles.error} role="alert">{stageError}</p> : null}
      {sendError ? <p className={styles.error} role="alert">{sendError}</p> : null}
      {fileError ? (
        <p className={styles.error} role="alert">
          {fileError}
          {failedFile && !attachDisabled ? <button onClick={() => void upload(failedFile)} type="button">Повторить</button> : null}
        </p>
      ) : null}
      <div className={styles.composerRow}>
        <button
          aria-label="Прикрепить фото или видео"
          className={styles.roundButton}
          disabled={attachDisabled}
          onClick={() => fileInputRef.current?.click()}
          title="Фото до 5 МБ, видео до 15 МБ"
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" /></svg>
        </button>
        <input
          accept={CHAT_ATTACHMENT_ACCEPT}
          className={styles.visuallyHidden}
          id={`${idPrefix}-file`}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) stage(file); }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        <label className={styles.visuallyHidden} htmlFor={`${idPrefix}-message`}>Сообщение магазину</label>
        <textarea
          aria-describedby={`${idPrefix}-hint`}
          className={styles.input}
          disabled={inputDisabled}
          enterKeyHint="send"
          id={`${idPrefix}-message`}
          maxLength={4_000}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Сообщение"
          ref={setTextarea}
          rows={1}
          value={draft}
        />
        <button
          aria-label={isRetry ? "Повторить отправку сообщения" : "Отправить сообщение"}
          className={styles.sendButton}
          data-pending={sendPending || undefined}
          data-retry={isRetry || undefined}
          disabled={sendDisabled}
          type="submit"
        >
          {isRetry ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          )}
        </button>
      </div>
      <p className={styles.visuallyHidden} id={`${idPrefix}-hint`}>Enter — отправить, Shift и Enter — новая строка. Фото до 5 МБ, видео до 15 МБ и до 2 минут.</p>
    </form>
  );
}
