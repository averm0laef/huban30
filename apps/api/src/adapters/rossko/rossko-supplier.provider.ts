import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../../infrastructure/redis.service.js";
import { RateLimitService } from "../../security/rate-limit.service.js";
import type { SupplierProvider, SupplierSearchResult } from "../provider-contracts.js";
import {
  buildGetSearchEnvelope,
  normaliseSupplierQuery,
  parseSearchResponseXml,
  ROSSKO_ENDPOINT,
  ROSSKO_SOAP_ACTION,
  supplierCacheKey,
} from "./rossko-soap.js";

// A live GetSearch call was measured at 4-5 seconds and ~140 KB for a common
// part number, so results are cached briefly and never fetched on the render
// path — the controller always resolves through this cache-first provider.
// A live GetSearch costs 3–19 s depending on how broad the query is, so a
// three-minute window expired faster than it paid for itself and repeat
// searches kept falling through to the supplier. Fifteen minutes is still
// well inside how often "под заказ" availability moves.
const CACHE_TTL_SECONDS = 900;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
// Broad text searches have been measured at up to 19 seconds on the live
// endpoint. A 10-second abort made those valid searches fail deterministically
// even while Rossko was still working. Keep the request below the usual
// 30-second reverse-proxy ceiling, but leave enough room for the measured
// slow path to finish.
export const ROSSKO_REQUEST_TIMEOUT_MS = 25_000;

// Protects the supplier itself: independent of the per-IP limit enforced at
// the controller, this caps how many *live* GetSearch calls this deployment
// makes in aggregate, across every visitor and every cache miss.
const OUTBOUND_RATE_LIMIT_SCOPE = "rossko-search-outbound";
const OUTBOUND_RATE_LIMIT_IDENTITY = "global";
const OUTBOUND_RATE_LIMIT_MAX_CALLS = 60;
const OUTBOUND_RATE_LIMIT_WINDOW_SECONDS = 60;

const DISABLED_RESULT: SupplierSearchResult = {
  message: "Поиск у поставщика отключён",
  parts: [],
  success: false,
};

async function readBoundedResponseBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Rossko response exceeds the configured size limit");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > MAX_RESPONSE_BYTES) {
      await reader.cancel("response too large");
      throw new Error("Rossko response exceeds the configured size limit");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

function isCachedSearchResult(value: unknown): value is SupplierSearchResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (typeof result.success !== "boolean" || typeof result.message !== "string"
    || result.message.length > 2_000 || !Array.isArray(result.parts) || result.parts.length > 500) return false;

  function isPart(candidate: unknown, depth: number): boolean {
    if (!candidate || typeof candidate !== "object" || depth > 6) return false;
    const part = candidate as Record<string, unknown>;
    if (typeof part.brand !== "string" || part.brand.length > 200
      || typeof part.guid !== "string" || part.guid.length === 0 || part.guid.length > 200
      || typeof part.name !== "string" || part.name.length > 500
      || typeof part.partNumber !== "string" || part.partNumber.length === 0 || part.partNumber.length > 200
      || !Array.isArray(part.stocks) || part.stocks.length > 50
      || !Array.isArray(part.crosses) || part.crosses.length > 50) return false;
    const stocksValid = part.stocks.every((candidateStock) => {
      if (!candidateStock || typeof candidateStock !== "object") return false;
      const stock = candidateStock as Record<string, unknown>;
      return (stock.deliveryTime === null
          || (typeof stock.deliveryTime === "string" && stock.deliveryTime.length <= 120))
        && typeof stock.id === "string" && stock.id.length > 0 && stock.id.length <= 120
        && Number.isSafeInteger(stock.priceKopeks) && Number(stock.priceKopeks) > 0
        && Number.isSafeInteger(stock.quantity) && Number(stock.quantity) >= 0
        && Number(stock.quantity) <= 1_000_000;
    });
    return stocksValid && part.crosses.every((cross) => isPart(cross, depth + 1));
  }

  return result.parts.every((part) => isPart(part, 0));
}

@Injectable()
export class RosskoSupplierProvider implements SupplierProvider {
  private readonly logger = new Logger(RosskoSupplierProvider.name);
  readonly enabled: boolean;
  private readonly deliveryId: string;
  // One live request per cache key in this API process. Without this, a cold
  // popular query makes every concurrent visitor miss Redis and independently
  // spend one outbound rate-limit slot on the same slow SOAP call.
  private readonly inFlight = new Map<string, Promise<SupplierSearchResult>>();
  private readonly key1: string;
  private readonly key2: string;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
  ) {
    this.enabled = config.getOrThrow<boolean>("ROSSKO_ENABLED");
    this.deliveryId = config.getOrThrow<string>("ROSSKO_DELIVERY_ID");
    this.key1 = config.get<string>("ROSSKO_KEY1") ?? "";
    this.key2 = config.get<string>("ROSSKO_KEY2") ?? "";
  }

  async search(rawQuery: string): Promise<SupplierSearchResult> {
    if (!this.enabled) return DISABLED_RESULT;
    const query = normaliseSupplierQuery(rawQuery);
    if (!query) return { message: "Пустой поисковый запрос", parts: [], success: false };

    const cacheKey = supplierCacheKey(query, this.deliveryId);
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const request = this.fetchAndCache(cacheKey, query);
    this.inFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      // Do not let an older request delete a newer replacement should this
      // method ever gain cancellation/retry logic later.
      if (this.inFlight.get(cacheKey) === request) this.inFlight.delete(cacheKey);
    }
  }

  private async fetchAndCache(cacheKey: string, query: string): Promise<SupplierSearchResult> {
    await this.rateLimit.consume(
      OUTBOUND_RATE_LIMIT_SCOPE,
      OUTBOUND_RATE_LIMIT_IDENTITY,
      OUTBOUND_RATE_LIMIT_MAX_CALLS,
      OUTBOUND_RATE_LIMIT_WINDOW_SECONDS,
    );

    const result = await this.call(query);
    // A timeout, HTTP 5xx or malformed response is transient. Caching it for
    // the normal 15-minute success TTL turns one short Rossko incident into a
    // guaranteed 15-minute outage even after the supplier has recovered.
    if (result.success) await this.writeCache(cacheKey, result);
    return result;
  }

  private async call(normalisedQuery: string): Promise<SupplierSearchResult> {
    const envelope = buildGetSearchEnvelope({
      deliveryId: this.deliveryId,
      key1: this.key1,
      key2: this.key2,
      text: normalisedQuery,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ROSSKO_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ROSSKO_ENDPOINT, {
        body: envelope,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: ROSSKO_SOAP_ACTION,
        },
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Rossko GetSearch responded with HTTP ${response.status}`);
        return { message: "Поставщик временно недоступен", parts: [], success: false };
      }
      const body = await readBoundedResponseBody(response);
      return parseSearchResponseXml(body);
    } catch (error) {
      this.logger.warn("Rossko GetSearch call failed", error);
      return { message: "Поставщик временно недоступен", parts: [], success: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readCache(key: string): Promise<SupplierSearchResult | null> {
    try {
      await this.redis.ensureConnected();
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      // Older releases cached transient failures. Deliberately reject one if
      // it is still present during a rolling deploy instead of preserving the
      // old 15-minute sticky outage until its TTL naturally expires.
      return isCachedSearchResult(parsed) && parsed.success ? parsed : null;
    } catch {
      // Cache is a best-effort optimisation; a Redis hiccup on read must not
      // fail the search, it should just fall through to a live call.
      return null;
    }
  }

  private async writeCache(key: string, result: SupplierSearchResult): Promise<void> {
    try {
      await this.redis.ensureConnected();
      await this.redis.client.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
    } catch {
      // Best effort — a cache write failure must not fail the search.
    }
  }
}
