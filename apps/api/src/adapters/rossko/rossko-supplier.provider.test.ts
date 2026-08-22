import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RedisService } from "../../infrastructure/redis.service.js";
import type { RateLimitService } from "../../security/rate-limit.service.js";
import {
  ROSSKO_REQUEST_TIMEOUT_MS,
  RosskoSupplierProvider,
} from "./rossko-supplier.provider.js";
import { supplierCacheKey } from "./rossko-soap.js";

const CONFIG_VALUES: Record<string, unknown> = {
  ROSSKO_DELIVERY_ID: "000000001",
  ROSSKO_ENABLED: true,
  ROSSKO_KEY1: "test-key-1",
  ROSSKO_KEY2: "test-key-2",
};

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...CONFIG_VALUES, ...overrides };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => { store.set(key, value); return "OK"; }),
    },
    ensureConnected: vi.fn(async () => undefined),
    store,
  } as unknown as RedisService & { store: Map<string, string> };
}

function makeRateLimit() {
  return { consume: vi.fn(async () => undefined) } as unknown as RateLimitService;
}

const SUCCESS_XML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetSearchResponse xmlns="https://api.rossko.ru/">
      <GetSearchResult>
        <success>true</success>
        <text>W914/2</text>
        <message>OK</message>
        <PartsList>
          <Part>
            <guid>g1</guid>
            <brand>MANN</brand>
            <partnumber>W914/2</partnumber>
            <name>Масляный фильтр</name>
            <stocks>
              <stock>
                <id>s1</id>
                <price>456.70</price>
                <count>12</count>
                <delivery_time>2</delivery_time>
              </stock>
            </stocks>
            <crosses></crosses>
          </Part>
        </PartsList>
      </GetSearchResult>
    </GetSearchResponse>
  </soap:Body>
</soap:Envelope>`;

describe("RosskoSupplierProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("allows the measured 19-second broad-search path to finish before aborting", () => {
    expect(ROSSKO_REQUEST_TIMEOUT_MS).toBeGreaterThan(19_000);
    expect(ROSSKO_REQUEST_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it("stays disabled and never touches Redis, the rate limiter or the network", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig({ ROSSKO_ENABLED: false }), redis, rateLimit);
    expect(provider.enabled).toBe(false);

    const result = await provider.search("W914/2");
    expect(result).toEqual({ message: "Поиск у поставщика отключён", parts: [], success: false });
    expect(redis.ensureConnected).not.toHaveBeenCalled();
    expect(rateLimit.consume).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("builds the envelope with the configured keys and delivery id, and caches the result", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response(SUCCESS_XML, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    const result = await provider.search("  w914/2  ");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    // The operation name belongs in the path; the bare directory answers 404.
    expect(url).toBe("https://api.rossko.ru/service/v2.1/GetSearch");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).SOAPAction)
      .toBe("https://api.rossko.ru/service/v2.1/GetSearch");
    expect(String(init.body)).toContain("<KEY1>test-key-1</KEY1>");
    expect(String(init.body)).toContain("<KEY2>test-key-2</KEY2>");
    expect(String(init.body)).toContain("<text>W914/2</text>");
    expect(String(init.body)).toContain("<delivery_id>000000001</delivery_id>");

    expect(rateLimit.consume).toHaveBeenCalledWith("rossko-search-outbound", "global", expect.any(Number), expect.any(Number));
    expect(result.success).toBe(true);
    expect(result.parts).toHaveLength(1);
    expect(redis.client.set).toHaveBeenCalledTimes(1);
  });

  it("serves a cached result without calling the rate limiter or the network again", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn(async () => new Response(SUCCESS_XML, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    await provider.search("W914/2");
    fetchSpy.mockClear();
    (rateLimit.consume as ReturnType<typeof vi.fn>).mockClear();

    const second = await provider.search("w914/2");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rateLimit.consume).not.toHaveBeenCalled();
    expect(second.parts).toHaveLength(1);
  });

  it("coalesces concurrent misses for the same key into one outbound SOAP call", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { release = resolve; });
    const fetchSpy = vi.fn(async () => response);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    const first = provider.search("W914/2");
    const second = provider.search("  w914/2  ");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    release(new Response(SUCCESS_XML, { status: 200 }));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rateLimit.consume).toHaveBeenCalledTimes(1);
  });

  it("returns a clean failure instead of throwing when the network call rejects", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    globalThis.fetch = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    await expect(provider.search("W914/2")).resolves.toEqual({
      message: "Поставщик временно недоступен",
      parts: [],
      success: false,
    });
  });

  it("returns a clean failure instead of throwing on a non-2xx HTTP status", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    globalThis.fetch = vi.fn(async () => new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    await expect(provider.search("W914/2")).resolves.toEqual({
      message: "Поставщик временно недоступен",
      parts: [],
      success: false,
    });
  });

  it("rejects an oversized successful body before parsing or caching it", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    globalThis.fetch = vi.fn(async () => new Response(SUCCESS_XML, {
      headers: { "content-length": String(6 * 1024 * 1024) },
      status: 200,
    })) as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    await expect(provider.search("W914/2")).resolves.toEqual({
      message: "Поставщик временно недоступен",
      parts: [],
      success: false,
    });
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it("does not cache a transient failure for the normal 15-minute success TTL", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
      .mockResolvedValueOnce(new Response(SUCCESS_XML, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    expect((await provider.search("W914/2")).success).toBe(false);
    expect((await provider.search("W914/2")).success).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(redis.client.set).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale cached failure or malformed nested payload from an older process", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    const key = supplierCacheKey("W914/2", "000000001");
    const fetchSpy = vi.fn(async () => new Response(SUCCESS_XML, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);

    redis.store.set(key, JSON.stringify({ message: "temporary", parts: [], success: false }));
    expect((await provider.search("W914/2")).success).toBe(true);

    redis.store.set(key, JSON.stringify({ message: "OK", parts: [{}], success: true }));
    expect((await provider.search("W914/2")).success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls through to a live call when the Redis cache read fails", async () => {
    const redis = makeRedis();
    redis.client.get = vi.fn(async () => { throw new Error("redis down"); });
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn(async () => new Response(SUCCESS_XML, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    const result = await provider.search("W914/2");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("treats a blank query as an empty search without calling the network", async () => {
    const redis = makeRedis();
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new RosskoSupplierProvider(makeConfig(), redis, rateLimit);
    const result = await provider.search("   ");
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
