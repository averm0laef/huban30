import { describe, expect, it, vi } from "vitest";

import { FapiBudget, moscowDay, type FapiLedgerStore, type FapiLedgerTx, type FapiVisitorShares } from "./fapi-budget.js";
import { FAPI_URL, findPart, readUsage, type FapiUsage } from "./fapi.js";
import { UpstreamStatusError, type JsonResponse, type RequestJson } from "./http.js";
import { searchVehicleParts } from "./vehicle-parts.js";

class MemoryLedger implements FapiLedgerStore {
  accounts = new Map<string, { checked: number; usage: FapiUsage }>();
  packages = new Map<string, number>();
  daily = new Map<string, number>();
  cache = new Map<string, { expires: number; payload: unknown }>();
  async deleteAccount(scope: string) { this.accounts.delete(scope); }
  async getAccount(scope: string) { return this.accounts.get(scope) ?? null; }
  async purgeExpiredCache(now: number) { for (const [key, value] of this.cache) if (value.expires <= now) this.cache.delete(key); }
  async saveAccount(scope: string, checked: number, usage: FapiUsage) { this.accounts.set(scope, { checked, usage }); }
  async transaction<T>(work: (tx: FapiLedgerTx) => Promise<T>): Promise<T> {
    const tx: FapiLedgerTx = {
      getCache: async (period, key, now) => {
        const hit = this.cache.get(`${period}|${key}`);
        return hit && hit.expires > now ? hit.payload : undefined;
      },
      getDaily: async (scope, day) => this.daily.get(`${scope}|${day}`) ?? 0,
      getPackage: async (period) => this.packages.get(period) ?? null,
      putCache: async (period, key, expires, payload) => { this.cache.set(`${period}|${key}`, { expires, payload }); },
      setDaily: async (scope, day, reserved) => { this.daily.set(`${scope}|${day}`, reserved); },
      setPackage: async (period, remaining) => { this.packages.set(period, remaining); },
    };
    return work(tx);
  }
  totalDaily() { return [...this.daily.values()].reduce((sum, value) => sum + value, 0); }
}

/** The visitors' shares of the day, in memory (Redis in production). */
class MemoryShares implements FapiVisitorShares {
  used = new Map<string, number>();
  failing = false;
  /** When set, a take waits for it: lets a test put a second request beside one that is being decided. */
  hold: Promise<void> | null = null;
  waiting = 0;
  async take(visitor: string, day: string, credits: number, limit: number) {
    if (this.failing) throw new Error("the shares cannot be counted");
    if (this.hold) {
      this.waiting += 1;
      await this.hold;
    }
    const next = (this.used.get(`${visitor}|${day}`) ?? 0) + credits;
    if (next > limit) return false;
    this.used.set(`${visitor}|${day}`, next);
    return true;
  }
  async giveBack(visitor: string, day: string, credits: number) {
    this.used.set(`${visitor}|${day}`, Math.max(0, (this.used.get(`${visitor}|${day}`) ?? 0) - credits));
  }
  of(visitor: string) { return [...this.used].filter(([key]) => key.startsWith(`${visitor}|`)).reduce((sum, [, value]) => sum + value, 0); }
}

function account(remaining = 100) {
  return { account: { st: "allowed", pl: "trial", inc: 100, rem: remaining, u: 100 - remaining } };
}

function sequence(...answers: unknown[]) {
  return vi.fn<RequestJson>(async () => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { data: next, headers: {} } as JsonResponse;
  });
}

function budget(http: RequestJson, options: { key?: string; limit?: number; ledger?: MemoryLedger; shares?: MemoryShares; visitorLimit?: number } = {}) {
  const ledger = options.ledger ?? new MemoryLedger();
  const shares = options.shares ?? new MemoryShares();
  const visitorLimit = options.visitorLimit;
  return {
    budget: new FapiBudget(ledger, {
      dailyLimit: () => options.limit ?? 1000, key: () => options.key ?? "fake-fapi", requestJson: http,
      ...(visitorLimit === undefined ? {} : { visitors: { limit: () => visitorLimit, shares } }),
    }),
    ledger,
    shares,
  };
}

/** A FAPI card that is not empty: the call costs what was reserved for it. */
const card = (article: string) => ({ candidates: [{ mfi: 7, ds: "Brand", n: article }] });
const VISITOR = "203.0.113.9";
const OTHER_VISITOR = "198.51.100.7";

describe("FAPI cards and usage (fapi_catalog.py)", () => {
  it("returns grouped references for an article", async () => {
    const original = { mfi: 7, ds: "Source Brand", n: "W 75/3", ns: "W753" };
    const replacement = { mfi: 7, ds: "Source Brand", n: "W 75/4", ns: "W754" };
    const response = {
      part: original, current: replacement, candidates: [original], status: "replaced",
      analogs: [{ mfi: 9, ds: "Other Brand", ns: "AB100", rp: 3, rm: 0, mfc: true }],
      oe: [{ mfi: 12, ds: "Car Brand", n: "00001" }], replacedBy: [replacement],
    };
    const http = sequence(response);
    const item = await findPart({ article: " W 75/3 ", manufacturer_id: 7 }, { fetch: (path, params) => import("./fapi.js").then((fapi) => fapi.fapiRequest(path, "fapi-test", http, params)) });
    expect(http).toHaveBeenCalledWith(`${FAPI_URL}/part?n=W+75%2F3&limit=100&mfi=7`, { headers: { Authorization: "Bearer fapi-test" }, timeoutMs: 10_000 });
    expect([item.status, item.part_status, (item.current as { article: string }).article]).toEqual(["found", "replaced", "W 75/4"]);
    expect((item.groups as Record<string, Array<{ article: string }>>).oe![0]!.article).toBe("00001");
  });

  it("asks for a brand without an extra call and validates input before any request", async () => {
    const fetch = vi.fn(async () => ({ candidates: [{ mfi: 7, ds: "One", n: "42" }, { mfi: 9, ds: "Two", n: "42" }] }));
    const item = await findPart({ article: "42" }, { fetch });
    expect([item.status, (item.candidates as Array<{ brand: string }>).map((part) => part.brand)]).toEqual(["choose_brand", ["One", "Two"]]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(findPart({ article: "42", manufacturer_id: true }, { fetch })).rejects.toMatchObject({ status: 400 });
    await expect(findPart({ article: "" }, { fetch })).rejects.toMatchObject({ code: "invalid_article" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps zero credits in usage and drops other balances", async () => {
    const http = sequence({ account: { st: "denied_quota", pl: "trial", inc: 100, rem: 0, u: 100 }, vin: { st: "ok", balance_kopecks: 9000 } });
    expect(await readUsage("k", http)).toEqual({ plan: "trial", status: "denied_quota", included_credits: 100, remaining_credits: 0, used_credits: 100 });
  });
});

describe("credit ledger (fapi_budget.py)", () => {
  it("normalises cache keys and keeps cache hits when the daily limit is reached", async () => {
    const http = sequence(account(), { candidates: [] });
    const { budget: gateway } = budget(http, { limit: 1 });
    expect((await findPart({ article: "W 75/3" }, gateway)).status).toBe("no_data");
    expect((await findPart({ article: "w753" }, gateway)).status).toBe("no_data");
    await expect(findPart({ article: "other123" }, gateway)).rejects.toMatchObject({ status: 429, code: "fapi_daily_limit" });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("keeps a paid answer for a month, across a re-issued key and a new billing period", async () => {
    const ledger = new MemoryLedger();
    let now = Date.parse("2026-11-21T00:00:00Z") / 1000;
    const paid = (remaining: number, start: string) => ({ account: { st: "allowed", pl: "pro", inc: 30_000, rem: remaining, u: 30_000 - remaining, ps: start, pe: "2026-12-31T00:00:00Z" } });
    const make = (http: RequestJson, key: string) => new FapiBudget(ledger, { dailyLimit: () => 1000, key: () => key, now: () => now, requestJson: http });
    const first = sequence(paid(29_000, "2026-11-01T00:00:00Z"), { candidates: [{ mfi: 7, ds: "Toyota", n: "04152-40060" }] });
    const original = await findPart({ article: "04152-40060" }, make(first, "old-key"));
    expect(first).toHaveBeenCalledTimes(2);
    now += 29 * 86_400;
    const later = sequence(paid(28_000, "2026-12-01T00:00:00Z"));
    expect(await findPart({ article: "0415240060" }, make(later, "new-key"))).toEqual({ ...original, article: "0415240060" });
    expect(later).toHaveBeenCalledTimes(1);
    now += 2 * 86_400;
    const expired = sequence(paid(28_000, "2026-12-01T00:00:00Z"), { candidates: [] });
    await findPart({ article: "04152-40060" }, make(expired, "new-key"));
    expect(expired).toHaveBeenCalledTimes(2);
  });

  it("blocks a lookup larger than the package remainder", async () => {
    const http = sequence(account(2));
    const { budget: gateway } = budget(http);
    await expect(searchVehicleParts({ query: "масляный фильтр Toyota Camry", confirmed: true }, { fapi: gateway, fapiFitmentEnabled: true, fitment: { variants: async () => new Map() } }))
      .rejects.toMatchObject({ status: 402, code: "fapi_package_limited" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("charges one credit for an empty catalogue step and refunds refused calls", async () => {
    const ledger = new MemoryLedger();
    const http = sequence(account(20), { mf: [{ dbi: 111, ds: "TOYOTA" }] }, { m: [] });
    const { budget: gateway } = budget(http, { ledger });
    const result = await searchVehicleParts({ query: "масляный фильтр Camry 2019", confirmed: true }, { fapi: gateway, fapiFitmentEnabled: true, fitment: { variants: async () => new Map() } });
    expect(result.status).toBe("need_vehicle");
    expect(ledger.totalDaily()).toBe(3 + 1);
    const refused = sequence(account(20), new UpstreamStatusError(402, {}));
    const second = budget(refused, { key: "other-fake" });
    await expect(findPart({ article: "LRc 0127" }, second.budget)).rejects.toMatchObject({ status: 402, code: "fapi_credits_unavailable" });
    expect(second.ledger.totalDaily()).toBe(0);
    expect(second.ledger.accounts.size).toBe(0);
  });

  it("gives back only its own credits when FAPI refuses a call while another call is being paid for", async () => {
    // The refund used to put back the figures read before the refused call reserved its credits, which wiped out
    // whatever another call had reserved in the meantime: the day's spending came out lower than it was.
    const ledger = new MemoryLedger();
    let refuse!: (error: Error) => void;
    const held = new Promise<JsonResponse>((_resolve, reject) => { refuse = reject; });
    const http = vi.fn<RequestJson>(async (url) => {
      if (url.includes("/usage")) return { data: account(), headers: {} } as JsonResponse;
      if (url.includes("n=HELD")) return held;
      return { data: { candidates: [{ mfi: 7, ds: "Brand", n: "PAID1" }] }, headers: {} } as JsonResponse;
    });
    const { budget: gateway } = budget(http, { ledger });
    const refused = gateway.fetch("/part", { n: "HELD" }, 1);
    // The held call has reserved its credit and is waiting for FAPI.
    while (http.mock.calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    await gateway.fetch("/part", { n: "PAID1" }, 1);
    refuse(new UpstreamStatusError(429, {}));
    await expect(refused).rejects.toMatchObject({ status: 429, code: "fapi_rate_limited" });
    expect(ledger.totalDaily()).toBe(1);
    expect([...ledger.packages.values()]).toEqual([99]);
  });

  it("needs a key and never stores it", async () => {
    const http = sequence();
    await expect(budget(http, { key: "" }).budget.fetch("/part", { n: "1" }, 1)).rejects.toMatchObject({ code: "fapi_key_missing" });
    const ledger = new MemoryLedger();
    await budget(sequence(account(), { candidates: [] }), { ledger, key: "secret-key-value" }).budget.fetch("/part", { n: "A1" }, 1);
    expect(JSON.stringify([...ledger.accounts.keys(), ...ledger.packages.keys(), ...ledger.daily.keys(), ...ledger.cache.keys()])).not.toContain("secret-key-value");
    expect(http).not.toHaveBeenCalled();
  });

  it("counts the day in Moscow time", () => {
    expect(moscowDay(Date.parse("2026-11-20T21:30:00Z") / 1000)).toBe("2026-11-21");
    expect(moscowDay(Date.parse("2026-11-20T20:30:00Z") / 1000)).toBe("2026-11-20");
  });
});

// One address must not be able to spend the whole day's credits of the site: each visitor has a share of the day.
// (GET /parts-finder/modifications alone is allowed 60 times a minute and costs 8 credits for a model not seen
// before — 480 credits a minute against a day's limit of 1 000.)
describe("one visitor's share of the day's credits", () => {
  it("refuses a visitor a paid call beyond the share, before FAPI is asked and before credits are reserved", async () => {
    const http = sequence(account(), card("A1"), card("A2"));
    const { budget: gateway, ledger, shares } = budget(http, { visitorLimit: 2 });
    const visitor = gateway.forVisitor(VISITOR);
    await visitor.fetch("/part", { n: "A1" }, 1);
    await visitor.fetch("/part", { n: "A2" }, 1);
    await expect(visitor.fetch("/part", { n: "A3" }, 1)).rejects.toMatchObject({ status: 429, code: "fapi_visitor_limit" });
    expect(http).toHaveBeenCalledTimes(3);
    expect(ledger.totalDaily()).toBe(2);
    expect(shares.of(VISITOR)).toBe(2);
  });

  it("counts each visitor's share separately", async () => {
    const http = sequence(account(), card("A1"), card("B1"));
    const { budget: gateway } = budget(http, { visitorLimit: 1 });
    await gateway.forVisitor(VISITOR).fetch("/part", { n: "A1" }, 1);
    await expect(gateway.forVisitor(VISITOR).fetch("/part", { n: "B1" }, 1)).rejects.toMatchObject({ code: "fapi_visitor_limit" });
    await expect(gateway.forVisitor(OTHER_VISITOR).fetch("/part", { n: "B1" }, 1)).resolves.toEqual(card("B1"));
  });

  it("does not hold the shop's own work to a visitor's share", async () => {
    const http = sequence(account(), card("S1"), card("S2"));
    const { budget: gateway, shares } = budget(http, { visitorLimit: 1 });
    await gateway.fetch("/part", { n: "S1" }, 1);
    await gateway.fetch("/part", { n: "S2" }, 1);
    expect(http).toHaveBeenCalledTimes(3);
    expect(shares.used.size).toBe(0);
  });

  it("answers a visitor whose share is spent from the cache, free of charge", async () => {
    const http = sequence(account(), card("A1"));
    const { budget: gateway, shares } = budget(http, { visitorLimit: 1 });
    const visitor = gateway.forVisitor(VISITOR);
    const paid = await visitor.fetch("/part", { n: "A1" }, 1);
    expect(await visitor.fetch("/part", { n: "a-1" }, 1)).toEqual(paid);
    expect(http).toHaveBeenCalledTimes(2);
    expect(shares.of(VISITOR)).toBe(1);
  });

  it("gives a visitor back all but one credit of a catalogue step that came back empty", async () => {
    const http = sequence(account(), { m: [] });
    const { budget: gateway, ledger, shares } = budget(http, { visitorLimit: 10 });
    await gateway.forVisitor(VISITOR).fetch("/catalogList/dt/modelList", { mfi: 111 }, 8);
    expect(shares.of(VISITOR)).toBe(1);
    expect(ledger.totalDaily()).toBe(1);
  });

  it("gives a visitor back the credits of a call FAPI refused", async () => {
    const http = sequence(account(), new UpstreamStatusError(429, {}));
    const { budget: gateway, shares } = budget(http, { visitorLimit: 10 });
    await expect(gateway.forVisitor(VISITOR).fetch("/part", { n: "A1" }, 1)).rejects.toMatchObject({ code: "fapi_rate_limited" });
    expect(shares.of(VISITOR)).toBe(0);
  });

  it("leaves a visitor's share alone when it is the site's day that is spent", async () => {
    const http = sequence(account(), card("A1"));
    const { budget: gateway, shares } = budget(http, { limit: 1, visitorLimit: 10 });
    const visitor = gateway.forVisitor(VISITOR);
    await visitor.fetch("/part", { n: "A1" }, 1);
    await expect(visitor.fetch("/part", { n: "A2" }, 1)).rejects.toMatchObject({ code: "fapi_daily_limit" });
    expect(shares.of(VISITOR)).toBe(1);
  });

  it("pays for nothing when the visitors' shares cannot be counted", async () => {
    const http = sequence(account());
    const shares = new MemoryShares();
    shares.failing = true;
    const { budget: gateway, ledger } = budget(http, { shares, visitorLimit: 10 });
    await expect(gateway.forVisitor(VISITOR).fetch("/part", { n: "A1" }, 1)).rejects.toMatchObject({ status: 503, code: "fapi_budget_unavailable" });
    expect(http).toHaveBeenCalledTimes(1);
    expect(ledger.totalDaily()).toBe(0);
  });

  it("does not pass one visitor's refusal on to another visitor who asked the same thing at the same moment", async () => {
    // Identical requests made together share one paid call. The share is each visitor's own, though.
    const http = sequence(account(), card("A1"), card("X9"));
    const { budget: gateway, shares } = budget(http, { visitorLimit: 1 });
    await gateway.forVisitor(VISITOR).fetch("/part", { n: "A1" }, 1);
    let release!: () => void;
    shares.hold = new Promise<void>((resolve) => { release = resolve; });
    const spent = gateway.forVisitor(VISITOR).fetch("/part", { n: "X9" }, 1);
    while (shares.waiting < 1) await new Promise((resolve) => setTimeout(resolve, 0));
    const other = gateway.forVisitor(OTHER_VISITOR).fetch("/part", { n: "X9" }, 1);
    const outcomes = Promise.allSettled([spent, other]);
    release();
    const [first, second] = await outcomes;
    expect(first).toMatchObject({ reason: { code: "fapi_visitor_limit" }, status: "rejected" });
    expect(second).toEqual({ status: "fulfilled", value: card("X9") });
    expect(shares.of(OTHER_VISITOR)).toBe(1);
  });

  it("gives the share back when the credits could not be reserved after all", async () => {
    class FailingLedger extends MemoryLedger {
      override async transaction<T>(work: (tx: FapiLedgerTx) => Promise<T>): Promise<T> {
        return super.transaction((tx) => work({ ...tx, setPackage: async () => { throw new Error("the database is down"); } }));
      }
    }
    const { budget: gateway, shares } = budget(sequence(account()), { ledger: new FailingLedger(), visitorLimit: 10 });
    await expect(gateway.forVisitor(VISITOR).fetch("/part", { n: "A1" }, 1)).rejects.toMatchObject({ status: 503, code: "fapi_budget_unavailable" });
    expect(shares.of(VISITOR)).toBe(0);
  });
});
