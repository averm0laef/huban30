/**
 * Pure open/closed decision for the home page's live shop-status block
 * (see `shop-status-block.tsx` and `FeaturePanel` in home-sections.tsx) —
 * kept free of Date/DOM concerns so the boundary-minute rules can be
 * unit-tested directly instead of through a mounted component and a fake
 * clock.
 *
 * The shop keeps one fixed daily schedule (`STORE_HOURS` in
 * site-config.ts: "Ежедневно 09:00–19:00", no closed days), so the only
 * input this needs is "how many minutes past midnight is it right now, in
 * the shop's own timezone" — see `chitaMinutesSinceMidnight` for how that
 * number is derived from a real `Date` identically on the server and the
 * client (both go through `Intl.DateTimeFormat` with an explicit
 * `timeZone`, never the host's local timezone).
 */

export const STORE_TIME_ZONE = "Asia/Chita";
export const STORE_OPEN_HOUR = 9;
export const STORE_CLOSE_HOUR = 19;

const OPEN_MINUTES = STORE_OPEN_HOUR * 60;
const CLOSE_MINUTES = STORE_CLOSE_HOUR * 60;

export interface ShopStatus {
  open: boolean;
  /** "Сейчас открыто" / "Закрыто" */
  label: string;
  /** "закроется через 2 ч 15 мин" / "откроется сегодня в 09:00" / "откроется завтра в 09:00" */
  detail: string;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatHourLabel(hour: number): string {
  return `${pad2(hour)}:00`;
}

/** Abbreviated units ("ч", "мин") on purpose — unlike the full words
 * "час"/"минута" they do not decline with the number, so this never needs
 * Russian plural-form logic to stay grammatically correct. */
function formatRemaining(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins} мин`;
  if (mins === 0) return `${hours} ч`;
  return `${hours} ч ${mins} мин`;
}

/**
 * `minutesSinceMidnight` must be within [0, 1440) — minutes past midnight
 * in the shop's own timezone (see `chitaMinutesSinceMidnight`). Both
 * boundaries are handled explicitly: the open end is inclusive (09:00
 * sharp is already open) and the close end is exclusive (19:00 sharp is
 * already closed, never "open for one more minute").
 */
export function computeShopStatus(minutesSinceMidnight: number): ShopStatus {
  if (minutesSinceMidnight >= OPEN_MINUTES && minutesSinceMidnight < CLOSE_MINUTES) {
    return {
      detail: `закроется через ${formatRemaining(CLOSE_MINUTES - minutesSinceMidnight)}`,
      label: "Сейчас открыто",
      open: true,
    };
  }
  const opensToday = minutesSinceMidnight < OPEN_MINUTES;
  return {
    detail: `откроется ${opensToday ? "сегодня" : "завтра"} в ${formatHourLabel(STORE_OPEN_HOUR)}`,
    label: "Закрыто",
    open: false,
  };
}

/** Minutes past midnight in `STORE_TIME_ZONE`, independent of the host
 * system's own local timezone — safe to call identically on the server
 * (Node) and in the browser. */
export function chitaMinutesSinceMidnight(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: STORE_TIME_ZONE,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function computeShopStatusNow(date: Date = new Date()): ShopStatus {
  return computeShopStatus(chitaMinutesSinceMidnight(date));
}
