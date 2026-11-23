import { describe, expect, it, vi } from "vitest";

import { normalizeBrand, type SupplierSearchResponse } from "@an30/contracts";

import type { SupplierProvider } from "../adapters/provider-contracts.js";
import type { CatalogSearchLogService } from "../catalog/catalog-search-log.service.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { RedisService } from "../infrastructure/redis.service.js";
import type { SupplierSearchService } from "../suppliers/supplier-search.service.js";
import { PartsFinderError } from "./engine/errors.js";
import type { PartsFinderEngine } from "./parts-finder.engine.js";
import type { PartsFinderCrossStore } from "./parts-finder-crosses.store.js";
import { PartsFinderShopService, SHOP_OFFERS_SQL } from "./parts-finder-shop.service.js";
import type { PartsFinderVehiclesService, SelectedVehicle } from "./parts-finder-vehicles.service.js";
import { PartsFinderService, looksLikeVehicleId, rankByShop } from "./parts-finder.service.js";

interface Row {
  available_quantity: string; brand_name: string | null; name: string; price_kopeks: string | null; product_id: string;
  req_article: string; req_brand: string; sku: string; slug: string; via: number;
  offered_root?: string | null;
}

function row(reqArticle: string, reqBrand: string, productId: string, extra: Partial<Row> = {}): Row {
  return {
    available_quantity: "2", brand_name: "Toyota", name: `Товар ${productId}`, price_kopeks: "89000", product_id: productId,
    req_article: reqArticle, req_brand: reqBrand, sku: reqArticle, slug: `tovar-${productId}`, via: 0, ...extra,
  };
}

/** The rows as SHOP_OFFERS_SQL returns them: tied to the request's index, with the sides sameNumberIsSamePart reads. */
function asSqlRows(rows: Row[], values: unknown[]) {
  const requests = JSON.parse(String(values[0] ?? "[]")) as Array<{ article: string; brand: string; idx: number }>;
  return rows.flatMap(({ req_article, req_brand, ...rest }) => requests
    .filter((request) => request.article === req_article && request.brand === req_brand)
    .map((request) => ({
      asked_brand: req_brand || null, asked_known: false, asked_name: null, asked_root: null,
      offered_brand: rest.brand_name ? normalizeBrand(rest.brand_name) : null, offered_root: null, req_idx: request.idx, ...rest,
    })));
}

const PROBOX = {
  engine: "1.3 л · бензин · 1NR-FE · NSP160V",
  parts: [
    { article: "90915-10003", brand: "Toyota", source: "Toyota EPC" },
    { article: "04152-40060", brand: "Toyota", source: "DENSO" },
    { article: "90915-10009", brand: "Toyota", source: "Toyota EPC" },
  ],
  status: "reference",
  vehicle: "Toyota Probox",
};

const SUPPLIER: SupplierSearchResponse = {
  message: "OK",
  parts: [{
    availability: "under_order", brand: "Toyota", crosses: [], guid: "g1", name: "Фильтр масляный",
    partNumber: "04152-40060", stocks: [{ deliveryTime: "2", id: "s1", priceKopeks: 116_000, quantity: 7 }],
  }],
  query: "04152-40060",
  success: true,
  totalFound: 1,
  truncated: false,
};

const VOCABULARY = { makes: new Map<string, string>(), models: new Map<string, string>(), phonetic: new Map<string, string>() };

function setup(options: {
  enabled?: boolean;
  engine?: Partial<Record<"crosses" | "search" | "usage" | "vehicle", (...args: never[]) => Promise<unknown>>>;
  remembered?: number;
  rememberedPairs?: number;
  rows?: Row[] | Row[][];
  selected?: SelectedVehicle;
  supplier?: SupplierSearchResponse | Error;
  supplierEnabled?: boolean;
} = {}) {
  const pages = Array.isArray(options.rows?.[0]) ? [...options.rows as Row[][]] : null;
  // Only the batched lookup reads the rows of a test; any other query of the shop (the card's own name) finds nothing.
  const query = vi.fn(async (sql: string, values: unknown[]) => ({
    rows: sql === SHOP_OFFERS_SQL ? asSqlRows(pages ? pages.shift() ?? [] : (options.rows as Row[] | undefined) ?? [], values) : [],
  }));
  const engine = {
    crosses: vi.fn(options.engine?.crosses ?? (async () => ({}))),
    dailyLimit: 1000,
    visitorDailyLimit: 100,
    enabled: options.enabled ?? true,
    fapiFitmentEnabled: false,
    fapiKey: "set",
    ledger: { summary: vi.fn(async () => ({ cacheHits: 4, cachedEntries: 2, checkedAt: "2026-11-21T08:00:00.000Z", reservedToday: 7, usage: { plan: "standard", remaining_credits: 29_000, status: "allowed" } })) },
    search: vi.fn(options.engine?.search ?? (async () => ({ status: "need_detail" }))),
    today: () => "2026-11-21",
    usage: vi.fn(options.engine?.usage ?? (async () => ({ status: "allowed" }))),
    vehicle: vi.fn(options.engine?.vehicle ?? (async () => ({ status: "decoded" }))),
    vehicles: { summary: vi.fn(async () => ({ entries: 3, hits: 9, vinrokuRemaining: 97 })) },
  };
  const vehicles = { selected: vi.fn(async () => options.selected!), vocabulary: vi.fn(async () => VOCABULARY) };
  const suppliers = {
    search: vi.fn(async () => {
      if (options.supplier instanceof Error) throw options.supplier;
      return options.supplier ?? SUPPLIER;
    }),
  };
  const redisStore = new Map<string, string>();
  const redis = {
    client: {
      expire: async () => 1,
      get: async (key: string) => redisStore.get(key) ?? null,
      incrby: async (key: string, by: number) => { const next = Number(redisStore.get(key) ?? 0) + by; redisStore.set(key, String(next)); return next; },
      set: async (key: string, value: string) => { redisStore.set(key, value); return "OK"; },
    },
    ensureConnected: async () => undefined,
  };
  const log = { record: vi.fn() };
  const crossStore = { remember: vi.fn(async () => options.remembered ?? 0), rememberPairs: vi.fn(async () => options.rememberedPairs ?? 0) };
  const service = new PartsFinderService(
    engine as unknown as PartsFinderEngine,
    new PartsFinderShopService({ query } as unknown as DatabaseService),
    vehicles as unknown as PartsFinderVehiclesService,
    suppliers as unknown as SupplierSearchService,
    { enabled: options.supplierEnabled ?? true } as SupplierProvider,
    redis as unknown as RedisService,
    log as unknown as CatalogSearchLogService,
    crossStore as unknown as PartsFinderCrossStore,
  );
  return { crossStore, engine, log, query, redisStore, service, suppliers, vehicles };
}

describe("search", () => {
  it("forwards only query, confirmed and choices and ranks parts sold in stock first in one SQL query", async () => {
    const rows = [row("0415240060", "TOYOTA", "p-exact"), row("9091510009", "TOYOTA", "p-out", { available_quantity: "0" })];
    const { engine, query, service } = setup({ engine: { search: async () => PROBOX }, rows });
    const result = await service.search({ catalog: "autodoc", choices: { engine: 1 }, query: " масляный фильтр пробокс " });
    expect(engine.search).toHaveBeenCalledWith({ choices: { engine: 1 }, query: "масляный фильтр пробокс" }, VOCABULARY, { payer: null });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toBe(SHOP_OFFERS_SQL);
    expect((result.parts as Array<{ article: string }>).map((part) => part.article)).toEqual(["04152-40060", "90915-10009", "90915-10003"]);
    expect((result.parts as Array<{ shop: unknown[] }>)[0]!.shop).toEqual([expect.objectContaining({ matchedVia: "exact", productId: "p-exact" })]);
  });

  it("turns a picked car into the query words and already-confirmed FAPI steps", async () => {
    const selected: SelectedVehicle = {
      capacity: "1.3", engine: "1NR-FE", fapiMakeId: 111, fapiModelId: 123, fapiModificationId: 456,
      label: "Toyota · Probox · 1.3 1NR-FE", make: "Toyota", model: "Probox",
    };
    const { engine, service } = setup({ engine: { search: async () => PROBOX }, selected });
    const result = await service.search({ query: "масляный фильтр", vehicle: { modificationId: 9 } });
    expect(engine.search).toHaveBeenCalledWith({
      choices: { make: 111, model: 123, modification: 456 },
      confirmed: true,
      query: "масляный фильтр Toyota Probox 1NR-FE 1.3 л",
    }, VOCABULARY, { payer: null });
    expect(result.selected_vehicle).toBe("Toyota · Probox · 1.3 1NR-FE");
  });

  it("links fitting articles we do not stock to our catalog through their FAPI crosses", async () => {
    const found = { status: "found", vehicle: "TOYOTA GAIA", parts: [
      { article: "23300-74060", brand: "TOYOTA", manufacturer_id: 111 },
      { article: "LIFE", brand: "KNECHT" },
      { article: "FS-1001", brand: "JS ASAKASHI", manufacturer_id: 222 },
    ] };
    const card = { part: { article: "23300-74060", brand: "TOYOTA" }, groups: { analogs: [{ article: "WK 614/10", brand: "MANN-FILTER" }] } };
    const { crossStore, engine, query, service } = setup({
      engine: { crosses: async () => card, search: async () => found },
      remembered: 1,
      rows: [[], [row("2330074060", "TOYOTA", "p-cross", { via: 1, sku: "WK614/10" })]],
    });
    const result = await service.search({ query: "топливный фильтр Toyota Gaia" });
    expect(engine.crosses.mock.calls).toEqual([[{ article: "23300-74060", manufacturer_id: 111 }, null], [{ article: "FS-1001", manufacturer_id: 222 }, null]]);
    expect(crossStore.remember).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(2);
    expect((result.parts as Array<{ shop: unknown[] }>)[0]!.shop).toEqual([expect.objectContaining({ matchedVia: "cross", productId: "p-cross" })]);
  });

  it("does not spend FAPI credits when we already stock a fitting article", async () => {
    const { engine, service } = setup({ engine: { search: async () => PROBOX }, rows: [row("0415240060", "TOYOTA", "p-exact")] });
    await service.search({ query: "масляный фильтр пробокс" });
    expect(engine.crosses).not.toHaveBeenCalled();
  });

  it("rejects bad input before any work", async () => {
    const { engine, service } = setup();
    for (const body of [undefined, { query: "" }, { query: "x".repeat(141) }, { query: "a", vehicle: {} }]) {
      await expect(service.search(body)).rejects.toMatchObject({ response: { code: "parts_finder_invalid_request" }, status: 400 });
    }
    expect(engine.search).not.toHaveBeenCalled();
  });
});

describe("error mapping", () => {
  it.each([
    [new PartsFinderError(400, "invalid_catalog_choice", "Обновите поиск."), 400, "invalid_catalog_choice"],
    [new PartsFinderError(402, "fapi_package_limited", "Остатка мало."), 402, "fapi_package_limited"],
    [new PartsFinderError(429, "fapi_daily_limit", "Лимит."), 429, "fapi_daily_limit"],
    [new PartsFinderError(401, "fapi_key_expired", "Ключ."), 503, "parts_finder_unavailable"],
    [new PartsFinderError(503, "fapi_key_missing", "Нет ключа."), 503, "parts_finder_unavailable"],
    [new Error("boom"), 503, "parts_finder_unavailable"],
  ])("%s -> %i %s", async (error, status, code) => {
    const { service } = setup({ engine: { crosses: async () => { throw error; } } });
    await expect(service.crosses({ article: "W 75/3" })).rejects.toMatchObject({ response: { code }, status });
  });

  it("never shows the customer credits or keys: a FAPI outage falls back to our own data", async () => {
    const offline = { category: "Топливный фильтр", message: "Для этой машины пока нет данных в местном справочнике.", status: "no_data", vehicle: "Toyota Gaia" };
    const search = vi.fn(async (_form: unknown, _vocabulary: unknown, options?: { offline?: boolean }) => {
      if (!options?.offline) throw new PartsFinderError(402, "fapi_package_limited", "Остатка кредитов пакета FAPI для запроса недостаточно.");
      return offline;
    });
    const { service } = setup({ engine: { search: search as never } });
    const result = await service.search({ confirmed: true, query: "топливный фильтр гайя" });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ category: "Топливный фильтр", status: "no_data", vehicle: "Toyota Gaia" });
    expect(JSON.stringify(result)).not.toMatch(/FAPI|кредит/iu);
    const cards = setup({ engine: { crosses: async () => { throw new PartsFinderError(429, "fapi_daily_limit", "Дневной лимит новых запросов FAPI исчерпан."); } } });
    await expect(cards.service.crosses({ article: "W 75/3" })).rejects.toSatisfy((error: { getResponse(): { error: string } }) => !/FAPI|кредит|лимит/iu.test(error.getResponse().error));
  });

  it("still reports a wrong step choice to the customer instead of hiding it", async () => {
    const { service } = setup({ engine: { search: async () => { throw new PartsFinderError(400, "invalid_catalog_choice", "Обновите поиск."); } } });
    await expect(service.search({ query: "фильтр гайя" })).rejects.toMatchObject({ response: { code: "invalid_catalog_choice", error: "Обновите поиск." }, status: 400 });
  });

  it("answers parts_finder_disabled when switched off, while shop analogs keep working", async () => {
    const { engine, service } = setup({ enabled: false, rows: [row("0415240060", "TOYOTA", "p1")] });
    expect(service.status()).toEqual({ catalog: "umapi", enabled: false });
    await expect(service.search({ query: "фильтр" })).rejects.toMatchObject({ response: { code: "parts_finder_disabled" }, status: 503 });
    expect(engine.search).not.toHaveBeenCalled();
    expect((await service.shopAnalogs({ article: "04152-40060", brand: "Toyota" })).offers).toHaveLength(1);
  });
});

describe("crosses", () => {
  it("adds shop offers to every part of a FAPI card and ranks each group", async () => {
    const card = {
      article: "W 75/3", status: "found", part: { article: "W 75/3", brand: "MANN-FILTER", manufacturer_id: 7 },
      groups: { analogs: [{ article: "AB100", brand: "Other", manufacturer_id: 9 }, { article: "OC 90", brand: "Mahle", manufacturer_id: 11 }] },
    };
    const { query, service } = setup({ engine: { crosses: async () => card }, rows: [row("OC90", "MAHLE", "p-mahle", { brand_name: "Mahle" })] });
    const result = await service.crosses({ article: "W 75/3" });
    expect(query).toHaveBeenCalledTimes(1);
    expect((result.groups as Record<string, Array<{ article: string }>>).analogs!.map((item) => item.article)).toEqual(["OC 90", "AB100"]);
    expect(result.part).toMatchObject({ shop: [] });
  });
});

describe("shop analogs", () => {
  it("asks about the product of the card, and about the kind of part a catalogue's row names", async () => {
    const { query, service } = setup({ rows: [] });
    const productId = "7a1c3c2e-6f0d-4c3a-9d1b-0f2b8f7e6a11";
    await service.shopAnalogs({ article: "3930", brand: "OSRAM", productId });
    expect(JSON.parse(String(query.mock.calls[0]![1][0]))).toEqual([{ article: "3930", brand: "OSRAM", idx: 0, product_id: productId }]);
    const card = {
      article: "W 75/3", status: "found", part: { article: "W 75/3", brand: "MANN-FILTER", description: "Фильтр масляный", manufacturer_id: 7 },
      groups: { analogs: [{ article: "OC 90", brand: "Mahle", description: "Фильтр масляный", manufacturer_id: 11 }] },
    };
    // Our filter carries the number but 1С names no maker: the catalogue's description says it is the same kind of part.
    const unbranded = row("OC90", "MAHLE", "p-unbranded", { brand_name: null, name: "Фильтр масляный OC 90", offered_root: "filtry" });
    const second = setup({ engine: { crosses: async () => card }, rows: [unbranded] });
    const result = await second.service.crosses({ article: "W 75/3" });
    expect((result.groups as Record<string, Array<{ shop: unknown[] }>>).analogs![0]!.shop).toHaveLength(1);
    expect(second.query).toHaveBeenCalledTimes(1);
  });
});

describe("shop analogs of a product card", () => {
  it("adds parts of the same standard size, without the ones already offered", async () => {
    const { service } = setup({ rows: [row("3930", "OSRAM", "p-twin", { brand_name: "OSRAM" })] });
    const productId = "7a1c3c2e-6f0d-4c3a-9d1b-0f2b8f7e6a11";
    const shop = (service as unknown as { shop: PartsFinderShopService }).shop;
    const sameSize = vi.spyOn(shop, "sameSize").mockResolvedValue({
      label: "T4W 24 В BA9s",
      offers: [
        { availableQuantity: 1, basis: "same_size", brand: "OSRAM", matchedVia: "same_size", name: "Товар p-twin", priceKopeks: 100, productId: "p-twin", sku: "3930", slug: "s" },
        { availableQuantity: 2, basis: "same_size", brand: "NARVA", matchedVia: "same_size", name: "Лампа", priceKopeks: 100, productId: "p-narva", sku: "17131", slug: "n" },
      ],
    });
    const answer = await service.shopAnalogs({ article: "3930", brand: "OSRAM", productId });
    expect(sameSize).toHaveBeenCalledWith(productId, expect.any(Number));
    expect(answer.sameSize).toEqual({ label: "T4W 24 В BA9s", offers: [expect.objectContaining({ productId: "p-narva" })] });
    await service.shopAnalogs({ article: "3930", brand: "OSRAM" });
    expect(sameSize).toHaveBeenCalledTimes(1);
  });
});

describe("resolve (header search)", () => {
  it("decodes a VIN or chassis number", async () => {
    const { engine, log, service } = setup({ engine: { vehicle: async () => ({ status: "decoded", vehicle: { make: "LADA", model: "Vesta" } }) } });
    expect(await service.resolve({ query: "XTAGFK330JY144213" })).toEqual({
      kind: "vin", query: "XTAGFK330JY144213", vehicle: { status: "decoded", vehicle: { make: "LADA", model: "Vesta" } },
    });
    await service.resolve({ query: "mxph14-0036630" });
    expect(engine.vehicle).toHaveBeenLastCalledWith("MXPH14-0036630");
    expect(engine.search).not.toHaveBeenCalled();
    expect(log.record).toHaveBeenCalledWith({ q: "XTAGFK330JY144213" }, 1);
  });

  it("keeps the VIN kind with a message when decoding fails", async () => {
    const { service } = setup({ engine: { vehicle: async () => { throw new PartsFinderError(503, "vpic_unavailable", "База vPIC сейчас недоступна."); } } });
    expect(await service.resolve({ query: "1HGCM82633A004352" })).toMatchObject({ kind: "vin", vehicle: null, error: expect.stringContaining("временно недоступен") });
  });

  it("answers an article with our offers first and supplier offers after, never naming the distributor", async () => {
    const rows = [row("0415240060", "", "p-exact"), row("0415240060", "", "p-cross", { brand_name: "TESTBRAND", sku: "TB-0001", via: 1 })];
    const { log, service, suppliers } = setup({ engine: { search: async () => ({ article: "04152-40060", status: "article" }) }, rows });
    const result = await service.resolve({ query: "04152-40060" });
    expect(result.kind).toBe("article");
    expect(result.shop?.map((offer) => offer.matchedVia)).toEqual(["exact", "cross"]);
    expect(result.supplier?.parts).toHaveLength(1);
    expect(suppliers.search).toHaveBeenCalledWith({ q: "04152-40060" });
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/rossko|росско/u);
    expect(log.record).toHaveBeenCalledWith({ q: "04152-40060" }, 3);
  });

  it("learns a number we do not stock from the supplier and FAPI, then finds our analog", async () => {
    const supplier = { ...SUPPLIER, parts: [{ ...SUPPLIER.parts[0]!, crosses: [{ ...SUPPLIER.parts[0]!, brand: "MANN-FILTER", crosses: [], partNumber: "W 68/3" }] }] };
    const card = { part: { article: "04152-40060", brand: "TOYOTA" }, groups: { analogs: [{ article: "W 68/3", brand: "MANN-FILTER" }] }, status: "found" };
    const { crossStore, engine, query, service } = setup({
      engine: { crosses: async () => card, search: async () => ({ article: "04152-40060", status: "article" }) },
      remembered: 1,
      rows: [[], [row("0415240060", "", "p-analog", { brand_name: "MANN-FILTER", sku: "W 68/3", via: 3 })]],
      supplier,
    });
    const result = await service.resolve({ query: "04152-40060" });
    expect(crossStore.rememberPairs).toHaveBeenCalledWith(
      [{ article: "04152-40060", brand: "Toyota", confirmed: false, crossArticle: "W 68/3", crossBrand: "MANN-FILTER" }], "rossko",
    );
    expect(engine.crosses).toHaveBeenCalledWith({ article: "04152-40060" }, null);
    expect(query).toHaveBeenCalledTimes(2);
    expect(result.shop).toEqual([expect.objectContaining({ matchedVia: "possible", productId: "p-analog" })]);
  });

  it("spends nothing on a number we have on the shelf, nor on the routing call", async () => {
    const stocked = setup({ engine: { search: async () => ({ article: "04152-40060", status: "article" }) }, rows: [row("0415240060", "", "p-exact")] });
    await stocked.service.resolve({ query: "04152-40060" });
    expect(stocked.engine.crosses).not.toHaveBeenCalled();
    const routing = setup({ engine: { search: async () => ({ article: "04152-40060", status: "article" }) } });
    await routing.service.resolve({ query: "04152-40060", supplier: false });
    expect(routing.engine.crosses).not.toHaveBeenCalled();
    expect(routing.crossStore.rememberPairs).not.toHaveBeenCalled();
  });

  it("stops automatic FAPI lookups at the hourly cap", async () => {
    const { engine, redisStore, service } = setup({ engine: { search: async () => ({ article: "A-1", status: "article" }) } });
    redisStore.set(`an30:parts-finder:auto-fapi:${Math.floor(Date.now() / 3_600_000)}`, "120");
    await service.resolve({ query: "A-1" });
    expect(engine.crosses).not.toHaveBeenCalled();
  });

  it("prefers the article spelling the shop sells and skips a disabled supplier", async () => {
    const options = [{ id: 1, label: "ДКс 0127" }, { id: 2, label: "LRC 0127" }];
    const { service, suppliers } = setup({
      engine: { search: async () => ({ field: "article", options, status: "choose" }) },
      rows: [row("LRC0127", "", "p1")],
      supplierEnabled: false,
    });
    const result = await service.resolve({ query: "ДКс 0127" });
    expect([result.article, result.alternatives, result.supplier]).toEqual(["LRC 0127", ["ДКс 0127"], null]);
    expect(suppliers.search).not.toHaveBeenCalled();
  });

  it("classifies without the supplier lookup or logging when asked", async () => {
    const { log, service, suppliers } = setup({ engine: { search: async () => ({ article: "04152-40060", status: "article" }) } });
    const result = await service.resolve({ log: false, query: "04152-40060", supplier: false });
    expect([result.kind, result.supplier]).toEqual(["article", null]);
    expect(suppliers.search).not.toHaveBeenCalled();
    expect(log.record).not.toHaveBeenCalled();
  });

  it("records a supplier failure for staff and still answers", async () => {
    const { redisStore, service } = setup({
      engine: { search: async () => ({ article: "W 75/3", status: "article" }) },
      supplier: { ...SUPPLIER, message: "Поставщик временно недоступен", parts: [], success: false },
    });
    expect((await service.resolve({ query: "W 75/3" })).supplier).toBeNull();
    expect(JSON.parse(redisStore.get("an30:parts-finder:supplier:last-error")!)).toMatchObject({ message: "Поставщик временно недоступен" });
  });

  it("sends «деталь + машина» to the guided flow and everything else to the catalog search", async () => {
    const step = { field: "engine", options: [{ id: 1, label: "1NR-FE" }], status: "choose", vehicle: "Toyota Probox" };
    const guided = setup({ engine: { search: async () => step } });
    expect(await guided.service.resolve({ query: "масляный фильтр пробокс" })).toEqual({ kind: "vehicle_part", query: "масляный фильтр пробокс", search: step });
    for (const answer of [{ status: "need_detail" }, { status: "need_vehicle" }]) {
      const plain = setup({ engine: { search: async () => answer } });
      expect(await plain.service.resolve({ query: "колодки" })).toEqual({ kind: "text", query: "колодки" });
      expect(plain.log.record).not.toHaveBeenCalled();
    }
  });
});

describe("staff overview", () => {
  it("reports credits, supplier state and VIN cache in one answer", async () => {
    const { service } = setup();
    expect(await service.staffOverview()).toEqual({
      fapi: {
        cacheEntries: 2, cacheHits: 4, checkedAt: "2026-11-21T08:00:00.000Z", configured: true, dailyLimit: 1000,
        fitmentEnabled: false, packageRemaining: 29_000, plan: "standard", status: "allowed", usedToday: 7, visitorDailyLimit: 100,
      },
      supplier: { enabled: true, lastError: null, lastSuccessAt: null },
      vin: { cacheEntries: 3, cacheHits: 9, vinrokuRemaining: 97 },
    });
  });
});

describe("helpers", () => {
  it("recognises VINs and chassis numbers typed into the header search", () => {
    expect(looksLikeVehicleId("XTAGFK330JY144213")).toBe(true);
    expect(looksLikeVehicleId("xtag fk33 0jy1 44213")).toBe(true);
    expect(looksLikeVehicleId("MXPH14-0036630")).toBe(true);
    expect(looksLikeVehicleId("04152-40060")).toBe(false);
    expect(looksLikeVehicleId("масляный фильтр")).toBe(false);
  });

  it("ranks in-stock offers first, then any offer, stable otherwise", () => {
    const offer = (availableQuantity: number) => ({ availableQuantity });
    const parts = [{ id: "a" }, { id: "b", shop: [offer(0)] }, { id: "c", shop: [offer(3)] }, { id: "d", shop: [offer(1)] }];
    expect(rankByShop(parts).map((part) => part.id)).toEqual(["c", "d", "b", "a"]);
  });
});

// One address could spend the whole site's day of FAPI credits. Every paid lookup a public route starts is now
// made in the visitor's name, so it is counted against that visitor's own share of the day.
describe("whose share of the day a visitor's request spends", () => {
  const VISITOR = { ip: "203.0.113.9" };

  it("the guided search, and the cards it looks up for parts the shop does not stock", async () => {
    const found = { parts: [{ article: "23300-74060", brand: "Toyota", manufacturer_id: 111 }], status: "found", vehicle: "Toyota Gaia" };
    const { engine, service } = setup({ engine: { crosses: async () => ({ status: "found" }), search: async () => found }, remembered: 1, rows: [[], []] });
    await service.search({ query: "топливный фильтр Toyota Gaia" }, VISITOR);
    expect(engine.search).toHaveBeenCalledWith({ query: "топливный фильтр Toyota Gaia" }, VOCABULARY, { payer: "203.0.113.9" });
    expect(engine.crosses).toHaveBeenCalledWith({ article: "23300-74060", manufacturer_id: 111 }, "203.0.113.9");
  });

  it("the analogues of a part number", async () => {
    const { engine, service } = setup({ engine: { crosses: async () => ({ status: "no_data" }) } });
    await service.crosses({ article: "W 75/3" }, VISITOR);
    expect(engine.crosses).toHaveBeenCalledWith({ article: "W 75/3" }, "203.0.113.9");
  });

  it("the header search, when it learns a number the shop does not stock", async () => {
    const { engine, service } = setup({ engine: { crosses: async () => ({ status: "no_data" }), search: async () => ({ article: "04152-40060", status: "article" }) }, rows: [[], []] });
    await service.resolve({ query: "04152-40060" }, VISITOR);
    expect(engine.search).toHaveBeenCalledWith({ query: "04152-40060" }, VOCABULARY, { payer: "203.0.113.9" });
    expect(engine.crosses).toHaveBeenCalledWith({ article: "04152-40060" }, "203.0.113.9");
  });

  it("a visitor out of their share is answered from the shop's own data, without a word about credits", async () => {
    const search = vi.fn(async (_form: unknown, _vocabulary: unknown, options: { offline?: boolean }) => {
      if (!options.offline) throw new PartsFinderError(429, "fapi_visitor_limit", "Суточная доля запросов к каталогу для одного посетителя исчерпана.");
      return { status: "need_detail" };
    });
    const { engine, service } = setup({ engine: { search: search as never } });
    await expect(service.search({ query: "масляный фильтр пробокс" }, VISITOR)).resolves.toMatchObject({ status: "need_detail" });
    expect(engine.search).toHaveBeenLastCalledWith({ query: "масляный фильтр пробокс" }, VOCABULARY, { offline: true, payer: "203.0.113.9" });
  });

  it("the staff overview names the share", async () => {
    const { service } = setup();
    expect((await service.staffOverview()).fapi.visitorDailyLimit).toBe(100);
  });
});
