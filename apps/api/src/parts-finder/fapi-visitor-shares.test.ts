import { createHmac, randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RedisService } from "../infrastructure/redis.service.js";
import type { CryptoService } from "../security/crypto.service.js";
import { RedisFapiVisitorShares } from "./fapi-visitor-shares.js";

const crypto = {
  opaqueHash: (purpose: string, value: string) => createHmac("sha256", "a key of the test").update(purpose).update("\0").update(value).digest(),
} as unknown as CryptoService;

describe("the visitors' shares of FAPI credits, as they are sent to Redis", () => {
  function recording() {
    const calls: unknown[][] = [];
    const redis = {
      client: { eval: vi.fn(async (...call: unknown[]) => { calls.push(call); return 1; }) },
      ensureConnected: vi.fn(async () => undefined),
    } as unknown as RedisService;
    return { calls, shares: new RedisFapiVisitorShares(redis, crypto) };
  }

  it("never sends the visitor's address as it is", async () => {
    const { calls, shares } = recording();
    await shares.take("203.0.113.9", "2026-11-22", 8, 100);
    await shares.giveBack("203.0.113.9", "2026-11-22", 7);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toContain("203.0.113.9");
  });

  it("keeps each day and each visitor under a key of its own", async () => {
    const { calls, shares } = recording();
    await shares.take("203.0.113.9", "2026-11-22", 1, 100);
    await shares.take("203.0.113.9", "2026-11-23", 1, 100);
    await shares.take("198.51.100.7", "2026-11-22", 1, 100);
    await shares.giveBack("203.0.113.9", "2026-11-22", 1);
    const keys = calls.map((call) => call[2]);
    expect(new Set(keys.slice(0, 3)).size).toBe(3);
    expect(keys[3]).toBe(keys[0]);
    expect(keys[0]).toMatch(/^an30:fapi:visitor:2026-11-22:[0-9a-f]{40}$/u);
  });

  it("does not answer for a share it could not count", async () => {
    const redis = { client: { eval: vi.fn() }, ensureConnected: async () => { throw new Error("no connection"); } } as unknown as RedisService;
    await expect(new RedisFapiVisitorShares(redis, crypto).take("203.0.113.9", "2026-11-22", 1, 100)).rejects.toThrow("no connection");
  });
});

// The counting itself is two scripts run by Redis; they are checked on a real one:
//   REDIS_TEST_URL=redis://127.0.0.1:6379 corepack pnpm --filter @an30/api exec vitest run src/parts-finder/fapi-visitor-shares.test.ts
// The keys are of days in 2099 and of visitors named at random, and are removed afterwards.
describe.skipIf(!process.env.REDIS_TEST_URL)("the visitors' shares of FAPI credits, counted by a real Redis", () => {
  let client: Redis;
  let shares: RedisFapiVisitorShares;
  const day = "2099-01-01";
  const visitor = () => `visitor-${randomUUID()}`;
  const stored = async () => client.keys("an30:fapi:visitor:2099-*");

  beforeAll(async () => {
    client = new Redis(process.env.REDIS_TEST_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    shares = new RedisFapiVisitorShares({ client, ensureConnected: async () => undefined } as unknown as RedisService, crypto);
  });

  afterAll(async () => {
    const keys = await stored();
    if (keys.length > 0) await client.del(...keys);
    await client.quit();
  });

  it("lets a visitor take credits up to the limit and not one more", async () => {
    const who = visitor();
    expect(await shares.take(who, day, 35, 100)).toBe(true);
    expect(await shares.take(who, day, 35, 100)).toBe(true);
    expect(await shares.take(who, day, 35, 100)).toBe(false);
    // A refused take leaves the share as it was: 30 credits are still there.
    expect(await shares.take(who, day, 30, 100)).toBe(true);
    expect(await shares.take(who, day, 1, 100)).toBe(false);
  });

  it("refuses a call dearer than the whole share, and takes nothing for it", async () => {
    const who = visitor();
    expect(await shares.take(who, day, 8, 5)).toBe(false);
    expect(await shares.take(who, day, 5, 5)).toBe(true);
  });

  it("counts two visitors and two days apart", async () => {
    const [one, two] = [visitor(), visitor()];
    expect(await shares.take(one, day, 10, 10)).toBe(true);
    expect(await shares.take(two, day, 10, 10)).toBe(true);
    expect(await shares.take(one, "2099-01-02", 10, 10)).toBe(true);
    expect(await shares.take(one, day, 1, 10)).toBe(false);
  });

  it("frees what is given back", async () => {
    const who = visitor();
    await shares.take(who, day, 8, 8);
    await shares.giveBack(who, day, 7);
    expect(await shares.take(who, day, 7, 8)).toBe(true);
    expect(await shares.take(who, day, 1, 8)).toBe(false);
  });

  it("never gives back more than was taken", async () => {
    const who = visitor();
    await shares.take(who, day, 2, 10);
    await shares.giveBack(who, day, 50);
    expect(await shares.take(who, day, 10, 10)).toBe(true);
    expect(await shares.take(who, day, 1, 10)).toBe(false);
  });

  it("stores nothing for a visitor who only gave back", async () => {
    const before = (await stored()).length;
    await shares.giveBack(visitor(), day, 5);
    expect((await stored()).length).toBe(before);
  });

  it("forgets a share by itself a little over a day later", async () => {
    const before = new Set(await stored());
    await shares.take(visitor(), "2099-02-02", 1, 10);
    const key = (await stored()).find((name) => !before.has(name))!;
    const seconds = await client.ttl(key);
    expect(seconds).toBeGreaterThan(86_400);
    expect(seconds).toBeLessThanOrEqual(90_000);
    // A refused take and a give-back keep the lifetime that was set.
    await client.expire(key, 500);
    await shares.giveBack("somebody else", "2099-02-02", 1);
    expect(await client.ttl(key)).toBeLessThanOrEqual(500);
  });
});
