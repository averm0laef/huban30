/**
 * Pure helpers for the staff dashboard (design board «Админка: сводка»).
 * Kept free of SQL so they are unit-tested on their own.
 */

export type DashboardRange = "today" | "7d" | "30d";
export type ServiceState = "ok" | "warn" | "error" | "off";

/** The shop's own day: Чернышевск, Забайкальский край. */
export const SHOP_TIME_ZONE = "Asia/Chita";

export function parseDashboardRange(value: unknown): DashboardRange {
  return value === "7d" || value === "30d" ? value : "today";
}

const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/giu;
const PHONE_PATTERN = /\+?\d[\d\s()-]{8,}\d/gu;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/gu;

/**
 * What goes into the search log: lower-cased, single-spaced, at most 120
 * characters. A VIN keeps only its manufacturer code (first 3 characters),
 * phones and e-mails are dropped: the log answers «what do people look
 * for», it must not become a list of whose car is whose.
 */
export function searchLogQuery(raw: string): string | null {
  const cleaned = raw
    .replace(EMAIL_PATTERN, " ")
    .replace(VIN_PATTERN, (vin) => `vin:${vin.slice(0, 3).toUpperCase()}…`)
    .replace(PHONE_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  return cleaned.length >= 2 ? cleaned : null;
}

/** Percent change, rounded to a whole percent; null when there is no base. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function zeroShare(searches: number, zero: number): number | null {
  if (searches <= 0) return null;
  return Math.round((zero / searches) * 1000) / 10;
}

export interface ExchangeRunView {
  error: string | null;
  finishedAt: string | null;
  rejected: number;
  status: "running" | "completed" | "failed";
  touched: number;
}

/**
 * One 1С base: off when the endpoint is disabled, error when the last run
 * failed, warn when rows were rejected or nothing arrived for a day while
 * enabled, otherwise ok.
 */
export function oneCState(enabled: boolean, lastRun: ExchangeRunView | null, now: Date): ServiceState {
  if (!enabled) return "off";
  if (!lastRun) return "warn";
  if (lastRun.status === "failed") return "error";
  if (lastRun.rejected > 0) return "warn";
  const finished = lastRun.finishedAt ? Date.parse(lastRun.finishedAt) : Number.NaN;
  if (Number.isFinite(finished) && now.getTime() - finished > 26 * 60 * 60 * 1000) return "warn";
  return "ok";
}

export interface HubCheck { name?: string; ok?: boolean; detail?: string }

export function hubState(publishEnabled: boolean, inboxEnabled: boolean, diagnostic: unknown): ServiceState {
  if (!publishEnabled && !inboxEnabled) return "off";
  const checks = (diagnostic && typeof diagnostic === "object" && Array.isArray((diagnostic as { checks?: unknown }).checks))
    ? (diagnostic as { checks: HubCheck[] }).checks
    : [];
  if (checks.length === 0) return "warn";
  return checks.every((check) => check.ok !== false) ? "ok" : "error";
}

export function quotaState(remaining: number | null, limit: number | null): ServiceState {
  if (remaining === null) return "off";
  if (remaining <= 0) return "error";
  if (limit && remaining / limit < 0.1) return "warn";
  return "ok";
}
