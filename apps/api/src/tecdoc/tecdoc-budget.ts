/**
 * How many provider calls the site may make, so that a busy hour or a script
 * cannot spend the paid package: what is left of the package is spread evenly
 * over the days left in the period, and no single hour may take more than a
 * fifth of a day's share. Pure arithmetic; the counters live in
 * TecdocBudgetService.
 */

export interface BudgetSettings {
  /** 0 = automatic. */
  dailyLimit: number;
  /** 0 = automatic. */
  hourlyLimit: number;
  monthlyLimit: number;
  /** YYYY-MM-DD the paid 30-day package started; null = calendar month. */
  periodStart: string | null;
}

export interface BudgetPeriod { end: string; start: string }

const DAY_MS = 86_400_000;
const PACKAGE_DAYS = 30;
/** Part of the package never planned for: a margin for the provider counting differently. */
const SAFETY_SHARE = 0.97;
const HOURLY_SHARE = 0.2;
const MIN_HOURLY = 20;
/** The store's own day: the allowance resets at local midnight, when traffic is lowest. */
export const STORE_TIME_ZONE = "Asia/Chita";

const dayFormat = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: STORE_TIME_ZONE, year: "numeric" });
const hourFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: STORE_TIME_ZONE });

/** YYYY-MM-DD in the store's time zone. */
export function storeDay(now: Date): string {
  return dayFormat.format(now);
}

/** "YYYY-MM-DDTHH" in the store's time zone. */
export function storeHour(now: Date): string {
  return `${storeDay(now)}T${hourFormat.format(now)}`;
}

function utc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The 30-day package window `day` falls into, or its calendar month; `end` is exclusive. */
export function periodOf(day: string, periodStart: string | null): BudgetPeriod {
  if (periodStart && utc(day) >= utc(periodStart)) {
    const index = Math.floor((utc(day) - utc(periodStart)) / (PACKAGE_DAYS * DAY_MS));
    const start = utc(periodStart) + index * PACKAGE_DAYS * DAY_MS;
    return { end: iso(start + PACKAGE_DAYS * DAY_MS), start: iso(start) };
  }
  const [year, month] = day.split("-").map(Number) as [number, number];
  return { end: iso(Date.UTC(year, month, 1)), start: iso(Date.UTC(year, month - 1, 1)) };
}

export interface Allowance { daily: number; hourly: number; period: BudgetPeriod }

/** `usedBeforeToday`: calls made in this period on earlier days. */
export function allowanceFor(day: string, usedBeforeToday: number, settings: BudgetSettings): Allowance {
  const period = periodOf(day, settings.periodStart);
  const left = Math.max(0, Math.floor(settings.monthlyLimit * SAFETY_SHARE) - usedBeforeToday);
  const daysLeft = Math.max(1, Math.round((utc(period.end) - utc(day)) / DAY_MS));
  const even = Math.floor(left / daysLeft);
  const daily = Math.min(left, settings.dailyLimit > 0 ? settings.dailyLimit : even);
  const hourly = Math.min(daily, settings.hourlyLimit > 0 ? settings.hourlyLimit : Math.max(MIN_HOURLY, Math.ceil(daily * HOURLY_SHARE)));
  return { daily, hourly, period };
}
