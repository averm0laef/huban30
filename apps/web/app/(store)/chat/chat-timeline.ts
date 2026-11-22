import { isOwnMessage, type ChatMessage } from "./chat-state";

/**
 * Pure layout of a conversation the way messengers draw it: date pills,
 * system notes as centred pills, and consecutive bubbles from one side
 * grouped (tight spacing, one avatar on the last bubble of the group).
 * Kept free of React so the grouping rules are unit-tested directly.
 */
export type DeliveryMark = "read" | "sent";

export type TimelineItem =
  | { key: string; kind: "date"; label: string }
  | { key: string; kind: "system"; message: ChatMessage }
  | {
    delivery: DeliveryMark | null;
    firstInGroup: boolean;
    key: string;
    kind: "message";
    lastInGroup: boolean;
    message: ChatMessage;
    own: boolean;
  };

/** Bubbles further apart than this start a new group, as in Telegram. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

const DAY_FORMAT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** «Сегодня», «Вчера», «12 ноября» or «12 ноября 2025» (another year). */
export function dayLabel(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (dayKey(date) === dayKey(now)) return "Сегодня";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Вчера";
  return (date.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_YEAR_FORMAT).format(date);
}

/** «10:13» — the time shown inside a bubble. */
export function timeLabel(value: string): string {
  return TIME_FORMAT.format(new Date(value));
}

/** Short time for a conversation list: time today, «вчера», else a date. */
export function listTimeLabel(value: string | null, now: Date = new Date()): string {
  if (!value) return "";
  const label = dayLabel(value, now);
  if (label === "Сегодня") return timeLabel(value);
  if (label === "Вчера") return "вчера";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(value));
}

function isSystem(message: ChatMessage): boolean {
  return message.senderKind === "system" || message.messageType === "system";
}

/**
 * The shop reports the newest of the customer's messages it has read.
 * Every own message up to that one (by sequence) is read; later ones are
 * only sent.
 */
export function readSequence(messages: readonly ChatMessage[], lastStaffReadMessageId: string | null): bigint | null {
  if (!lastStaffReadMessageId) return null;
  const read = messages.find((message) => message.id === lastStaffReadMessageId);
  try { return read ? BigInt(read.sequence) : null; } catch { return null; }
}

export function buildTimeline(
  messages: readonly ChatMessage[],
  options: { lastStaffReadMessageId?: string | null; now?: Date } = {},
): TimelineItem[] {
  const now = options.now ?? new Date();
  const readUpTo = readSequence(messages, options.lastStaffReadMessageId ?? null);
  const items: TimelineItem[] = [];
  let previousDay = "";
  let previous: { own: boolean; time: number } | null = null;
  messages.forEach((message) => {
    const created = new Date(message.createdAt);
    const day = dayKey(created);
    if (day !== previousDay) {
      items.push({ key: `date-${day}`, kind: "date", label: dayLabel(message.createdAt, now) });
      previousDay = day;
      previous = null;
    }
    if (isSystem(message)) {
      items.push({ key: message.id, kind: "system", message });
      previous = null;
      return;
    }
    const own = isOwnMessage(message);
    const time = created.getTime();
    const continues = previous !== null && previous.own === own && time - previous.time <= GROUP_GAP_MS;
    if (continues) {
      const last = items[items.length - 1];
      if (last?.kind === "message") last.lastInGroup = false;
    }
    let delivery: DeliveryMark | null = null;
    if (own) {
      let sequence: bigint | null;
      try { sequence = BigInt(message.sequence); } catch { sequence = null; }
      delivery = readUpTo !== null && sequence !== null && sequence <= readUpTo ? "read" : "sent";
    }
    items.push({ delivery, firstInGroup: !continues, key: message.id, kind: "message", lastInGroup: true, message, own });
    previous = { own, time };
  });
  return items;
}

/** One line for a conversation list: text, or the attachment kind. */
export function messagePreview(message: ChatMessage | undefined): string {
  if (!message) return "";
  const prefix = isOwnMessage(message) ? "Вы: " : "";
  if (message.body && message.messageType !== "attachment") return `${prefix}${message.body.replace(/\s+/gu, " ").trim()}`;
  const attachment = message.attachments[0];
  if (attachment) return `${prefix}${attachment.mimeType.startsWith("video/") ? "Видео" : "Фото"}`;
  return prefix ? `${prefix}сообщение` : "Сообщение";
}
