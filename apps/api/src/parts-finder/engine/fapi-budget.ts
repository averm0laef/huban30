/**
 * Shared cache and limits for metered FAPI requests. Port of fapi_budget.py:
 * the SQLite ledger is now a {@link FapiLedgerStore} (PostgreSQL in
 * production, memory in tests). Every new call reserves its maximum cost
 * against the package remainder and the Moscow-day limit before FAPI is
 * contacted; refusals FAPI did not bill are refunded, an empty catalogue
 * step costs 1 credit, repeated requests are answered from the cache.
 */

import { createHash } from "node:crypto";

import { PartsFinderError } from "./errors.js";
import { fapiRequest, readUsage, type FapiGateway, type FapiParams, type FapiUsage } from "./fapi.js";
import type { RequestJson } from "./http.js";

export const DAY_LIMIT_DEFAULT = 1000;
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const PAID_CACHE_SPACE = "fapi-answers-v1";
const PAID_CACHE_SECONDS = 30 * 86_400;
const EMPTY_CACHE_SECONDS = 86_400;
const TRIAL_CACHE_SECONDS = 300;

const CATALOG_INDEXES: Readonly<Record<string, string | null>> = {
  "/catalogList/dt/manufacturerList": "mf",
  "/catalogList/dt/modelList": "m",
  "/catalogList/dt/modificationList": "m",
  "/catalogList/dt/treeList": null,
};

/** One serialised unit of work on the ledger (a transaction with a lock in PostgreSQL). */
export interface FapiLedgerTx {
  getCache(period: string, cacheKey: string, now: number): Promise<unknown>;
  getDaily(scope: string, day: string): Promise<number>;
  getPackage(period: string): Promise<number | null>;
  putCache(period: string, cacheKey: string, expires: number, payload: unknown): Promise<void>;
  setDaily(scope: string, day: string, reserved: number): Promise<void>;
  setPackage(period: string, remaining: number): Promise<void>;
}

export interface FapiLedgerStore {
  deleteAccount(scope: string): Promise<void>;
  getAccount(scope: string): Promise<{ checked: number; usage: FapiUsage } | null>;
  purgeExpiredCache(now: number): Promise<void>;
  saveAccount(scope: string, checked: number, usage: FapiUsage): Promise<void>;
  transaction<T>(work: (tx: FapiLedgerTx) => Promise<T>): Promise<T>;
}

/**
 * The visitors' shares of the day's credits (Redis in production, memory in tests). A share is counted apart from
 * the ledger: it is short-lived, and the ledger's daily rows are summed as the site's spending.
 */
export interface FapiVisitorShares {
  /** Gives back credits a call turned out not to cost. */
  giveBack(visitor: string, day: string, credits: number): Promise<void>;
  /** Takes `credits` of the visitor's share of `day`; false when that would go beyond `limit`. */
  take(visitor: string, day: string, credits: number, limit: number): Promise<boolean>;
}

export interface FapiBudgetOptions {
  dailyLimit: () => number;
  key: () => string | undefined;
  now?: () => number;
  requestJson: RequestJson;
  /** One visitor's share of the day's credits; without it nobody is limited individually. */
  visitors?: { limit: () => number; shares: FapiVisitorShares };
}

export function moscowDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000 + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}: ${sortedJson((value as Record<string, unknown>)[key])}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

export class FapiBudget implements FapiGateway {
  private readonly inFlight = new Map<string, { visitor: string | null; work: Promise<unknown> }>();

  constructor(
    private readonly store: FapiLedgerStore,
    private readonly options: FapiBudgetOptions,
  ) {}

  private now(): number {
    return (this.options.now ?? (() => Date.now() / 1000))();
  }

  /**
   * The same gateway for one visitor: what it pays for counts against that visitor's share of the day, so that
   * one address cannot spend the day's credits of the whole site. Answers from the cache stay free.
   */
  forVisitor(visitor: string): FapiGateway {
    return { fetch: (endpoint, params, credits) => this.fetchFor(visitor, endpoint, params, credits) };
  }

  /** The shop's own work (staff, background runs): held to the package and to the day, not to a visitor's share. */
  fetch(endpoint: string, params: FapiParams, credits: number): Promise<unknown> {
    return this.fetchFor(null, endpoint, params, credits);
  }

  private async fetchFor(visitor: string | null, endpoint: string, params: FapiParams, credits: number): Promise<unknown> {
    const key = this.options.key();
    if (!key) throw new PartsFinderError(503, "fapi_key_missing", "Ключ FAPI не настроен.");
    const scope = createHash("sha256").update(key).digest("hex");
    const normalized: FapiParams = { ...params };
    if (endpoint === "/part") normalized.n = String(normalized.n).toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
    const cacheKey = sortedJson([endpoint, normalized]);
    // Identical concurrent requests share one paid call.
    const flightKey = `${scope}\u0000${cacheKey}`;
    const pending = this.inFlight.get(flightKey);
    if (pending) {
      try {
        return await pending.work;
      } catch (error) {
        // Whoever asked first was out of their own share: that says nothing about this caller, who asks again.
        if (pending.visitor !== visitor && error instanceof PartsFinderError && error.code === "fapi_visitor_limit") {
          return this.fetchFor(visitor, endpoint, params, credits);
        }
        throw error;
      }
    }
    const work = this.lookup(key, scope, endpoint, params, cacheKey, credits, visitor);
    this.inFlight.set(flightKey, { visitor, work });
    try {
      return await work;
    } finally {
      if (this.inFlight.get(flightKey)?.work === work) this.inFlight.delete(flightKey);
    }
  }

  private async lookup(key: string, scope: string, endpoint: string, params: FapiParams, cacheKey: string, requested: number, visitor: string | null): Promise<unknown> {
    let usage: FapiUsage;
    try {
      const state = await this.store.getAccount(scope);
      usage = state?.usage ?? { status: "" };
      const end = timestamp(usage.period_end) ?? Number.POSITIVE_INFINITY;
      if (!state || this.now() - state.checked >= 60 || end <= this.now()) {
        usage = await readUsage(key, this.options.requestJson);
        await this.store.saveAccount(scope, this.now(), usage);
        await this.store.purgeExpiredCache(this.now());
      }
    } catch (error) {
      if (error instanceof PartsFinderError) throw error;
      throw new PartsFinderError(503, "fapi_budget_unavailable", "Сейчас недоступен учёт кредитов FAPI.");
    }

    const plan = usage.plan;
    const end = timestamp(usage.period_end);
    const trial = plan === "trial";
    const period = JSON.stringify([scope, plan ?? null, usage.period_start ?? null, usage.included_credits ?? null]);
    // Answers describe parts, not the account: one shared cache survives a
    // re-issued key and a new billing period. A trial keeps its own short one.
    const cacheSpace = trial ? period : PAID_CACHE_SPACE;

    // The visitor's share is taken inside the reservation, once the answer is known not to be cached and the
    // package and the day allow the call; `share.day` tells the paths below that there is something to give back.
    const visitors = visitor === null ? undefined : this.options.visitors;
    const share: { day: string | null } = { day: null };
    const takeShare = visitors && visitor !== null ? async (day: string): Promise<void> => {
      let granted: boolean;
      try {
        granted = await visitors.shares.take(visitor, day, requested, visitors.limit());
      } catch {
        throw new PartsFinderError(503, "fapi_budget_unavailable", "Сейчас недоступен учёт кредитов FAPI.");
      }
      if (!granted) {
        throw new PartsFinderError(429, "fapi_visitor_limit", "Суточная доля запросов к каталогу для одного посетителя исчерпана.");
      }
      share.day = day;
    } : undefined;
    const giveShareBack = async (credits: number): Promise<void> => {
      if (!visitors || visitor === null || share.day === null || credits <= 0) return;
      await visitors.shares.giveBack(visitor, share.day, credits).catch(() => undefined);
    };

    type Reservation = { cached: true; payload: unknown } | { cached: false; day: string; remaining: number; now: number };
    let reservation: Reservation;
    try {
      reservation = await this.ledger((tx) => this.reserve(tx, scope, cacheKey, period, cacheSpace, usage, end, trial, requested, takeShare));
    } catch (error) {
      // The share was taken and the credits were not reserved after all.
      await giveShareBack(requested);
      throw error;
    }
    if (reservation.cached) return reservation.payload;
    const { day, remaining, now } = reservation as Extract<Reservation, { cached: false }>;

    let result: unknown;
    try {
      result = await fapiRequest(endpoint, key, this.options.requestJson, params);
    } catch (error) {
      if (error instanceof PartsFinderError && [400, 401, 402, 403, 429].includes(error.status)) {
        await this.ledger((tx) => this.refund(tx, period, scope, day, remaining - requested, requested));
        await giveShareBack(requested);
      }
      if (error instanceof PartsFinderError && [401, 402, 403].includes(error.status)) {
        await this.store.deleteAccount(scope).catch(() => undefined);
      }
      throw error;
    }

    const indexKey = CATALOG_INDEXES[endpoint];
    const rows = indexKey && result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)[indexKey]
      : result;
    const empty = Array.isArray(rows) && rows.length === 0;
    // An empty catalogue step costs one credit: the rest of what was reserved goes back.
    const unspent = empty && requested > 1 ? requested - 1 : 0;
    const credits = requested - unspent;
    // A found answer is kept for a month; an empty one is re-asked the next day.
    const ttl = trial ? TRIAL_CACHE_SECONDS : empty ? EMPTY_CACHE_SECONDS : PAID_CACHE_SECONDS;
    const expiry = trial && end ? Math.min(now + ttl, end) : now + ttl;
    await this.ledger(async (tx) => {
      if (unspent > 0) await this.refund(tx, period, scope, day, remaining - requested, unspent);
      // During a free trial the licence expires when the credits run out.
      if (!trial || remaining > credits) await tx.putCache(cacheSpace, cacheKey, expiry, result);
    });
    await giveShareBack(unspent);
    return result;
  }

  private async reserve(
    tx: FapiLedgerTx, scope: string, cacheKey: string, period: string, cacheSpace: string, usage: FapiUsage,
    end: number | null, trial: boolean, credits: number, takeShare?: (day: string) => Promise<void>,
  ) {
    const now = this.now();
    const day = moscowDay(now);
    let remaining = typeof usage.remaining_credits === "number" ? usage.remaining_credits : null;
    const allowed = usage.status === "allowed" && (end === null || end > now);
    const active = allowed || (!trial && end !== null && end > now && ["denied_quota", "denied_balance"].includes(usage.status));
    const balance = await tx.getPackage(period);
    if (remaining !== null && balance !== null) remaining = Math.min(remaining, balance);
    if (active && (!trial || (remaining !== null && remaining > 0))) {
      const stored = await tx.getCache(cacheSpace, cacheKey, now);
      if (stored !== undefined) return { cached: true as const, payload: stored };
    }
    if (!allowed) throw new PartsFinderError(402, "fapi_access_limited", "Новые запросы ограничены текущим тарифом FAPI.");
    if (remaining === null || remaining < credits) {
      throw new PartsFinderError(402, "fapi_package_limited", "Остатка кредитов пакета FAPI для запроса недостаточно.");
    }
    const spent = await tx.getDaily(scope, day);
    if (spent + credits > this.options.dailyLimit()) {
      throw new PartsFinderError(429, "fapi_daily_limit", "Дневной лимит новых запросов FAPI исчерпан. Повторите завтра.");
    }
    // Last of the checks, so that a call the package or the day refuses costs the visitor nothing.
    await takeShare?.(day);
    // Reserve before contacting FAPI, across every API instance sharing the database.
    await tx.setPackage(period, remaining - credits);
    await tx.setDaily(scope, day, spent + credits);
    return { cached: false as const, day, now, remaining };
  }

  /**
   * Gives `credits` of a reservation back to the package and to the day, counting from the figures as they are
   * now: another call may have reserved its own credits since. `reserved` is what this call left in the package,
   * used only when the package figure is gone.
   */
  private async refund(tx: FapiLedgerTx, period: string, scope: string, day: string, reserved: number, credits: number): Promise<void> {
    await tx.setPackage(period, ((await tx.getPackage(period)) ?? reserved) + credits);
    await tx.setDaily(scope, day, (await tx.getDaily(scope, day)) - credits);
  }

  private async ledger<T>(work: (tx: FapiLedgerTx) => Promise<T>): Promise<T> {
    try {
      return await this.store.transaction(work);
    } catch (error) {
      if (error instanceof PartsFinderError) throw error;
      throw new PartsFinderError(503, "fapi_budget_unavailable", "Сейчас недоступен учёт кредитов FAPI.");
    }
  }
}
