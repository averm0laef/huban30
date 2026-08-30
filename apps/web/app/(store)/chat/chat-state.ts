import {
  CHAT_INTAKE_INTENT_LABELS,
  type ChatIntake,
  type ChatThreadCreate,
} from "@an30/contracts";

import { computeShopStatusNow } from "../_components/shop-status";
import {
  API_PREFIX,
  StorefrontApiError,
  apiErrorMessage,
} from "../_lib/storefront-api";

export const GUEST_CHAT_STORAGE_KEY = "an30_guest_chats_v1";
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const CHAT_ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
export const CHAT_HISTORY_PAGE_SIZE = 50;
/** The DOM never contains more chat messages than this, even after paging. */
export const CHAT_RENDERED_MESSAGE_LIMIT = 150;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const THREAD_STATUSES = new Set(["closed", "open", "waiting_customer", "waiting_staff"]);
const IMAGE_ATTACHMENT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_ATTACHMENT_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const ATTACHMENT_MIME_TYPES = new Set([...IMAGE_ATTACHMENT_MIME_TYPES, ...VIDEO_ATTACHMENT_MIME_TYPES]);
const MESSAGE_TYPES = new Set(["attachment", "system", "text"]);
const SENDER_KINDS = new Set(["customer", "guest", "staff", "system"]);
const SEQUENCE_PATTERN = /^(0|[1-9]\d{0,18})$/u;

export interface ChatAttachment {
  byteSize: number;
  id: string;
  mimeType: string;
  originalName: string;
}

export interface ChatMessage {
  attachments: ChatAttachment[];
  body: string | null;
  clientMessageId: string | null;
  createdAt: string;
  id: string;
  messageType: "attachment" | "system" | "text";
  replyToId: string | null;
  senderKind: "customer" | "guest" | "staff" | "system";
  senderUserId: string | null;
  sequence: string;
}

export interface ChatThread {
  assignedStaffId: string | null;
  createdAt: string;
  guestToken?: string;
  id: string;
  lastMessageAt: string | null;
  orderId: string | null;
  status: "closed" | "open" | "waiting_customer" | "waiting_staff";
  subject: string | null;
}

export interface ChatHistoryWindow {
  items: ChatMessage[];
  nextSequence: string;
  olderCursor: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseGuestThread(value: unknown): ChatThread | null {
  if (!isRecord(value)) return null;
  const normalized = { ...value, assignedStaffId: null };
  if (!isChatThread(normalized)
    || typeof normalized.guestToken !== "string"
    || normalized.guestToken.length < 32
    || normalized.guestToken.length > 256) {
    return null;
  }
  return {
    assignedStaffId: null,
    createdAt: normalized.createdAt,
    guestToken: normalized.guestToken,
    id: normalized.id,
    lastMessageAt: normalized.lastMessageAt,
    orderId: normalized.orderId,
    status: normalized.status,
    subject: normalized.subject,
  };
}

export function isChatThread(value: unknown): value is ChatThread {
  return isRecord(value)
    && typeof value.id === "string"
    && UUID_PATTERN.test(value.id)
    && (value.assignedStaffId === null
      || (typeof value.assignedStaffId === "string" && UUID_PATTERN.test(value.assignedStaffId)))
    && isDate(value.createdAt)
    && (value.lastMessageAt === null || isDate(value.lastMessageAt))
    && typeof value.status === "string"
    && THREAD_STATUSES.has(value.status)
    && (value.subject === null || (typeof value.subject === "string" && value.subject.length <= 240))
    && (value.orderId === null || (typeof value.orderId === "string" && UUID_PATTERN.test(value.orderId)))
    && (value.guestToken === undefined || typeof value.guestToken === "string");
}

export function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)
    || typeof value.id !== "string" || !UUID_PATTERN.test(value.id)
    || typeof value.sequence !== "string" || !SEQUENCE_PATTERN.test(value.sequence)
    || typeof value.createdAt !== "string" || !isDate(value.createdAt)
    || typeof value.messageType !== "string" || !MESSAGE_TYPES.has(value.messageType)
    || typeof value.senderKind !== "string" || !SENDER_KINDS.has(value.senderKind)
    || (value.body !== null && (typeof value.body !== "string" || value.body.length > 4_000))
    || (value.clientMessageId !== null
      && (typeof value.clientMessageId !== "string" || !UUID_PATTERN.test(value.clientMessageId)))
    || (value.replyToId !== null && (typeof value.replyToId !== "string" || !UUID_PATTERN.test(value.replyToId)))
    || (value.senderUserId !== null
      && (typeof value.senderUserId !== "string" || !UUID_PATTERN.test(value.senderUserId)))
    || !Array.isArray(value.attachments)) return false;
  return value.attachments.every((attachment) => isRecord(attachment)
    && typeof attachment.id === "string" && UUID_PATTERN.test(attachment.id)
    && typeof attachment.byteSize === "number" && Number.isSafeInteger(attachment.byteSize)
    && attachment.byteSize > 0 && attachment.byteSize <= MAX_ATTACHMENT_BYTES
    && typeof attachment.mimeType === "string" && ATTACHMENT_MIME_TYPES.has(attachment.mimeType)
    && typeof attachment.originalName === "string" && attachment.originalName.length > 0
    && attachment.originalName.length <= 240);
}

/**
 * The server's honest snapshot of "who — if anyone — is on this thread",
 * carried on the WebSocket channel's `subscribed` payload (`thread`) and on
 * live `thread` broadcasts (see use-chat-thread.ts). Never derived from
 * messages or guessed client-side — only what the API actually reports.
 */
export interface ChatThreadAssignment {
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  status: ChatThread["status"];
}

export function isChatThreadAssignment(value: unknown): value is ChatThreadAssignment {
  return isRecord(value)
    && (value.assignedStaffId === null
      || (typeof value.assignedStaffId === "string" && UUID_PATTERN.test(value.assignedStaffId)))
    && (value.assignedStaffName === null
      || (typeof value.assignedStaffName === "string"
        && value.assignedStaffName.length > 0 && value.assignedStaffName.length <= 240))
    && typeof value.status === "string" && THREAD_STATUSES.has(value.status);
}

export function parseStoredGuestThreads(raw: string | null): ChatThread[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const unique = new Map<string, ChatThread>();
    for (const entry of value) {
      const parsed = parseGuestThread(entry);
      if (parsed && !unique.has(parsed.id)) unique.set(parsed.id, parsed);
    }
    return [...unique.values()]
      .sort((left, right) => threadTimestamp(right) - threadTimestamp(left))
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function serializeGuestThreads(threads: ChatThread[]): string {
  return JSON.stringify(threads
    .filter((thread) => thread.guestToken)
    .sort((left, right) => threadTimestamp(right) - threadTimestamp(left))
    .slice(0, 20)
    .map((thread) => ({
      createdAt: thread.createdAt,
      guestToken: thread.guestToken,
      id: thread.id,
      lastMessageAt: thread.lastMessageAt,
      orderId: thread.orderId,
      status: thread.status,
      subject: thread.subject,
    })));
}

export function upsertThread(threads: ChatThread[], incoming: ChatThread): ChatThread[] {
  return [incoming, ...threads.filter((thread) => thread.id !== incoming.id)]
    .sort((left, right) => threadTimestamp(right) - threadTimestamp(left));
}

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const unique = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) unique.set(message.id, message);
  return [...unique.values()].sort((left, right) => {
    const leftSequence = BigInt(left.sequence);
    const rightSequence = BigInt(right.sequence);
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
  });
}

/** Selects a bounded DOM window while the hook retains cursors/realtime metadata. */
export function renderedMessageWindow(
  messages: ChatMessage[],
  view: "latest" | "older",
): ChatMessage[] {
  return view === "latest"
    ? messages.slice(-CHAT_RENDERED_MESSAGE_LIMIT)
    : messages.slice(0, CHAT_RENDERED_MESSAGE_LIMIT);
}

export function reconnectDelay(attempt: number): number {
  return Math.min(8_000, 500 * (2 ** Math.max(0, Math.min(attempt, 8))));
}

export function latestSequence(current: string, incoming: string): string {
  if (!SEQUENCE_PATTERN.test(current)) return SEQUENCE_PATTERN.test(incoming) ? incoming : "0";
  if (!SEQUENCE_PATTERN.test(incoming)) return current;
  return BigInt(incoming) > BigInt(current) ? incoming : current;
}

export function attachmentSignatureError(file: { size: number; type: string }, bytes: Uint8Array): string | null {
  if (!ATTACHMENT_MIME_TYPES.has(file.type)) return "Разрешены JPEG, PNG, WebP, MP4, MOV и WebM";
  const maxBytes = IMAGE_ATTACHMENT_MIME_TYPES.has(file.type) ? 5 * 1024 * 1024 : MAX_ATTACHMENT_BYTES;
  if (file.size < 1 || file.size > maxBytes) {
    return `Размер ${IMAGE_ATTACHMENT_MIME_TYPES.has(file.type) ? "изображения" : "видео"} должен быть от 1 байта до ${maxBytes / 1024 / 1024} МБ`;
  }
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const webp = bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const isoMedia = bytes.length >= 12
    && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  const quicktime = isoMedia
    && bytes[8] === 0x71 && bytes[9] === 0x74 && bytes[10] === 0x20 && bytes[11] === 0x20;
  const webm = bytes.length >= 4
    && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const detected = jpeg ? "image/jpeg"
    : png ? "image/png"
      : webp ? "image/webp"
        : quicktime ? "video/quicktime"
          : isoMedia ? "video/mp4"
            : webm ? "video/webm" : null;
  return detected === file.type ? null : "Тип файла не совпадает с его содержимым";
}

/** True for the same JPEG/PNG/WebP set the server accepts. */
export function isPreviewableImage(attachment: ChatAttachment): boolean {
  return IMAGE_ATTACHMENT_MIME_TYPES.has(attachment.mimeType);
}

/** True for browser-playable video containers accepted by the server. */
export function isPreviewableVideo(attachment: ChatAttachment): boolean {
  return VIDEO_ATTACHMENT_MIME_TYPES.has(attachment.mimeType);
}

export function isPreviewableMedia(attachment: ChatAttachment): boolean {
  return isPreviewableImage(attachment) || isPreviewableVideo(attachment);
}

export function safeDownloadName(value: string): string {
  const name = value.replace(/[\\/\u0000-\u001F\u007F]/gu, "_").trim().slice(0, 180);
  return !name || name === "." || name === ".." ? "an30-file" : name;
}

function threadTimestamp(thread: ChatThread): number {
  return Date.parse(thread.lastMessageAt ?? thread.createdAt);
}

/* ============================================================
   Shared chat client SDK
   ------------------------------------------------------------
   Pure state helpers live above this line. Everything below is
   the network/session layer the storefront's two chat surfaces
   (the full /chat page and the floating widget) both build on,
   so the WebSocket protocol, REST calls and validation only
   exist in one place.
   ============================================================ */

export type ChatAccess = { kind: "customer" } | { guestToken: string; kind: "guest" };
export type ConnectionState = "connecting" | "error" | "idle" | "live" | "offline" | "reconnecting";

export const STATUS_LABELS: Record<ChatThread["status"], string> = {
  closed: "Закрыт",
  open: "Открыт",
  waiting_customer: "Ждём ваш ответ",
  waiting_staff: "Ждёт сотрудника",
};

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: "Подключение",
  error: "Ошибка связи",
  idle: "Не подключён",
  live: "Онлайн",
  offline: "Нет сети",
  reconnecting: "Восстановление связи",
};

/** Resolves which credentials (if any) a viewer holds for a given thread. */
export function accessFor(viewer: { kind: string }, thread: ChatThread): ChatAccess | null {
  if (viewer.kind === "customer") return { kind: "customer" };
  if (viewer.kind === "guest" && thread.guestToken) return { guestToken: thread.guestToken, kind: "guest" };
  return null;
}

export function isOwnMessage(message: ChatMessage): boolean {
  return message.senderKind === "customer" || message.senderKind === "guest";
}

export function senderLabel(kind: ChatMessage["senderKind"]): string {
  return kind === "staff" ? "АН-30" : kind === "system" ? "Система" : "Вы";
}

export function formatDate(value: string | null): string {
  if (!value) return "Нет сообщений";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

/**
 * Derives the new thread's `subject` from the intake answers (see the
 * `ChatThreadCreateSchema` comment in `@an30/contracts`) — the customer is
 * never asked to type a title for their own conversation. Prefers the most
 * specific detail available (an article number pinpoints a part; a vehicle
 * at least narrows it down) and always falls back to the plain intent
 * label, so this never produces an empty or sub-2-character subject.
 */
export function intakeSubject(intake: ChatIntake): string {
  const label = CHAT_INTAKE_INTENT_LABELS[intake.intent];
  const detail = intake.articleNumber ?? intake.vehicle;
  return detail ? `${label}: ${detail}` : label;
}

/**
 * The single place that turns a completed intake form into the exact body
 * `ChatThreadCreateSchema` expects — used by both the widget and the full
 * `/chat` page, for both the guest and the authenticated create-thread
 * endpoints, so the answers a customer typed are always what actually
 * reaches the new thread (never re-derived or re-typed per call site).
 */
export function chatThreadCreateBody(intake: ChatIntake, orderId: string | null = null): ChatThreadCreate {
  return { intake, orderId, subject: intakeSubject(intake) };
}

/* ============================================================
   "Manager is joining" countdown
   ------------------------------------------------------------
   Pure, framework-free derivation shared by the widget and the
   full /chat page so both surfaces render identical copy and
   never drift. The one rule that matters: this never fabricates
   a connection. "assigned" only ever comes from the server's
   ChatThreadAssignment (real assigned_staff_id); every other
   state is derived solely from message timestamps already in
   the thread, so re-mounting the widget can't reset it.
   ============================================================ */

/** The owner's advertised expected response time — a target, not a promise. */
export const MANAGER_RESPONSE_WINDOW_MS = 10 * 60 * 1000;

export type ManagerJoinState =
  /** No customer message is currently unanswered — nothing to wait for. */
  | { kind: "none" }
  /** The server reports a real assignee on the thread. */
  | { kind: "assigned"; staffName: string | null }
  /** The thread is closed; the countdown has nothing left to track. */
  | { kind: "closed" }
  /** Still inside the expected response window. */
  | { kind: "waiting"; remainingMs: number; sinceIso: string }
  /** The expected window passed and nobody is assigned yet. */
  | { kind: "elapsed"; sinceIso: string }
  /**
   * The shop is closed right now (see `computeShopStatusNow`), so the
   * ten-minute promise would be a lie — nobody is on shift to keep it.
   * `openDetail` is shop-status.ts's own "откроется сегодня в 09:00" /
   * "откроется завтра в 09:00" phrase, reused verbatim so the storefront
   * never describes the shop's hours two different ways.
   */
  | { kind: "outOfHours"; openDetail: string; sinceIso: string };

/**
 * Timestamp (ISO string) of the customer's oldest message since staff last
 * replied, or null if every message has already been answered (or none
 * were ever sent). Messages must be in ascending sequence order, which is
 * how `mergeMessages` always returns them.
 *
 * This is the countdown's start point. It is derived purely from message
 * history — never from when the widget happened to mount — so closing and
 * reopening it, or a page reload, can never restart the clock.
 */
export function unansweredSince(messages: ChatMessage[]): string | null {
  let pendingSince: string | null = null;
  for (const message of messages) {
    if (message.senderKind === "staff") {
      pendingSince = null;
    } else if (isOwnMessage(message) && pendingSince === null) {
      pendingSince = message.createdAt;
    }
  }
  return pendingSince;
}

/**
 * Derives what the countdown UI should show right now. `now` is injected
 * (not `Date.now()`) so this stays a pure, testable function — it is also
 * the single clock reused for both the countdown math and the shop-hours
 * check below, so the two can never disagree about "now".
 */
export function managerJoinState(input: {
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  messages: ChatMessage[];
  now: number;
  status: ChatThread["status"];
}): ManagerJoinState {
  if (input.status === "closed") return { kind: "closed" };
  if (input.assignedStaffId) return { kind: "assigned", staffName: input.assignedStaffName };
  const since = unansweredSince(input.messages);
  if (!since) return { kind: "none" };
  const shop = computeShopStatusNow(new Date(input.now));
  if (!shop.open) return { kind: "outOfHours", openDetail: shop.detail, sinceIso: since };
  const elapsedMs = input.now - Date.parse(since);
  if (elapsedMs >= MANAGER_RESPONSE_WINDOW_MS) return { kind: "elapsed", sinceIso: since };
  return { kind: "waiting", remainingMs: MANAGER_RESPONSE_WINDOW_MS - elapsedMs, sinceIso: since };
}

/** Formats remaining milliseconds as `m:ss` (e.g. `9:58`, never negative). */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The single source of truth for the countdown's copy — both chat surfaces import these so the wording can never drift between them. */
export const MANAGER_WAITING_TEXT = "Менеджер отвечает обычно за 10 минут";
export const MANAGER_ELAPSED_HEADLINE = "Менеджеры сейчас заняты";
export const MANAGER_ELAPSED_BODY =
  "Обычное время ответа — 10 минут — уже прошло. Ваше сообщение никуда не делось, и мы ответим прямо в этом чате. Если вопрос срочный, позвоните нам или напишите в мессенджер:";
export const MANAGER_ASSIGNED_HEADLINE = "Менеджер подключился к чату";
export const MANAGER_OUT_OF_HOURS_HEADLINE = "Сейчас нерабочее время";

/** `openDetail` comes straight from `ManagerJoinState`'s `outOfHours` case (shop-status.ts's own phrasing). */
export function managerOutOfHoursBody(openDetail: string): string {
  return `Магазин ${openDetail}. Ваше сообщение сохранено — менеджер ответит в течение 10 минут после этого.`;
}

/** Null when the server hasn't reported a name — never guess or invent one. */
export function managerAssignedNote(staffName: string | null): string | null {
  return staffName ? `Вам отвечает ${staffName}.` : null;
}

function cookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
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

/** Thin fetch wrapper shared by every authenticated/guest chat REST call. */
export async function chatRequest<T>(
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

export function isChatHistoryWindow(value: unknown): value is ChatHistoryWindow {
  if (!isRecord(value)
    || !Array.isArray(value.items)
    || value.items.some((message) => !isChatMessage(message))
    || typeof value.nextSequence !== "string"
    || !SEQUENCE_PATTERN.test(value.nextSequence)
    || (value.olderCursor !== null
      && (typeof value.olderCursor !== "string" || !SEQUENCE_PATTERN.test(value.olderCursor)))) {
    return false;
  }
  for (let index = 1; index < value.items.length; index += 1) {
    if (BigInt(value.items[index - 1]!.sequence) >= BigInt(value.items[index]!.sequence)) return false;
  }
  return true;
}

async function loadHistoryWindow(
  thread: ChatThread,
  access: ChatAccess,
  before: "latest" | string,
): Promise<ChatHistoryWindow> {
  const history = await chatRequest<unknown>(
    `${messagePath(thread.id, access)}?before=${encodeURIComponent(before)}&limit=${CHAT_HISTORY_PAGE_SIZE}`,
    access,
  );
  if (!isChatHistoryWindow(history)) throw new Error("Сервер вернул повреждённую страницу истории");
  return history;
}

/** Loads only the newest bounded window. Realtime continues from nextSequence. */
export function loadLatestHistory(thread: ChatThread, access: ChatAccess): Promise<ChatHistoryWindow> {
  return loadHistoryWindow(thread, access, "latest");
}

/** Loads one older page using an exclusive server-issued cursor. */
export function loadOlderHistory(
  thread: ChatThread,
  access: ChatAccess,
  before: string,
): Promise<ChatHistoryWindow> {
  if (!SEQUENCE_PATTERN.test(before)) return Promise.reject(new Error("Некорректный курсор истории"));
  return loadHistoryWindow(thread, access, before);
}

/** One-shot REST send, used as the idempotent fallback whenever the socket isn't live. */
export async function sendChatMessageRest(
  thread: ChatThread,
  access: ChatAccess,
  body: string,
  clientMessageId: string,
): Promise<ChatMessage> {
  const created = await chatRequest<ChatMessage>(messagePath(thread.id, access), access, {
    body: { body, clientMessageId, replyToId: null },
    method: "POST",
  });
  if (!isChatMessage(created)) throw new Error("Сервер вернул повреждённое сообщение");
  return created;
}

export async function markChatMessageRead(thread: ChatThread, access: ChatAccess, messageId: string): Promise<void> {
  await chatRequest(readPath(thread.id, messageId, access), access, { method: "POST" });
}

/** Validates a photo/video signature, then uploads it as a new chat message. */
export async function uploadChatAttachment(
  thread: ChatThread,
  access: ChatAccess,
  file: File,
  clientMessageId: string,
): Promise<ChatMessage> {
  const signature = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validationError = attachmentSignatureError(file, signature);
  if (validationError) throw new Error(validationError);
  const form = new FormData();
  form.set("file", file, file.name);
  const headers = new Headers({ Accept: "application/json", "X-Client-Message-Id": clientMessageId });
  if (access.kind === "guest") headers.set("X-Guest-Chat-Token", access.guestToken);
  const csrf = cookieValue("an30_csrf");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${uploadPath(thread.id, access)}`, {
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
  return payload;
}

/** Downloads an attachment and cross-checks it against its already-verified metadata. */
export async function downloadChatAttachmentBlob(
  attachment: ChatAttachment,
  thread: ChatThread,
  access: ChatAccess,
  signal?: AbortSignal,
): Promise<Blob> {
  const headers = new Headers();
  if (access.kind === "guest") headers.set("X-Guest-Chat-Token", access.guestToken);
  const response = await fetch(`${API_PREFIX}${attachmentPath(attachment.id, access)}`, {
    cache: "no-store",
    credentials: "include",
    headers,
    signal,
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
  return blob;
}
