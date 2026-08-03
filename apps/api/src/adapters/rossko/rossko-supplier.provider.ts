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
const CACHE_TTL_SECONDS = 180;
const REQUEST_TIMEOUT_MS = 10_000;

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

function isCachedSearchResult(value: unknown): value is SupplierSearchResult {
  return Boolean(
    value
    && typeof value === "object"
    && "success" in value
    && typeof (value as { success: unknown }).success === "boolean"
    && "parts" in value
    && Array.isArray((value as { parts: unknown }).parts)
    && "message" in value
    && typeof (value as { message: unknown }).message === "string",
  );
}

@Injectable()
export class RosskoSupplierProvider implements SupplierProvider {
  private readonly logger = new Logger(RosskoSupplierProvider.name);
  readonly enabled: boolean;
  private readonly deliveryId: string;
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

    await this.rateLimit.consume(
      OUTBOUND_RATE_LIMIT_SCOPE,
      OUTBOUND_RATE_LIMIT_IDENTITY,
      OUTBOUND_RATE_LIMIT_MAX_CALLS,
      OUTBOUND_RATE_LIMIT_WINDOW_SECONDS,
    );

    const result = await this.call(query);
    await this.writeCache(cacheKey, result);
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
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      const body = await response.text();
      if (!response.ok) {
        this.logger.warn(`Rossko GetSearch responded with HTTP ${response.status}`);
        return { message: "Поставщик временно недоступен", parts: [], success: false };
      }
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
      return isCachedSearchResult(parsed) ? parsed : null;
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
