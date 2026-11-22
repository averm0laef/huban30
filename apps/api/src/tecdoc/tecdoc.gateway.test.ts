import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import type { RedisService } from "../infrastructure/redis.service.js";
import { UpstreamStatusError, UpstreamUnavailableError, type RequestJson } from "../parts-finder/engine/http.js";
import type { CryptoService } from "../security/crypto.service.js";
import type { TecdocBudgetService, BudgetRefusal } from "./tecdoc-budget.service.js";
import type { TecdocCacheService } from "./tecdoc-cache.service.js";
import { TecdocError, TecdocGateway } from "./tecdoc.gateway.js";

function setup(options: { key?: string | null; refusal?: BudgetRefusal | null; visitorLimit?: number } = {}) {
  const stored = new Map<string, { ttl: number; value: unknown }>();
  const cache = {
    get: vi.fn(async (key: string) => stored.get(key)?.value),
    set: vi.fn(async (key: string, value: unknown, ttl: number) => { stored.set(key, { ttl, value }); }),
    ttlSeconds: 86_400,
  };
  const notes: string[] = [];
  const budget = { note: vi.fn((kind: string) => { notes.push(kind); }), take: vi.fn(async () => options.refusal ?? null) };
  const visitors = new Map<string, number>();
  const redis = {
    client: { eval: vi.fn(async (_script: string, _keys: number, key: string) => { const next = (visitors.get(key) ?? 0) + 1; visitors.set(key, next); return next; }) },
    ensureConnected: async () => undefined,
  };
  const crypto = { opaqueHash: (_purpose: string, value: string) => Buffer.from(value) };
  const http = vi.fn<RequestJson>(async () => ({ data: { data: { list: [{ id: 1 }] }, success: true }, headers: {} }));
  const values: Record<string, unknown> = {
    TECDOC_API_KEY: options.key === null ? undefined : options.key ?? "test-key", TECDOC_BASE_URL: "https://tecdoc.site/api/v2/",
    TECDOC_ENABLED: true, TECDOC_VISITOR_DAILY_LIMIT: options.visitorLimit ?? 150,
  };
  const gateway = new TecdocGateway(
    { get: (name: string) => values[name] } as unknown as ConfigService, cache as unknown as TecdocCacheService,
    budget as unknown as TecdocBudgetService, redis as unknown as RedisService, crypto as unknown as CryptoService, http,
  );
  return { budget, cache, gateway, http, notes, stored };
}

const visitor = { ip: "203.0.113.7" };
const count = (payload: unknown) => ((payload as { data: { list: unknown[] } }).data.list.length);

describe("TecdocGateway", () => {
  it("sends the key in a header, never in the address, and keeps the reduced answer", async () => {
    const { gateway, http, stored } = setup();
    expect(await gateway.get("/model", { mfa_id: 111 }, visitor, count)).toBe(1);
    const [url, request] = http.mock.calls[0]!;
    expect(url).toBe("https://tecdoc.site/api/v2/model?mfa_id=111");
    expect(request?.headers).toEqual({ "x-api-key": "test-key" });
    expect([...stored.values()]).toEqual([{ ttl: 86_400, value: 1 }]);
  });

  it("answers a repeat from the cache without a call, a budget take or a visitor's share", async () => {
    const { budget, gateway, http, notes } = setup();
    await gateway.get("/model", { mfa_id: 111 }, visitor, count);
    await gateway.get("/model", { mfa_id: 111 }, { ip: "198.51.100.9" }, count);
    expect(http).toHaveBeenCalledTimes(1);
    expect(budget.take).toHaveBeenCalledTimes(1);
    expect(notes).toEqual(["cacheHits"]);
  });

  it("makes one call for the same request asked twice at once", async () => {
    const { gateway, http } = setup();
    const answers = await Promise.all([gateway.get("/model", { mfa_id: 5 }, visitor, count), gateway.get("/model", { mfa_id: 5 }, visitor, count)]);
    expect(answers).toEqual([1, 1]);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty answer for an hour only", async () => {
    const { gateway, stored } = setup();
    await gateway.get("/part", { gen_id: 1 }, visitor, () => [] as number[], { isEmpty: (value) => value.length === 0 });
    expect([...stored.values()][0]!.ttl).toBe(3_600);
  });

  it("does nothing without a key", async () => {
    const { gateway, http } = setup({ key: null });
    expect(gateway.enabled).toBe(false);
    await expect(gateway.get("/model", { mfa_id: 1 }, visitor, count)).rejects.toMatchObject({ failure: "disabled" });
    expect(http).not.toHaveBeenCalled();
  });

  it("refuses when the site's budget or one visitor's share is used up, without calling the provider", async () => {
    const limited = setup({ refusal: "day" });
    await expect(limited.gateway.get("/model", { mfa_id: 1 }, visitor, count)).rejects.toMatchObject({ detail: "day", failure: "limited" });
    expect(limited.http).not.toHaveBeenCalled();

    const greedy = setup({ visitorLimit: 2 });
    await greedy.gateway.get("/model", { mfa_id: 1 }, visitor, count);
    await greedy.gateway.get("/model", { mfa_id: 2 }, visitor, count);
    await expect(greedy.gateway.get("/model", { mfa_id: 3 }, visitor, count)).rejects.toMatchObject({ detail: "visitor", failure: "limited" });
    expect(greedy.http).toHaveBeenCalledTimes(2);
    expect(greedy.budget.take).toHaveBeenCalledTimes(2);
    // Another visitor is not affected; a signed-in customer is counted by account, not by address.
    await greedy.gateway.get("/model", { mfa_id: 3 }, { ip: visitor.ip, userId: "u1" }, count);
    expect(greedy.http).toHaveBeenCalledTimes(3);
  });

  it("pauses after the provider refuses the key or quota, and after repeated failures", async () => {
    const refused = setup();
    refused.http.mockRejectedValueOnce(new UpstreamStatusError(401, {}));
    await expect(refused.gateway.get("/model", { mfa_id: 1 }, visitor, count)).rejects.toMatchObject({ failure: "refused" });
    await expect(refused.gateway.get("/model", { mfa_id: 2 }, visitor, count)).rejects.toMatchObject({ detail: "paused", failure: "unavailable" });
    expect(refused.http).toHaveBeenCalledTimes(1);
    expect(refused.gateway.health).toMatchObject({ lastError: { detail: "http 401" }, paused: true });

    const failing = setup();
    failing.http.mockRejectedValue(new UpstreamUnavailableError("TimeoutError"));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(failing.gateway.get("/model", { mfa_id: attempt }, visitor, count)).rejects.toBeInstanceOf(TecdocError);
    }
    await expect(failing.gateway.get("/model", { mfa_id: 99 }, visitor, count)).rejects.toMatchObject({ detail: "paused" });
    expect(failing.http).toHaveBeenCalledTimes(5);
  });

  it("does not count a wrong id or VIN as an outage", async () => {
    const { gateway, http } = setup();
    http.mockRejectedValue(new UpstreamStatusError(422, {}));
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await expect(gateway.get(`/vin/BAD${attempt}`, {}, visitor, count)).rejects.toMatchObject({ failure: "unavailable" });
    }
    expect(http).toHaveBeenCalledTimes(7);
    expect(gateway.health.paused).toBe(false);
  });
});
