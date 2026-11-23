import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../infrastructure/redis.service.js";
import { requestJson, UpstreamStatusError, UpstreamUnavailableError, type RequestJson } from "../parts-finder/engine/http.js";
import { CryptoService } from "../security/crypto.service.js";
import { storeDay } from "../tecdoc/tecdoc-budget.js";
import { UmapiBudgetService } from "./umapi-budget.service.js";
import { UmapiCacheService } from "./umapi-cache.service.js";

/** Replaceable outbound HTTP: tests inject a fake, the paid API is never called from tests. */
export const UMAPI_HTTP = Symbol("UMAPI_HTTP");

/** Who pressed the button: every call answers one visitor's own request; nothing calls UMAPI in the background. */
export interface UmapiCaller { ip: string; userId?: string | null }

export type UmapiFailure =
  /** No key, switched off. */
  | "disabled"
  /** Our own limits: the day's or hour's share, one visitor's share. */
  | "limited"
  /** UMAPI refused the key (401/403) or the method is not paid for (402), or 429. */
  | "refused"
  /** Network, timeout, 5xx, or too many failures in a row. */
  | "unavailable";

export class UmapiError extends Error {
  constructor(readonly failure: UmapiFailure, readonly detail: string) {
    super(`umapi ${failure}: ${detail}`);
    this.name = "UmapiError";
  }
}

export interface UmapiRequestOptions<T> {
  /** Every admitted photo-button request is sent upstream, even with a warm cache. */
  fresh?: boolean;
  /** True when the reduced answer holds nothing: kept for an hour, so a miss is asked again soon. */
  isEmpty?: (value: T) => boolean;
  /** The answer for «404 — no such number»: an answer about the number, kept for an hour, not an outage. */
  whenNotFound?: T;
}

const VISITOR_PREFIX = "an30:umapi:visitor:";
const TAKE_VISITOR = `
  local used = redis.call('INCR', KEYS[1])
  if used == 1 then redis.call('EXPIRE', KEYS[1], 90000) end
  return used
`;
const EMPTY_TTL_SECONDS = 3_600;
const TIMEOUT_MS = 8_000;
const BREAKER_FAILURES = 5;
const BREAKER_PAUSE_MS = 60_000;
const REFUSAL_PAUSE_MS = 10 * 60_000;

/**
 * UMAPI over HTTPS (docs/UMAPI_INTEGRATION.md): the key in the X-App-Key header,
 * /v2/autocatalog/{locale}/… paths. A call is made only for a visitor's button,
 * within the visitor's and the site's share of the day; an answer comes from
 * the display cache when it is there, and the same question asked twice at
 * once is sent once.
 */
@Injectable()
export class UmapiGateway {
  private readonly logger = new Logger(UmapiGateway.name);
  private readonly key: string | undefined;
  private readonly host: string;
  private readonly catalogPrefix: string;
  private readonly switchedOn: boolean;
  private readonly visitorDailyLimit: number;
  readonly mediaBaseUrl: string | null;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private failures = 0;
  private pausedUntil = 0;
  private lastError: { at: string; detail: string } | null = null;
  private lastSuccessAt: string | null = null;

  constructor(
    config: ConfigService,
    private readonly cache: UmapiCacheService,
    private readonly budget: UmapiBudgetService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    @Optional() @Inject(UMAPI_HTTP) private readonly http: RequestJson = requestJson,
  ) {
    this.key = config.get<string>("UMAPI_API_KEY") || undefined;
    this.host = (config.get<string>("UMAPI_BASE_URL") ?? "https://api.umapi.ru").replace(/\/+$/u, "");
    this.catalogPrefix = `/v2/autocatalog/${config.get<string>("UMAPI_LOCALE") ?? "ru-WWW"}`;
    this.switchedOn = config.get<boolean>("UMAPI_ENABLED") !== false;
    this.visitorDailyLimit = config.get<number>("UMAPI_VISITOR_DAILY_LIMIT") ?? 0;
    this.mediaBaseUrl = config.get<string>("UMAPI_MEDIA_BASE_URL")?.replace(/\/+$/u, "") || null;
  }

  get enabled(): boolean {
    return this.switchedOn && Boolean(this.key);
  }

  /** Configured and not paused after a refusal or an outage. */
  get available(): boolean {
    return this.enabled && Date.now() >= this.pausedUntil;
  }

  get health() {
    return { configured: Boolean(this.key), enabled: this.enabled, lastError: this.lastError, lastSuccessAt: this.lastSuccessAt, paused: Date.now() < this.pausedUntil };
  }

  /** `path` is relative to /v2/autocatalog/{locale}, or a full «/v2/…» path; its variable parts must already be URL-encoded. */
  async get<T>(
    path: string,
    parameters: Record<string, string | number | boolean>,
    caller: UmapiCaller,
    reduce: (payload: unknown) => T,
    options: UmapiRequestOptions<T> = {},
  ): Promise<T> {
    if (!this.enabled) throw new UmapiError("disabled", "no key");
    const cacheKey = UmapiCacheService.keyOf(path, parameters);
    if (options.fresh) return this.call(path, parameters, caller, reduce, options, cacheKey);
    let cached: T | undefined;
    try {
      cached = await this.cache.get<T>(cacheKey);
    } catch {
      // Without the cache every view would be a paid call: stop instead.
      throw new UmapiError("unavailable", "cache");
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
    path: string, parameters: Record<string, string | number | boolean>, caller: UmapiCaller,
    reduce: (payload: unknown) => T, options: UmapiRequestOptions<T>, cacheKey: string,
  ): Promise<T> {
    if (Date.now() < this.pausedUntil) throw new UmapiError("unavailable", "paused");
    await this.takeVisitorShare(caller);
    const refusal = await this.budget.take().catch(() => { throw new UmapiError("unavailable", "budget"); });
    if (refusal) throw new UmapiError("limited", refusal);

    const url = new URL(this.host + (path.startsWith("/v2/") ? path : this.catalogPrefix + path));
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, String(value));
    let payload: unknown;
    try {
      payload = (await this.http(url.href, { headers: { "X-App-Key": this.key! }, timeoutMs: TIMEOUT_MS })).data;
    } catch (error) {
      // «Not found» comes as a 404 or, from getCrossInfo, as an empty 200: an answer about the number, not an outage
      // (it had put «Проверка по каталогу сейчас недоступна» on every part the catalogue does not know, 24.11.2026).
      const notFound = (error instanceof UpstreamStatusError && error.status === 404)
        || (error instanceof UpstreamUnavailableError && error.reason === "empty_body");
      if (options.whenNotFound !== undefined && notFound) {
        await this.cache.set(cacheKey, options.whenNotFound, EMPTY_TTL_SECONDS).catch(() => undefined);
        return options.whenNotFound;
      }
      throw this.failed(error);
    }
    this.failures = 0;
    this.lastSuccessAt = new Date().toISOString();
    const value = reduce(payload);
    const ttl = options.isEmpty?.(value) ? EMPTY_TTL_SECONDS : this.cache.ttlSeconds;
    await this.cache.set(cacheKey, value, ttl).catch(() => undefined);
    return value;
  }

  /** One visitor's share of the day; off while UMAPI_VISITOR_DAILY_LIMIT is 0 (the default since 24.11.2026). */
  private async takeVisitorShare(caller: UmapiCaller): Promise<void> {
    if (this.visitorDailyLimit <= 0) return;
    const identity = caller.userId ? `user:${caller.userId}` : `ip:${caller.ip}`;
    const digest = this.crypto.opaqueHash("umapi-visitor", identity).toString("hex").slice(0, 40);
    let used: number;
    try {
      await this.redis.ensureConnected();
      used = Number(await this.redis.client.eval(TAKE_VISITOR, 1, `${VISITOR_PREFIX}${storeDay(new Date())}:${digest}`));
    } catch {
      throw new UmapiError("unavailable", "visitor-limit");
    }
    if (!Number.isFinite(used) || used > this.visitorDailyLimit) {
      this.budget.note("refused");
      throw new UmapiError("limited", "visitor");
    }
  }

  private failed(error: unknown): UmapiError {
    this.budget.note("errors");
    const status = error instanceof UpstreamStatusError ? error.status : 0;
    const detail = status ? `http ${status}` : error instanceof Error ? error.name : "unknown";
    this.lastError = { at: new Date().toISOString(), detail };
    // The key, the payment or the rate was refused: asking again only spends attempts.
    if (status === 401 || status === 402 || status === 403 || status === 429) {
      this.pausedUntil = Date.now() + REFUSAL_PAUSE_MS;
      this.logger.warn(`UMAPI refused the request (${detail}); paused for 10 minutes`);
      return new UmapiError("refused", detail);
    }
    // A number UMAPI does not know is an answer about that number, not an outage.
    if (status === 400 || status === 404 || status === 422) return new UmapiError("unavailable", detail);
    this.failures += 1;
    if (this.failures >= BREAKER_FAILURES) {
      this.failures = 0;
      this.pausedUntil = Date.now() + BREAKER_PAUSE_MS;
      this.logger.warn(`UMAPI failing (${detail}); paused for a minute`);
    }
    return new UmapiError("unavailable", detail);
  }
}
