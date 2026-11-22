import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../infrastructure/redis.service.js";
import { requestJson, UpstreamStatusError, type RequestJson } from "../parts-finder/engine/http.js";
import { CryptoService } from "../security/crypto.service.js";
import { storeDay } from "./tecdoc-budget.js";
import { TecdocBudgetService } from "./tecdoc-budget.service.js";
import { TecdocCacheService } from "./tecdoc-cache.service.js";

/** Replaceable outbound HTTP: tests inject a fake, the paid API is never called from tests. */
export const TECDOC_HTTP = Symbol("TECDOC_HTTP");

/**
 * Who is looking at the answer. Every provider call is made for a visitor's
 * own request (offer clause 2.6: request–response for end users): there is no
 * way to call the provider from a background job.
 */
export interface TecdocCaller { ip: string; userId?: string | null }

export type TecdocFailure =
  /** No key, switched off. */
  | "disabled"
  /** Our own limits: the day's or hour's share, the package, one visitor's share. */
  | "limited"
  /** The provider refused the key or its quota. */
  | "refused"
  /** Network, timeout, 5xx, or too many failures in a row. */
  | "unavailable";

export class TecdocError extends Error {
  constructor(readonly failure: TecdocFailure, readonly detail: string) {
    super(`tecdoc ${failure}: ${detail}`);
    this.name = "TecdocError";
  }
}

export interface TecdocRequestOptions<T> {
  /** True when the reduced answer holds nothing: kept for an hour, so a miss is asked again soon. */
  isEmpty?: (value: T) => boolean;
  /** Seconds; never longer than the configured display-cache lifetime. */
  ttlSeconds?: number;
}

const VISITOR_PREFIX = "an30:tecdoc:visitor:";
const TAKE_VISITOR = `
  local used = redis.call('INCR', KEYS[1])
  if used == 1 then redis.call('EXPIRE', KEYS[1], 90000) end
  return used
`;
const EMPTY_TTL_SECONDS = 3_600;
const TIMEOUT_MS = 8_000;
const BREAKER_FAILURES = 5;
const BREAKER_PAUSE_MS = 60_000;
const QUOTA_PAUSE_MS = 10 * 60_000;

@Injectable()
export class TecdocGateway {
  private readonly logger = new Logger(TecdocGateway.name);
  private readonly key: string | undefined;
  private readonly baseUrl: string;
  private readonly switchedOn: boolean;
  private readonly visitorDailyLimit: number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private failures = 0;
  private pausedUntil = 0;
  private lastError: { at: string; detail: string } | null = null;
  private lastSuccessAt: string | null = null;

  constructor(
    config: ConfigService,
    private readonly cache: TecdocCacheService,
    private readonly budget: TecdocBudgetService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    @Optional() @Inject(TECDOC_HTTP) private readonly http: RequestJson = requestJson,
  ) {
    this.key = config.get<string>("TECDOC_API_KEY") || undefined;
    this.baseUrl = (config.get<string>("TECDOC_BASE_URL") ?? "https://tecdoc.site/api/v2").replace(/\/+$/u, "");
    this.switchedOn = config.get<boolean>("TECDOC_ENABLED") !== false;
    this.visitorDailyLimit = config.get<number>("TECDOC_VISITOR_DAILY_LIMIT") ?? 150;
  }

  get enabled(): boolean {
    return this.switchedOn && Boolean(this.key);
  }

  get health() {
    return { configured: Boolean(this.key), enabled: this.enabled, lastError: this.lastError, lastSuccessAt: this.lastSuccessAt, paused: Date.now() < this.pausedUntil };
  }

  /**
   * One provider answer in its reduced form: from the display cache, from a
   * call already on its way for the same request, or from a new call that
   * fits the visitor's and the site's budget.
   */
  async get<T>(
    path: string,
    parameters: Record<string, string | number | boolean>,
    caller: TecdocCaller,
    reduce: (payload: unknown) => T,
    options: TecdocRequestOptions<T> = {},
  ): Promise<T> {
    if (!this.enabled) throw new TecdocError("disabled", "no key");
    const cacheKey = TecdocCacheService.keyOf(path, parameters);
    let cached: T | undefined;
    try {
      cached = await this.cache.get<T>(cacheKey);
    } catch {
      // Without the cache every view would be a paid call: stop instead.
      throw new TecdocError("unavailable", "cache");
    }
    if (cached !== undefined) {
      this.budget.note("cacheHits");
      return cached;
    }
    const pending = this.inFlight.get(cacheKey) as Promise<T> | undefined;
    if (pending) return pending;
    const call = this.call(path, parameters, caller, reduce, options, cacheKey);
    this.inFlight.set(cacheKey, call);
    void call.finally(() => this.inFlight.delete(cacheKey)).catch(() => undefined);
    return call;
  }

  private async call<T>(
    path: string, parameters: Record<string, string | number | boolean>, caller: TecdocCaller,
    reduce: (payload: unknown) => T, options: TecdocRequestOptions<T>, cacheKey: string,
  ): Promise<T> {
    if (Date.now() < this.pausedUntil) throw new TecdocError("unavailable", "paused");
    await this.takeVisitorShare(caller);
    const refusal = await this.budget.take().catch(() => { throw new TecdocError("unavailable", "budget"); });
    if (refusal) throw new TecdocError("limited", refusal);

    const url = new URL(this.baseUrl + path);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, String(value));
    let payload: unknown;
    try {
      payload = (await this.http(url.href, { headers: { "x-api-key": this.key! }, timeoutMs: TIMEOUT_MS })).data;
    } catch (error) {
      throw this.failed(error);
    }
    this.failures = 0;
    this.lastSuccessAt = new Date().toISOString();
    const value = reduce(payload);
    const ttl = options.isEmpty?.(value) ? EMPTY_TTL_SECONDS : options.ttlSeconds ?? this.cache.ttlSeconds;
    await this.cache.set(cacheKey, value, ttl).catch(() => undefined);
    return value;
  }

  private async takeVisitorShare(caller: TecdocCaller): Promise<void> {
    const identity = caller.userId ? `user:${caller.userId}` : `ip:${caller.ip}`;
    const digest = this.crypto.opaqueHash("tecdoc-visitor", identity).toString("hex").slice(0, 40);
    let used: number;
    try {
      await this.redis.ensureConnected();
      used = Number(await this.redis.client.eval(TAKE_VISITOR, 1, `${VISITOR_PREFIX}${storeDay(new Date())}:${digest}`));
    } catch {
      throw new TecdocError("unavailable", "visitor-limit");
    }
    if (!Number.isFinite(used) || used > this.visitorDailyLimit) {
      this.budget.note("refused");
      throw new TecdocError("limited", "visitor");
    }
  }

  private failed(error: unknown): TecdocError {
    this.budget.note("errors");
    const status = error instanceof UpstreamStatusError ? error.status : 0;
    const detail = status ? `http ${status}` : error instanceof Error ? error.name : "unknown";
    this.lastError = { at: new Date().toISOString(), detail };
    // The key or the quota was refused: asking again only spends attempts.
    if (status === 401 || status === 402 || status === 403 || status === 429) {
      this.pausedUntil = Date.now() + QUOTA_PAUSE_MS;
      this.logger.warn(`provider refused the request (${detail}); paused for 10 minutes`);
      return new TecdocError("refused", detail);
    }
    // A wrong id or VIN is the visitor's input, not an outage.
    if (status === 400 || status === 404 || status === 422) return new TecdocError("unavailable", detail);
    this.failures += 1;
    if (this.failures >= BREAKER_FAILURES) {
      this.failures = 0;
      this.pausedUntil = Date.now() + BREAKER_PAUSE_MS;
      this.logger.warn(`provider failing (${detail}); paused for a minute`);
    }
    return new TecdocError("unavailable", detail);
  }
}
