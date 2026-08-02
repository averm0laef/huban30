import {
  API_PREFIX,
  StorefrontApiError,
  apiErrorMessage,
} from "../_lib/storefront-api";

export const GUEST_CHAT_STORAGE_KEY = "an30_guest_chats_v1";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const THREAD_STATUSES = new Set(["closed", "open", "waiting_customer", "waiting_staff"]);
const ATTACHMENT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
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

export function reconnectDelay(attempt: number): number {
  return Math.min(8_000, 500 * (2 ** Math.max(0, Math.min(attempt, 8))));
}

export function latestSequence(current: string, incoming: string): string {
  if (!SEQUENCE_PATTERN.test(current)) return SEQUENCE_PATTERN.test(incoming) ? incoming : "0";
  if (!SEQUENCE_PATTERN.test(incoming)) return current;
  return BigInt(incoming) > BigInt(current) ? incoming : current;
}

export function attachmentSignatureError(file: { size: number; type: string }, bytes: Uint8Array): string | null {
  if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) return "Размер изображения должен быть от 1 байта до 5 МБ";
  if (!ATTACHMENT_MIME_TYPES.has(file.type)) return "Разрешены только JPEG, PNG и WebP";
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const webp = bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const detected = jpeg ? "image/jpeg" : png ? "image/png" : webp ? "image/webp" : null;
  return detected === file.type ? null : "Тип файла не совпадает с содержимым изображения";
}

export function safeDownloadName(value: string): string {
  const name = value.replace(/[\\/\u0000-\u001F\u007F]/gu, "_").trim().slice(0, 180);
  return !name || name === "." || name === ".." ? "an30-image" : name;
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

/** Pages through `/messages` until the cursor catches up, reporting progress as it goes. */
export async function loadCompleteHistory(
  thread: ChatThread,
  access: ChatAccess,
  isActive: () => boolean,
  onPage: (messages: ChatMessage[]) => void,
): Promise<{ cursor: string; messages: ChatMessage[] }> {
  let cursor = "0";
  let messages: ChatMessage[] = [];
  for (let page = 0; page < 101; page += 1) {
    const history = await chatRequest<{ items: ChatMessage[]; nextSequence: string }>(
      `${messagePath(thread.id, access)}?after=${encodeURIComponent(cursor)}`,
      access,
    );
    if (!isActive()) return { cursor, messages };
    if (!Array.isArray(history.items)
      || history.items.some((message) => !isChatMessage(message))
      || typeof history.nextSequence !== "string"
      || !SEQUENCE_PATTERN.test(history.nextSequence)) {
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

/** Validates the image signature, then uploads it as a new chat message. */
export async function uploadChatAttachment(
  thread: ChatThread,
  access: ChatAccess,
  file: File,
  clientMessageId: string,
): Promise<ChatMessage> {
  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
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
): Promise<Blob> {
  const headers = new Headers();
  if (access.kind === "guest") headers.set("X-Guest-Chat-Token", access.guestToken);
  const response = await fetch(`${API_PREFIX}${attachmentPath(attachment.id, access)}`, {
    cache: "no-store",
    credentials: "include",
    headers,
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
