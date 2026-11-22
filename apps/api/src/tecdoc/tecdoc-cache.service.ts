import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../infrastructure/redis.service.js";

const PREFIX = "an30:tecdoc:c:";
const INDEX = "an30:tecdoc:index";
/** Larger answers are shown but not kept. */
const MAX_VALUE_BYTES = 512 * 1024;

// One step: store with a lifetime, forget what expired, and drop the entries
// closest to expiry when the cache holds more than its allowed number.
const STORE = `
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  redis.call('ZADD', KEYS[2], ARGV[3], KEYS[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[4])
  local extra = redis.call('ZCARD', KEYS[2]) - tonumber(ARGV[5])
  if extra > 0 then
    local victims = redis.call('ZRANGE', KEYS[2], 0, extra - 1)
    for _, key in ipairs(victims) do redis.call('DEL', key) end
    redis.call('ZREMRANGEBYRANK', KEYS[2], 0, extra - 1)
  end
  return redis.call('ZCARD', KEYS[2])
`;

const CLEAR = `
  local keys = redis.call('ZRANGE', KEYS[1], 0, -1)
  for _, key in ipairs(keys) do redis.call('DEL', key) end
  redis.call('DEL', KEYS[1])
  return #keys
`;

/**
 * The display cache for provider answers (docs/TECDOC.md): only what a
 * visitor asked for, only in the reduced form the site shows, in Redis, with a
 * short lifetime and a hard cap on the number of entries. It is filled by
 * visitors' requests alone and can be emptied with one call. It is not, and
 * cannot grow into, a copy of the provider's database.
 */
@Injectable()
export class TecdocCacheService {
  readonly ttlSeconds: number;
  readonly maxEntries: number;

  constructor(private readonly redis: RedisService, config: ConfigService) {
    this.ttlSeconds = config.get<number>("TECDOC_CACHE_TTL_SECONDS") ?? 86_400;
    this.maxEntries = config.get<number>("TECDOC_CACHE_MAX_ENTRIES") ?? 20_000;
  }

  /** A stable key for a request: the path and its parameters in sorted order. */
  static keyOf(path: string, parameters: Record<string, string | number | boolean>): string {
    const sorted = Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return createHash("sha256").update(JSON.stringify([path, sorted])).digest("hex");
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.redis.ensureConnected();
    const stored = await this.redis.client.get(PREFIX + key);
    if (stored === null) return undefined;
    try {
      return JSON.parse(stored) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > MAX_VALUE_BYTES) return;
    const ttl = Math.max(60, Math.min(ttlSeconds, this.ttlSeconds));
    const now = Math.floor(Date.now() / 1000);
    await this.redis.ensureConnected();
    await this.redis.client.eval(STORE, 2, PREFIX + key, INDEX, body, String(ttl), String(now + ttl), String(now), String(this.maxEntries));
  }

  async size(): Promise<number> {
    await this.redis.ensureConnected();
    await this.redis.client.zremrangebyscore(INDEX, "-inf", Math.floor(Date.now() / 1000));
    return this.redis.client.zcard(INDEX);
  }

  /** Empties the cache: on the owner's request, and when the contract ends. */
  async clear(): Promise<number> {
    await this.redis.ensureConnected();
    return Number(await this.redis.client.eval(CLEAR, 1, INDEX));
  }
}
