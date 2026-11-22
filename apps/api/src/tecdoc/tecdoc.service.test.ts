import { normalizeArticleNumber, type ShopOffer } from "@an30/contracts";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { PartsFinderShopService, ShopOfferRequest } from "../parts-finder/parts-finder-shop.service.js";
import type { TecdocCaller, TecdocGateway } from "./tecdoc.gateway.js";
import { TecdocService } from "./tecdoc.service.js";

const ok = (data: unknown) => ({ data, success: true });
const caller: TecdocCaller = { ip: "203.0.113.7" };

function offer(sku: string, brand: string, quantity = 3, via: ShopOffer["matchedVia"] = "exact"): ShopOffer {
  return { availableQuantity: quantity, brand, matchedVia: via, name: `Товар ${sku}`, priceKopeks: 50_000, productId: `p-${normalizeArticleNumber(sku)}-${brand}`, sku, slug: `s-${sku}` };
}

function setup(options: {
  answers?: Record<string, unknown>;
  carried?: Array<{ key: string; products: number }>;
  product?: { brand: string | null; section: string | null; sku: string } | null;
  stock?: ShopOffer[];
} = {}) {
  const calls: Array<{ parameters: Record<string, unknown>; path: string }> = [];
  const gateway = {
    enabled: true,
    get: vi.fn(async (path: string, parameters: Record<string, unknown>, _caller: TecdocCaller, reduce: (payload: unknown) => unknown) => {
      calls.push({ parameters, path });
      const key = Object.keys(options.answers ?? {}).find((candidate) => candidate === `${path}?${new URLSearchParams(parameters as Record<string, string>).toString()}`) ?? path;
      return reduce(options.answers?.[key] ?? ok({ list: [] }));
    }),
  };
  const stock = options.stock ?? [];
  const shop = {
    lookup: vi.fn(async (requests: readonly ShopOfferRequest[]) => ({
      for: (request: ShopOfferRequest) => (requests.some((item) => normalizeArticleNumber(item.article) === normalizeArticleNumber(request.article))
        ? stock.filter((item) => normalizeArticleNumber(item.sku) === normalizeArticleNumber(request.article) || item.matchedVia !== "exact" && item.name.includes(request.article))
        : []),
    })),
  };
  const database = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("brand_identities")) return { rows: [{ alias: "MANN", canonical: "MANN" }, { alias: "MANNFILTER", canonical: "MANN" }, { alias: "TOYOTA", canonical: "TOYOTA" }, { alias: "LEXUS", canonical: "TOYOTA" }] };
      if (sql.includes("canonical_brand(brand.name) AS key")) return { rows: options.carried ?? [{ key: "MANN", products: 40 }, { key: "BOSCH", products: 12 }] };
      if (sql.includes("FROM app.products AS product")) return { rows: options.product === null ? [] : [options.product ?? { brand: "MANN", section: "filtry", sku: "W 68/3" }] };
      return { rows: [] };
    }),
  };
  const service = new TecdocService(gateway as unknown as TecdocGateway, shop as unknown as PartsFinderShopService, database as unknown as DatabaseService);
  return { calls, gateway, service, shop };
}

describe("TecdocService: vehicle picker", () => {
  it("puts the region's makes first and writes names the way people read them", async () => {
    const { service } = setup({ answers: { "/manufacturer": ok({ list: [
      { MFA_BRAND: "ALFA ROMEO", MFA_ID: 2 }, { MFA_BRAND: "TOYOTA", MFA_ID: 111 }, { MFA_BRAND: "NISSAN", MFA_ID: 80 }, { MFA_BRAND: "MERCEDES-BENZ", MFA_ID: 74 },
    ] }) } });
    const makes = await service.makes(caller);
    expect(makes.popular.map((make) => make.name)).toEqual(["Toyota", "Nissan", "Mercedes-Benz"]);
    expect(makes.popular[0]).toEqual({ country: "Япония", id: 111, name: "Toyota", nameRu: "Тойота", slug: "111" });
    expect(makes.groups.map((group) => group.letter)).toEqual(["A", "M", "N", "T"]);
    expect(makes.groups[0]!.makes[0]!.name).toBe("Alfa Romeo");
  });

  it("groups a make's generations under the catalogue's series", async () => {
    const { service } = setup({ answers: {
      "/manufacturer": ok({ list: [{ MFA_BRAND: "TOYOTA", MFA_ID: 111 }] }),
      "/model": ok({ list: [
        { DATE_FROM: "1997-09-01", DATE_TO: "2002-09-01", MS_ID: 2, NAME: "CALDINA универсал (_T21_)" },
        { DATE_FROM: "2002-09-01", DATE_TO: "2007-06-01", MS_ID: 3, NAME: "CALDINA универсал (_T24_)" },
        { DATE_FROM: "2002-09-01", MS_ID: 4, NAME: "LAND CRUISER PRADO (_J12_)" },
        { DATE_FROM: "2007-09-01", MS_ID: 5, NAME: "LAND CRUISER 200 (_J2_)" },
      ] }),
      "/series": ok({ list: [{ SR_ID: 1, SR_NAME: "CALDINA" }, { SR_ID: 2, SR_NAME: "LAND CRUISER" }, { SR_ID: 3, SR_NAME: "LAND CRUISER PRADO" }] }),
    } });
    const answer = await service.models(111, caller);
    expect(answer.models.map((model) => [model.family, model.generation, model.body, model.yearFrom])).toEqual([
      ["Caldina", "T24", "универсал", 2002], ["Caldina", "T21", "универсал", 1997],
      ["Land Cruiser", "200 · J2", null, 2007], ["Land Cruiser Prado", "J12", null, 2002],
    ]);
    expect(answer.popular).toEqual(["Land Cruiser", "Land Cruiser Prado"]);
    expect(answer.make.name).toBe("Toyota");
  });

  it("describes an engine by volume, code, power and fuel", async () => {
    const { service } = setup({ answers: { "/generation": ok({ list: [
      { BODY: "универсал", CAPACITY_LT: "2.0000", DATE_END: "2002-09-01", DATE_START: "1997-09-01", ENG_CODES: [{ ENG_CODE: "3S-FE" }], FUEL: "бензин", GEN_ID: 9001, NAME: "2.0", POWER_PS_FROM: "140.0000" },
    ] }) } });
    expect(await service.modifications(2, caller)).toEqual({ available: true, modifications: [{
      body: "универсал", capacity: "2.0", engine: "3S-FE", fuel: "бензин", id: 9001, label: "2.0 · 140 л.с. · бензин", powerPs: 140, yearFrom: 1997, yearTo: 2002,
    }] });
    expect((await setup().service.modifications(2, caller)).available).toBe(false);
  });
});

describe("TecdocService: parts for a car, our products first", () => {
  const supplierRows = ok({ list: [
    { ART_ARTICLE_NR: "WK 614/46", PT_NAME: "Топливный фильтр", SUP_BRAND: "MANN-FILTER", SUP_ID: 4 },
    { ART_ARTICLE_NR: "F 026 403 006", PT_NAME: "Топливный фильтр", SUP_BRAND: "BOSCH", SUP_ID: 30 },
    { ART_ARTICLE_NR: "KL 100", PT_NAME: "Топливный фильтр", SUP_BRAND: "KNECHT", SUP_ID: 34 },
  ] });
  const mannParts = ok({ list: [{ ART_ARTICLE_NR: "WK 614/46", ART_ID: 1, ART_PRODUCT_NAME: "Топливный фильтр", OEMS: [{ BRAND: "TOYOTA", NUMBER: "23300-79525" }], SUP_BRAND: "MANN-FILTER" }] });

  it("asks the provider only about the brands we sell that really have a match", async () => {
    const { calls, service } = setup({
      answers: { "/part": mannParts, "/supplier": supplierRows },
      stock: [offer("WK614/46", "MANN")],
    });
    const answer = await service.parts({ all: false, categoryId: 77, genId: 9001, page: 1 }, caller);
    // One call for the brand list, one for MANN; Bosch (ours, no match) and Knecht (not ours) cost nothing.
    expect(calls.map((call) => [call.path, call.parameters.sup_id])).toEqual([["/supplier", undefined], ["/part", 4]]);
    expect(answer.ours).toEqual([expect.objectContaining({ article: "WK 614/46", brand: "MANN-FILTER", shop: [expect.objectContaining({ sku: "WK614/46" })] })]);
    expect(answer).toMatchObject({ catalog: null, checkedBrands: ["MANN-FILTER"], listedBrands: 3 });
  });

  it("never takes another brand's part with the same number for ours", async () => {
    const { service } = setup({ answers: { "/part": mannParts, "/supplier": supplierRows }, stock: [offer("WK614/46", "Sakura")] });
    const answer = await service.parts({ all: false, categoryId: 77, genId: 9001, page: 1 }, caller);
    expect(answer.ours).toEqual([]);
    // Nothing of ours: the general list is shown instead (one more call), still without the wrong-brand product.
    expect(answer.catalog).toEqual([expect.objectContaining({ article: "WK 614/46", shop: [] })]);
  });

  it("recognises our original part by the number the catalogue names", async () => {
    const { service } = setup({
      answers: { "/part": mannParts, "/supplier": ok({ list: [{ PT_NAME: "Топливный фильтр", SUP_BRAND: "MANN-FILTER", SUP_ID: 4 }] }) },
      stock: [offer("2330079525", "Lexus")],
    });
    const answer = await service.parts({ all: false, categoryId: 77, genId: 9001, page: 1 }, caller);
    expect(answer.ours[0]!.shop).toEqual([expect.objectContaining({ brand: "Lexus", sku: "2330079525" })]);
  });

  it("asks at most six of our brands and loads the general list only on request", async () => {
    const brands = Array.from({ length: 9 }, (_item, index) => ({ PT_NAME: "Фильтр", SUP_BRAND: `BRAND${index}`, SUP_ID: 100 + index }));
    const { calls, service } = setup({
      answers: { "/supplier": ok({ list: brands }) },
      carried: brands.map((row, index) => ({ key: row.SUP_BRAND, products: index })),
    });
    await service.parts({ all: true, categoryId: 77, genId: 9001, page: 2 }, caller);
    const partCalls = calls.filter((call) => call.path === "/part");
    expect(partCalls.filter((call) => call.parameters.sup_id).map((call) => call.parameters.sup_id)).toEqual([108, 107, 106, 105, 104, 103]);
    expect(partCalls.filter((call) => !call.parameters.sup_id)).toEqual([expect.objectContaining({ parameters: expect.objectContaining({ page: 2, per_page: 50 }) })]);
  });
});

describe("TecdocService: a number and a product of ours", () => {
  const search = ok({ list: [
    { ART_ARTICLE_NR: "W 68/3", ART_ID: 500, ART_PRODUCT_NAME: "Масляный фильтр", FOUND_VIA: "ArticleNumber", SUP_BRAND: "MANN-FILTER" },
    { ART_ARTICLE_NR: "W 68/3", ART_ID: 501, FOUND_VIA: "ArticleNumber", SUP_BRAND: "OTHERBRAND" },
    { ART_ARTICLE_NR: "OC 217", ART_ID: 502, ART_PRODUCT_NAME: "Масляный фильтр", FOUND_VIA: { ARL_TYPE: "IAMNumber" }, SUP_BRAND: "KNECHT" },
  ] });

  it("finds our analogs for a number without storing the pair", async () => {
    const { service } = setup({ answers: { "/search": search }, stock: [offer("OC217", "Knecht"), offer("OC217", "NoName", 9)] });
    const answer = await service.offersForNumber("W68/3", caller);
    expect(answer.shop).toEqual([expect.objectContaining({ brand: "Knecht", matchedVia: "cross", sku: "OC217" })]);
    expect(answer.analogs).toEqual([{ article: "OC 217", brand: "KNECHT", name: "Масляный фильтр" }]);
  });

  const detail = ok({ item: {
    APPLICABILITY: { PASSENGER_CAR: [{ BRAND: "TOYOTA", GEN_TOTAL: 4, MFA_ID: 111, MODEL: "CALDINA универсал (_T21_)", MS_ID: 2, SERIES: "CALDINA" }] },
    ART_ARTICLE_NR: "W 68/3", ART_ID: 500, ART_PRODUCT_NAME: "Масляный фильтр", OEM: [{ ARL_BRAND: "TOYOTA", ARL_NUMBER: "90915-YZZE1" }], SUP_BRAND: "MANN-FILTER",
  } });

  it("says which cars our product fits, taking the part by number AND brand", async () => {
    const { calls, service } = setup({ answers: { "/part/500": detail, "/search": search } });
    const answer = await service.productFitment("00000000-0000-4000-8000-000000000001", {}, caller);
    expect(answer).toEqual({
      article: { brand: "MANN-FILTER", name: "Масляный фильтр", number: "W 68/3" },
      makes: [{ make: "Toyota", models: [{ generations: 4, makeId: 111, model: "CALDINA универсал (_T21_)", msId: 2, series: "CALDINA" }] }],
      oems: [{ brand: "TOYOTA", number: "90915-YZZE1" }], status: "ok", total: 1, verdict: null,
    });
    expect(calls.map((call) => call.path)).toEqual(["/search", "/part/500"]);
  });

  it("answers for the customer's own car: fits, another engine, model only, not listed", async () => {
    const answers = { "/part/500": detail, "/search": search };
    const verdict = async (ids: unknown, car: { genId?: number; msId?: number }) => {
      const result = await setup({ answers: { ...answers, "/applicability": ok({ list: ids }) } }).service.productFitment("00000000-0000-4000-8000-000000000001", car, caller);
      return "verdict" in result ? result.verdict : result.status;
    };
    expect(await verdict([9001, 9002], { genId: 9001, msId: 2 })).toBe("fits");
    expect(await verdict([9002], { genId: 9001, msId: 2 })).toBe("other_engine");
    expect(await verdict([], { genId: 9001, msId: 2 })).toBe("model");
    expect(await verdict([], { msId: 2 })).toBe("model");
    expect(await verdict([9001], { genId: 9001, msId: 777 })).toBe("not_listed");
  });

  it("spends nothing on oils and tools, and does not guess when the brand differs", async () => {
    const oil = setup({ product: { brand: "Lukoil", section: "motornye-masla", sku: "3148675" } });
    expect(await oil.service.productFitment("00000000-0000-4000-8000-000000000001", {}, caller)).toEqual({ status: "not_applicable" });
    expect(oil.gateway.get).not.toHaveBeenCalled();
    const other = setup({ answers: { "/search": search }, product: { brand: "Bosch", section: "filtry", sku: "W 68/3" } });
    expect(await other.service.productFitment("00000000-0000-4000-8000-000000000001", {}, caller)).toEqual({ status: "unknown_part" });
    expect(other.calls.map((call) => call.path)).toEqual(["/search"]);
    expect(await setup({ product: null }).service.productFitment("00000000-0000-4000-8000-000000000001", {}, caller)).toEqual({ status: "not_found" });
  });
});
