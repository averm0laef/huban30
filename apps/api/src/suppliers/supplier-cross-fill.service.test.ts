import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { SupplierCrossPair } from "@an30/contracts";

import type { SupplierLane, SupplierPart, SupplierProvider, SupplierSearchResult, SupplierUsage } from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { RedisService } from "../infrastructure/redis.service.js";
import type { AuditService } from "../security/audit.service.js";
import { isCrossFillHour, SupplierCrossFillService } from "./supplier-cross-fill.service.js";
import type { SupplierCrossQueueService } from "./supplier-cross-queue.service.js";

interface Product { brand: string; brand_id: string; id: string; sku: string; sku_normalized: string }

function product(id: string, sku: string, brand = "MANN"): Product {
  return { brand, brand_id: `brand-${brand}`, id, sku, sku_normalized: sku.replace(/[^A-Z0-9]/giu, "").toUpperCase() };
}

function part(brand: string, partNumber: string, crosses: SupplierPart[] = []): SupplierPart {
  return { brand, crosses, guid: `${brand}-${partNumber}`, name: "Деталь", partNumber, stocks: [] };
}

const FOUND: SupplierSearchResult = { message: "", parts: [part("MANN", "W914/2", [part("BOSCH", "0451103318")])], success: true };
const UNAVAILABLE: SupplierSearchResult = { message: "Поставщик временно недоступен", parts: [], success: false };

/** Records what the service wrote; answers the candidate query with the products not yet recorded or attempted. */
function makeDatabase(products: Product[], switchedOn = true) {
  const setting = { enabled: switchedOn };
  const recorded: { note: string | null; pairs: number; skuNormalized: string; status: string }[] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes("FROM app.brand_identities")) return { rows: [] };
    if (text.includes("INSERT INTO app.site_settings")) {
      const enabled = (JSON.parse(values[1] as string) as { enabled: boolean }).enabled;
      // The statement writes, and returns the key, only when the value differs from the stored one.
      const changed = text.includes("IS DISTINCT FROM") ? setting.enabled !== enabled : true;
      setting.enabled = enabled;
      return { rows: changed ? [{ key: values[0] }] : [] };
    }
    if (text.includes("FROM app.site_settings")) return { rows: [{ value: { enabled: setting.enabled } }] };
    if (text.includes("INSERT INTO app.supplier_cross_lookups")) {
      recorded.push({ note: values[4] as string | null, pairs: values[3] as number, skuNormalized: values[0] as string, status: values[2] as string });
      return { rows: [] };
    }
    if (text.includes("LEFT JOIN app.supplier_cross_lookups")) {
      const attempted = values[2] as string[];
      const done = new Set(recorded.map((row) => row.skuNormalized));
      return { rows: products.filter((item) => !attempted.includes(item.id) && !done.has(item.sku_normalized)).slice(0, values[3] as number) };
    }
    throw new Error(`unexpected query: ${text.slice(0, 60)}`);
  });
  return { database: { query } as unknown as DatabaseService, query, recorded, setting };
}

function makeSupplier(options: { answers?: (query: string) => SupplierSearchResult; backgroundLimit?: number; enabled?: boolean } = {}) {
  const calls: { lane: SupplierLane | undefined; query: string }[] = [];
  const state = { backgroundUsed: 0 };
  const backgroundLimit = options.backgroundLimit ?? 100;
  const provider: SupplierProvider = {
    enabled: options.enabled ?? true,
    search: async (query, lane) => {
      calls.push({ lane, query });
      state.backgroundUsed += 1;
      return (options.answers ?? (() => FOUND))(query);
    },
    usage: async (): Promise<SupplierUsage> => ({
      backgroundLimit, backgroundUsed: state.backgroundUsed, dailyLimit: 90_000, day: "2026-11-23", used: state.backgroundUsed,
    }),
  };
  return { calls, provider, state };
}

function makeQueue(accept = true) {
  const queued: SupplierCrossPair[][] = [];
  const queue = {
    enqueueAndWait: vi.fn(async (pairs: readonly SupplierCrossPair[]) => {
      if (!accept) throw new Error("queue down");
      queued.push([...pairs]);
      return pairs.length;
    }),
  } as unknown as SupplierCrossQueueService;
  return { queue, queued };
}

function makeRedis(lockHeldElsewhere = false) {
  const store = new Map<string, string>();
  if (lockHeldElsewhere) store.set("an30:rossko:cross-fill:lock", "another-process");
  return {
    client: {
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, ...flags: unknown[]) => {
        if (flags.includes("NX") && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
    },
    ensureConnected: vi.fn(async () => undefined),
  } as unknown as RedisService;
}

// 02:00 in Chita (UTC+9): inside the night hours the filling is allowed to work in.
const NIGHT = new Date("2026-11-23T17:00:00Z");
// 13:00 in Chita: customers are on the site.
const DAY = new Date("2026-11-23T04:00:00Z");

function makeAudit() {
  const records: { action: string; afterState: unknown }[] = [];
  const audit = { record: vi.fn(async (entry: { action: string; afterState: unknown }) => { records.push(entry); }) } as unknown as AuditService;
  return { audit, records };
}

function makeService(parts: {
  audit?: AuditService; database: DatabaseService; now?: () => Date; provider: SupplierProvider; queue: SupplierCrossQueueService; redis?: RedisService;
}) {
  const service = new SupplierCrossFillService(parts.database, parts.provider, parts.queue, parts.redis ?? makeRedis(), parts.audit ?? makeAudit().audit);
  service.pauseMs = 0;
  service.now = parts.now ?? (() => NIGHT);
  return service;
}

describe("SupplierCrossFillService", () => {
  it("asks the supplier about each of our numbers once, as the shop's own background work, and queues the analogs", async () => {
    const { database, recorded } = makeDatabase([product("p1", "W914/2")]);
    const supplier = makeSupplier();
    const { queue, queued } = makeQueue();

    const report = await makeService({ database, provider: supplier.provider, queue }).run();

    expect(supplier.calls).toEqual([{ lane: "background", query: "W914/2" }]);
    expect(queued).toEqual([[{ partA: { article: "W914/2", brand: "MANN" }, partB: { article: "0451103318", brand: "BOSCH" } }]]);
    expect(recorded).toEqual([{ note: null, pairs: 1, skuNormalized: "W9142", status: "found" }]);
    expect(report).toMatchObject({ error: null, found: 1, lookups: 1, pairsQueued: 1, stopped: "done" });
  });

  it("asks once for two cards of ours with the same number and brand", async () => {
    const { database, recorded } = makeDatabase([product("p1", "W914/2"), product("p2", "W 914-2"), product("p3", "W914/2", "FILTRON")]);
    const supplier = makeSupplier({ answers: (query) => (query === "W914/2" ? FOUND : { message: "", parts: [], success: true }) });
    const { queue } = makeQueue();

    const report = await makeService({ database, provider: supplier.provider, queue }).run();

    // The same number under another brand is a different part and is asked separately.
    expect(supplier.calls.map((call) => call.query)).toEqual(["W914/2", "W914/2"]);
    expect(recorded.map((row) => row.status)).toEqual(["found", "brand_mismatch"]);
    expect(report).toMatchObject({ lookups: 2, stopped: "done" });
  });

  it("remembers which number and brand were asked, so a card changed by 1С is asked again", async () => {
    const { database, query } = makeDatabase([product("p1", "W914/2")]);
    const supplier = makeSupplier();
    const { queue } = makeQueue();

    await makeService({ database, provider: supplier.provider, queue }).run();

    const texts = query.mock.calls.map(([text]) => text.replace(/\s+/gu, " "));
    const written = texts.find((text) => text.includes("INSERT INTO app.supplier_cross_lookups"));
    expect(written).toContain("(product_id,sku_normalized,brand_id,status,pairs,note)");
    expect(written).toContain("sku_normalized=EXCLUDED.sku_normalized,brand_id=EXCLUDED.brand_id");
    const selected = texts.find((text) => text.includes("LEFT JOIN app.supplier_cross_lookups"));
    expect(selected).toContain("lookup.product_id=product.id AND lookup.sku_normalized=product.sku_normalized AND lookup.brand_id=product.brand_id");
  });

  it("remembers a number the supplier does not know, so it is not asked again", async () => {
    const { database, recorded } = makeDatabase([product("p1", "ZZ9000")]);
    const supplier = makeSupplier({ answers: () => ({ message: "", parts: [], success: true }) });
    const { queue, queued } = makeQueue();

    const report = await makeService({ database, provider: supplier.provider, queue }).run();

    expect(recorded).toEqual([{ note: null, pairs: 0, skuNormalized: "ZZ9000", status: "not_found" }]);
    expect(queued).toEqual([]);
    expect(report).toMatchObject({ lookups: 1, notFound: 1 });
  });

  it("stores nothing against our product when the number belongs to other brands", async () => {
    const { database, recorded } = makeDatabase([product("p1", "W914/2", "FRAM")]);
    const supplier = makeSupplier();
    const { queue, queued } = makeQueue();

    const report = await makeService({ database, provider: supplier.provider, queue }).run();

    expect(queued).toEqual([]);
    expect(recorded).toEqual([{ note: "MANN", pairs: 0, skuNormalized: "W9142", status: "brand_mismatch" }]);
    expect(report.brandMismatch).toBe(1);
  });

  it("stops at the day's background share without another supplier call", async () => {
    const { database, recorded } = makeDatabase([product("p1", "A1000"), product("p2", "A2000"), product("p3", "A3000")]);
    const supplier = makeSupplier({ answers: () => ({ message: "", parts: [], success: true }), backgroundLimit: 2 });

    const report = await makeService({ database, provider: supplier.provider, queue: makeQueue().queue }).run();

    expect(supplier.calls.map((call) => call.query)).toEqual(["A1000", "A2000"]);
    expect(recorded).toHaveLength(2);
    expect(report.stopped).toBe("daily_limit");
  });

  it("leaves a product for a later run when the supplier did not answer, and stops after three failures in a row", async () => {
    const { database, recorded } = makeDatabase(["A1000", "A2000", "A3000", "A4000", "A5000"].map((sku, index) => product(`p${index}`, sku)));
    const supplier = makeSupplier({ answers: () => UNAVAILABLE });

    const report = await makeService({ database, provider: supplier.provider, queue: makeQueue().queue }).run();

    expect(supplier.calls).toHaveLength(3);
    expect(recorded).toEqual([]);
    expect(report).toMatchObject({ error: "Поставщик не отвечает. Наполнение продолжится позже.", stopped: "supplier_unavailable" });
  });

  it("does not mark a number as looked up when its analogs could not be queued", async () => {
    const { database, recorded } = makeDatabase([product("p1", "W914/2"), product("p2", "W712/75")]);
    const supplier = makeSupplier();

    const report = await makeService({ database, provider: supplier.provider, queue: makeQueue(false).queue }).run();

    expect(recorded).toEqual([]);
    expect(supplier.calls).toHaveLength(1);
    expect(report.stopped).toBe("queue_unavailable");
  });

  it("stops when the shop's own per-minute limit is reached", async () => {
    const { database, recorded } = makeDatabase([product("p1", "A1000"), product("p2", "A2000")]);
    const supplier = makeSupplier();
    supplier.provider.search = async () => { throw new HttpException("Слишком много попыток. Повторите позже.", 429); };

    const report = await makeService({ database, provider: supplier.provider, queue: makeQueue().queue }).run();

    expect(recorded).toEqual([]);
    expect(report.stopped).toBe("rate_limit");
  });

  it("does not start while the supplier is off", async () => {
    const supplier = makeSupplier({ enabled: false });
    const service = makeService({ database: makeDatabase([product("p1", "A1000")]).database, provider: supplier.provider, queue: makeQueue().queue });

    expect(await service.start()).toEqual({ reason: "supplier_disabled", started: false });
    expect(supplier.calls).toEqual([]);
  });

  it("does not start when no background share is configured", async () => {
    const supplier = makeSupplier({ backgroundLimit: 0 });
    const service = makeService({ database: makeDatabase([product("p1", "A1000")]).database, provider: supplier.provider, queue: makeQueue().queue });

    expect(await service.start()).toEqual({ reason: "daily_limit", started: false });
    expect(supplier.calls).toEqual([]);
  });

  it("does not start a second run while another API process holds the lock", async () => {
    const supplier = makeSupplier();
    const service = makeService({
      database: makeDatabase([product("p1", "A1000")]).database, provider: supplier.provider, queue: makeQueue().queue, redis: makeRedis(true),
    });

    expect(await service.start()).toEqual({ reason: "already_running", started: false });
    expect(supplier.calls).toEqual([]);
  });

  it("runs in the background once started and reports the finished run", async () => {
    const { database, recorded } = makeDatabase([product("p1", "W914/2")]);
    const supplier = makeSupplier();
    const service = makeService({ database, provider: supplier.provider, queue: makeQueue().queue });

    expect(await service.start()).toEqual({ started: true });
    await service.idle();

    expect(recorded).toHaveLength(1);
    expect(service.lastRun).toMatchObject({ found: 1, lookups: 1, stopped: "done" });
  });

  it("stays off until a member of staff switches it on", async () => {
    const supplier = makeSupplier();
    const service = makeService({ database: makeDatabase([product("p1", "A1000")], false).database, provider: supplier.provider, queue: makeQueue().queue });

    expect(await service.start()).toEqual({ reason: "switched_off", started: false });
    expect(supplier.calls).toEqual([]);
  });

  it("works only at night in Chita, when customers are not searching", async () => {
    const supplier = makeSupplier();
    const service = makeService({
      database: makeDatabase([product("p1", "A1000")]).database, now: () => DAY, provider: supplier.provider, queue: makeQueue().queue,
    });

    expect(await service.start()).toEqual({ reason: "outside_hours", started: false });
    expect(supplier.calls).toEqual([]);
  });

  it("stops in the morning and leaves the rest for the next night", async () => {
    const { database, recorded } = makeDatabase([product("p1", "A1000"), product("p2", "A2000"), product("p3", "A3000")]);
    const supplier = makeSupplier({ answers: () => ({ message: "", parts: [], success: true }) });
    const service = makeService({ database, now: () => (supplier.calls.length < 2 ? NIGHT : DAY), provider: supplier.provider, queue: makeQueue().queue });

    const report = await service.run();

    expect(supplier.calls).toHaveLength(2);
    expect(recorded).toHaveLength(2);
    expect(report.stopped).toBe("outside_hours");
  });

  it("stops as soon as staff switch it off, in the middle of a run", async () => {
    const { database, recorded, setting } = makeDatabase([product("p1", "A1000"), product("p2", "A2000"), product("p3", "A3000")]);
    const supplier = makeSupplier({
      answers: () => {
        if (supplier.calls.length === 2) setting.enabled = false;
        return { message: "", parts: [], success: true };
      },
    });
    const service = makeService({ database, provider: supplier.provider, queue: makeQueue().queue });

    const report = await service.run();

    expect(supplier.calls).toHaveLength(2);
    expect(recorded).toHaveLength(2);
    expect(report.stopped).toBe("switched_off");
  });

  it.each([
    ["2026-11-23T13:59:00Z", false], // 22:59 in Chita
    ["2026-11-23T14:00:00Z", true], // 23:00
    ["2026-11-23T21:59:00Z", true], // 06:59
    ["2026-11-23T22:00:00Z", false], // 07:00
  ])("night hours in Chita: %s -> %s", (at, expected) => {
    expect(isCrossFillHour(new Date(at))).toBe(expected);
  });

  it("writes one audit record when the same switch arrives twice (a double click)", async () => {
    const { database, setting } = makeDatabase([], false);
    const { audit, records } = makeAudit();
    const service = makeService({ audit, database, provider: makeSupplier().provider, queue: makeQueue().queue });
    const actor = { userId: "user-1" } as AuthContext;

    expect(await service.setEnabled(true, actor, {})).toEqual({ switchedOn: true });
    expect(await service.setEnabled(true, actor, {})).toEqual({ switchedOn: true });

    expect(setting.enabled).toBe(true);
    expect(records.map((entry) => entry.afterState)).toEqual([{ enabled: true }]);
  });

  it("is switched on and off by staff, and the change is written to the audit log", async () => {
    const { database, setting } = makeDatabase([], false);
    const { audit, records } = makeAudit();
    const service = makeService({ audit, database, provider: makeSupplier().provider, queue: makeQueue().queue });
    const actor = { userId: "user-1" } as AuthContext;

    await service.setEnabled(true, actor, {});
    expect(setting.enabled).toBe(true);
    await service.setEnabled(false, actor, {});
    expect(setting.enabled).toBe(false);

    expect(records.map((entry) => [entry.action, entry.afterState])).toEqual([
      ["supplier.cross_fill.switch", { enabled: true }],
      ["supplier.cross_fill.switch", { enabled: false }],
    ]);
  });
});
