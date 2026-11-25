import type { ShopOffer } from "@an30/contracts";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { PartsFinderCrossStore } from "../parts-finder/parts-finder-crosses.store.js";
import type { PartsFinderShopService, ShopOfferRequest } from "../parts-finder/parts-finder-shop.service.js";
import type { UmapiPhotoArchiveService } from "./umapi-photo-archive.service.js";
import type { UmapiProductCardService } from "./umapi-product-card.service.js";
import type { UmapiGateway } from "./umapi.gateway.js";
import { UmapiService } from "./umapi.service.js";

// UMAPI answers in the shapes of its OpenAPI 2.1.1 schemas, made up for the tests: no paid call is made.
const SPRINTER_313 = { CI_FROM: "2009-01-01", MANUFACTURER: "MERCEDES-BENZ", MFA_ID: 74, MODEL_SERIES: "SPRINTER 3,5-t Фургон (B906)", MS_ID: 5590, PASSENGER_CAR: "313 CDI", PC_ID: 32001 };
const SPRINTER_316 = { ...SPRINTER_313, PASSENGER_CAR: "316 CDI", PC_ID: 32002 };

type Answers = Record<string, unknown>;

const FILTER_ANSWERS: Answers = {
  "/BrandRefinement/AFW1272": [],
  // «IAMNumber»: another maker's cross of the number, not a maker of it.
  "/BrandRefinement/K1288": [{ BRAND: "FILTRON", DISPLAY_NR: "K 1288", TYPE: "ArticleNumber" }, { BRAND: "SAMPA", DISPLAY_NR: "K1288", TYPE: "IAMNumber" }],
  "/BrandRefinement/CU3569": [{ BRAND: "MANN-FILTER", DISPLAY_NR: "CU 3569", TYPE: "ArticleNumber" }, { BRAND: "SAMPA", DISPLAY_NR: "CU3569", TYPE: "IAMNumber" }],
  "/v2/cross/parts/Analogs/getCrossInfo?article=K1288&brand=FILTRON": {
    article: "K 1288", brand: "FILTRON", catalogId: 7001,
    td: { ARTICLE_NR: "K 1288", ART_ID: 7001, BRAND: "FILTRON", MEDIAS: [{ FILE_NAME: "k1288.webp", SORT: 1, SUP_ID: 256 }], SUP_ID: 256 },
  },
  "/v2/cross/parts/Analogs/getCrossInfo?article=CU3569&brand=MANN-FILTER": { article: "CU 3569", brand: "MANN-FILTER", catalogId: 7002, td: { ARTICLE_NR: "CU 3569", ART_ID: 7002, BRAND: "MANN-FILTER" } },
  "/Analogs/K1288/FILTRON": { data: [{ ARTICLE_NR: "CU 3569", ART_ID: 7002, BRAND: "MANN-FILTER" }] },
  "/Analogs/CU3569/MANN-FILTER": { data: [{ ARTICLE_NR: "K 1288", ART_ID: 7001, BRAND: "FILTRON" }, { ARTICLE_NR: "1 987 432 377", ART_ID: 7003, BRAND: "BOSCH" }] },
  "/ArticleLinks/7001": { PC: [SPRINTER_313, SPRINTER_316] },
  "/ArticleLinks/7002": { PC: [SPRINTER_313] },
};

interface TestProduct { brand: string | null; id: string; name: string; section: string; sku: string }

const AFW: TestProduct = { brand: null, id: "00000000-0000-4000-8000-000000000001", name: "Фильтр салона MB SPRINTER/VW CRAFTER 06- AFW1272 (FILTRON K1288, MANN CU3569) AFW1272", section: "filtry", sku: "AFW1272" };

function offer(productId: string, brand: string, sku: string, matchedVia: ShopOffer["matchedVia"] = "exact", available = 1): ShopOffer {
  return { availableQuantity: available, brand, matchedVia, name: `${brand} ${sku}`, priceKopeks: 50_000, productId, sku, slug: productId };
}

function setup(options: { confirmedAnalogues?: { article: string; brand: string }[]; answers?: Answers; media?: string | null; product?: TestProduct | null; shop?: Record<string, ShopOffer[]> } = {}) {
  const answers = options.answers ?? FILTER_ANSWERS;
  const asked: string[] = [];
  const fresh: string[] = [];
  const remember = vi.fn(async () => undefined);
  const keep = vi.fn(async () => undefined);
  const gateway = {
    available: true,
    get: async (path: string, parameters: Record<string, string | number | boolean>, _caller: unknown, reduce: (payload: unknown) => unknown, settings?: { fresh?: boolean; whenNotFound?: unknown }) => {
      asked.push(path);
      if (settings?.fresh) fresh.push(path);
      // getCrossInfo is one path for every part: its number and maker are in the parameters.
      const key = path.startsWith("/v2/") ? `${path}?${new URLSearchParams(Object.entries(parameters).map(([name, value]) => [name, String(value)])).toString()}` : path;
      return key in answers ? reduce(answers[key]) : settings?.whenNotFound !== undefined ? settings.whenNotFound : reduce([]);
    },
    mediaBaseUrl: options.media === undefined ? "https://media.example" : options.media,
  };
  const database = {
    query: async (sql: string) => {
      if (sql.includes("FROM app.products")) return { rows: options.product === null ? [] : [options.product ?? AFW] };
      if (sql.includes("vehicle_catalog_modifications")) return { rows: [{ ms: 5590, pc: 32001 }] };
      if (sql.includes("vehicle_catalog_models")) return { rows: [{ ms: 5590 }] };
      if (sql.includes("FROM app.article_crosses") && sql.includes("status='confirmed'")) return { rows: options.confirmedAnalogues ?? [] };
      return { rows: [] };
    },
  };
  const shopOffers = options.shop ?? {};
  const shop = {
    lookup: async () => ({ for: (request: ShopOfferRequest) => shopOffers[`${request.brand}|${request.article}`] ?? [] }),
  };
  const crosses: Array<{ pairs: unknown[]; source: string }> = [];
  const crossStore = { rememberPairs: async (pairs: unknown[], source: string) => { crosses.push({ pairs, source }); return pairs.length; } };
  const service = new UmapiService(gateway as unknown as UmapiGateway, database as unknown as DatabaseService, shop as unknown as PartsFinderShopService, { remember } as unknown as UmapiPhotoArchiveService, { keep } as unknown as UmapiProductCardService, crossStore as unknown as PartsFinderCrossStore);
  return { asked, crosses, fresh, keep, remember, service };
}

const VISITOR = { ip: "203.0.113.7" };

describe("UmapiService: compatibility", () => {
  it("checks a part without a maker of ours through the analogue numbers of its name, when they agree", async () => {
    const { service } = setup();
    const answer = await service.productFitment(AFW.id, { modificationId: 100_000_123 }, VISITOR, "check");
    expect(answer).toMatchObject({ status: "ok", verdict: "fits", via: "name" });
    if (answer.status !== "ok") throw new Error("expected an answer");
    expect(answer.parts.map((part) => [part.brand, part.article, part.verdict])).toEqual([["FILTRON", "K 1288", "fits"], ["MANN-FILTER", "CU 3569", "fits"]]);
  });

  it("is not sure when the analogue numbers disagree", async () => {
    const { service } = setup({ answers: { ...FILTER_ANSWERS, "/ArticleLinks/7002": { PC: [] } } });
    expect(await service.productFitment(AFW.id, { modificationId: 100_000_123 }, VISITOR, "check")).toMatchObject({ status: "ok", verdict: null });
  });

  it("tells another engine of the same model, and asks for a car when none is chosen", async () => {
    const { service } = setup({ answers: { ...FILTER_ANSWERS, "/ArticleLinks/7001": { PC: [SPRINTER_316] }, "/ArticleLinks/7002": { PC: [SPRINTER_316] } } });
    expect(await service.productFitment(AFW.id, { modificationId: 100_000_123 }, VISITOR, "check")).toMatchObject({ verdict: "other_engine" });
    expect(await service.productFitment(AFW.id, {}, VISITOR, "check")).toEqual({ status: "vehicle_required" });
  });

  it("lets the product's own maker and number decide alone", async () => {
    const product = { ...AFW, brand: "FILTRON", name: "Фильтр салона FILTRON K1288 (MANN CU3569)", sku: "K1288" };
    // Our own number «K1288» with our maker FILTRON: resolved by itself, the bracketed number is never asked.
    const { asked, service } = setup({ product });
    expect(await service.productFitment(product.id, { modificationId: 100_000_123 }, VISITOR, "check")).toMatchObject({ status: "ok", verdict: "fits", via: "own" });
    expect(asked).not.toContain("/BrandRefinement/CU3569");
  });

  it("asks the catalogue with the bare number: «W 914/2» as «W9142»", async () => {
    const product = { ...AFW, brand: "MANN-FILTER", name: "Фильтр масляный MANN W 914/2", sku: "W 914/2" };
    const answers = {
      ...FILTER_ANSWERS,
      "/BrandRefinement/W9142": [{ BRAND: "MANN-FILTER", DISPLAY_NR: "W 914/2", TYPE: "ArticleNumber" }],
      "/v2/cross/parts/Analogs/getCrossInfo?article=W9142&brand=MANN-FILTER": { article: "W 914/2", brand: "MANN-FILTER", catalogId: 9674543, td: { ARTICLE_NR: "W 914/2", ART_ID: 9674543, BRAND: "MANN-FILTER" } },
    };
    const { asked, service } = setup({ answers, product });
    expect(await service.productFitment(product.id, {}, VISITOR, "list")).toMatchObject({ parts: [{ artId: 9674543, asked: "W9142" }], status: "ok" });
    expect(asked.some((path) => path.includes("/") && path.includes("914%2F2"))).toBe(false);
    expect(asked).toContain("/BrandRefinement/W9142");
  });

  it("answers «ambiguous» for a bare number several makers use, and never asks about oils", async () => {
    const product = { ...AFW, name: "Деталь 1234567", sku: "1234567" };
    const { service } = setup({ answers: { "/BrandRefinement/1234567": [{ BRAND: "A", DISPLAY_NR: "1234567", TYPE: "ArticleNumber" }, { BRAND: "B", DISPLAY_NR: "1234567", TYPE: "ArticleNumber" }] }, product });
    expect(await service.productFitment(product.id, {}, VISITOR, "list")).toEqual({ status: "ambiguous" });
    const oil = { ...AFW, brand: "LIQUI MOLY", name: "Масло 5W-40", section: "motornye-masla", sku: "3930" };
    const { asked, service: oilService } = setup({ product: oil });
    expect(await oilService.productFitment(oil.id, {}, VISITOR, "list")).toEqual({ status: "not_applicable" });
    expect(asked).toEqual([]);
  });

  it("lists the cars of all the analogue numbers once each, the customer's first", async () => {
    const { service } = setup();
    const answer = await service.productFitment(AFW.id, { modificationId: 100_000_123 }, VISITOR, "list");
    if (answer.status !== "ok") throw new Error("expected an answer");
    expect(answer.total).toBe(2);
    expect(answer.makes[0]!.models[0]!.cars.map((car) => [car.name, car.mine])).toEqual([["313 CDI", true], ["316 CDI", false]]);
  });
});

describe("UmapiService: analogs and photo", () => {
  it("returns only our products whose number AND maker match an analog, never the product itself", async () => {
    const { service } = setup({
      shop: {
        "BOSCH|1 987 432 377": [offer("p-bosch", "BOSCH", "1987432377")],
        "FILTRON|K 1288": [offer("p-filtron", "FILTRON", "K1288"), offer(AFW.id, "FILTRON", "K1288")],
        "MANN-FILTER|CU 3569": [offer("p-other-maker", "SAKURA", "CU3569"), offer("p-cross", "MANN-FILTER", "CU3569", "cross")],
      },
    });
    const answer = await service.productAnalogs(AFW.id, VISITOR);
    if (answer.status !== "ok") throw new Error("expected an answer");
    expect(answer.offers.map((item) => [item.productId, item.basis])).toEqual([["p-filtron", "catalogue"], ["p-bosch", "catalogue"]]);
  });

  it("keeps every analog answer in the shop's cross base as unconfirmed «umapi» pairs, once per part", async () => {
    const { crosses, service } = setup();
    await service.productAnalogs(AFW.id, VISITOR);
    await service.productAnalogs(AFW.id, VISITOR);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(crosses.length).toBeGreaterThan(0);
    expect(crosses.every((entry) => entry.source === "umapi")).toBe(true);
    const pairs = crosses.flatMap((entry) => entry.pairs) as Array<{ article: string; brand: string; confirmed: boolean; crossArticle: string; crossBrand: string }>;
    expect(pairs.every((pair) => pair.confirmed === false)).toBe(true);
    expect(pairs.some((pair) => pair.crossBrand === "BOSCH")).toBe(true);
    // The part itself is never its own cross; a second press within the hour writes nothing more.
    expect(pairs.some((pair) => pair.crossArticle.replace(/\s/g, "") === pair.article.replace(/\s/g, "") && pair.crossBrand === pair.brand)).toBe(false);
    expect(new Set(crosses.map((entry) => JSON.stringify(entry.pairs))).size).toBe(crosses.length);
  });

  it("gives photo addresses on the media host, and nothing without one", async () => {
    const product = { ...AFW, name: "Фильтр салона FILTRON K1288", sku: "K1288" };
    const { service, remember } = setup({ product });
    expect(await service.productPhotos(product.id, VISITOR)).toMatchObject({ photos: ["https://media.example/256/k1288.webp"], status: "ok" });
    expect(remember).not.toHaveBeenCalled();
    const { asked, service: noMedia } = setup({ media: null });
    expect(await noMedia.productPhotos(AFW.id, VISITOR)).toEqual({ status: "not_available" });
    expect(asked).toEqual([]);
  });
  it("requests fresh data on each photo press and records exact matches for staff", async () => {
    const product = { ...AFW, brand: "FILTRON", name: "Фильтр салона FILTRON K1288", sku: "K1288" };
    const { fresh, remember, service } = setup({ product });
    await service.productPhotos(product.id, VISITOR);
    await service.productPhotos(product.id, VISITOR);
    expect(fresh).toEqual([
      "/BrandRefinement/K1288", "/v2/cross/parts/Analogs/getCrossInfo",
      "/BrandRefinement/K1288", "/v2/cross/parts/Analogs/getCrossInfo",
    ]);
    expect(remember).toHaveBeenCalledTimes(2);
    expect(remember).toHaveBeenCalledWith(expect.objectContaining({ brand: "FILTRON", id: product.id }),
      expect.objectContaining({ artId: 7001, via: "own" }), ["https://media.example/256/k1288.webp"]);
  });

  it("standalone selection resolves the maker and keeps the exact local offers only", async () => {
    const { service } = setup({
      answers: { ...FILTER_ANSWERS, "/BrandRefinement/K1288": [
        { BRAND: "FILTRON", DISPLAY_NR: "K 1288", TYPE: "ArticleNumber" },
        { BRAND: "OTHER", DISPLAY_NR: "K1288", TYPE: "ArticleNumber" },
        { BRAND: "SAMPA", DISPLAY_NR: "K1288", TYPE: "IAMNumber" },
      ] },
      shop: { "MANN-FILTER|CU 3569": [offer("exact", "MANN-FILTER", "CU3569"), offer("different", "SAKURA", "CU3569")] },
    });
    expect(await service.numberAnalogs("K1288", undefined, VISITOR)).toMatchObject({
      status: "choose_brand", candidates: [{ brand: "FILTRON" }, { brand: "OTHER" }],
    });
    expect(await service.numberAnalogs("K1288", "FILTRON", VISITOR)).toMatchObject({
      status: "found", groups: { analogs: [{ brand: "MANN-FILTER", article: "CU 3569", shop: [{ productId: "exact" }] }] },
    });
    expect(await service.numberAnalogs("K1288", "SAMPA", VISITOR)).toEqual({ article: "K1288", status: "no_data" });
  });

});

describe("UmapiService: products our own number alone did not find (sample of 24.11.2026)", () => {
  const SAT: TestProduct = { brand: null, id: "00000000-0000-4000-8000-000000000101", name: "Фильтр топливный TOYOTA HILUX SURF/4RUNNER 3RZ 02-09", section: "filtry", sku: "ST-23300-31090" };
  const OE_ANSWERS: Answers = {
    "/BrandRefinement/ST2330031090": [],
    "/BrandRefinement/WK6015": [{ BRAND: "MANN-FILTER", DISPLAY_NR: "WK 6015", TYPE: "ArticleNumber" }],
    // Only original numbers: the catalogue keeps no card of TOYOTA 23300-31090 itself.
    "/BrandRefinement/2330031090": [{ BRAND: "TOYOTA", DISPLAY_NR: "23300-31090", TYPE: "OENumber" }, { BRAND: "LEXUS", DISPLAY_NR: "23300-31090", TYPE: "OENumber" }],
    "/Analogs/2330031090/TOYOTA": { data: [{ ARTICLE_NR: "WK 6015", ART_ID: 9101, BRAND: "MANN-FILTER" }, { ARTICLE_NR: "PP 968/1", ART_ID: 9102, BRAND: "FILTRON" }] },
    "/ArticleLinks/9101": { PC: [SPRINTER_313] },
    "/ArticleLinks/9102": { PC: [SPRINTER_316] },
    "/v2/cross/parts/Analogs/getCrossInfo?article=WK6015&brand=MANN-FILTER": { article: "WK 6015", brand: "MANN-FILTER", catalogId: 9101, td: { ARTICLE_NR: "WK 6015", ART_ID: 9101, BRAND: "MANN-FILTER", MEDIAS: [{ FILE_NAME: "wk6015.webp", SORT: 1, SUP_ID: 4 }], SUP_ID: 4 } },
  };

  it("finds SAT's copy of an original part through the analogues of the original number", async () => {
    const { service } = setup({ answers: OE_ANSWERS, product: SAT });
    const answer = await service.productFitment(SAT.id, {}, VISITOR, "list");
    expect(answer).toMatchObject({ status: "ok", total: 2, via: "own" });
    expect(answer.status === "ok" && answer.parts[0]!.through).toEqual({ article: "23300-31090", brand: "TOYOTA" });
    // The customer's 313 CDI is listed for one of the analogues: it fits.
    expect(await service.productFitment(SAT.id, { modificationId: 100_000_123 }, VISITOR, "check")).toMatchObject({ verdict: "fits" });
  });

  it("shows an analogue's photo for it, and never keeps it as the product's own", async () => {
    const product = { ...SAT, brand: "SAT" };
    const { remember, service } = setup({ answers: OE_ANSWERS, product, confirmedAnalogues: [{ article: "WK 6015", brand: "MANN-FILTER" }] });
    expect(await service.productPhotos(product.id, VISITOR)).toMatchObject({ part: { article: "WK 6015", through: { brand: "SAT" } }, photos: ["https://media.example/4/wk6015.webp"], status: "ok" });
    expect(remember).not.toHaveBeenCalled();
  });

  it("finds a maker the catalogue has no card of through its analogues, and a maker named otherwise", async () => {
    const masuma: TestProduct = { brand: "MASUMA", id: "00000000-0000-4000-8000-000000000102", name: "Насос подкачки топлива MASUMA", section: "toplivnaya-sistema", sku: "MPU-1014" };
    const answers: Answers = {
      "/BrandRefinement/MPU1014": [{ BRAND: "MASUMA", DISPLAY_NR: "MPU-1014", TYPE: "ArticleNumber" }],
      "/Analogs/MPU1014/MASUMA": { data: [{ ARTICLE_NR: "0 440 008 090", ART_ID: 9201, BRAND: "BOSCH" }] },
      "/ArticleLinks/9201": { PC: [SPRINTER_313] },
    };
    expect(await setup({ answers, product: masuma }).service.productFitment(masuma.id, {}, VISITOR, "list")).toMatchObject({ status: "ok", total: 1 });
    const osram: TestProduct = { brand: "OSRAM", id: "00000000-0000-4000-8000-000000000103", name: "64193SUP Лампа H4 12V 60/55W Osram", section: "avtolampy", sku: "64193SUP" };
    const lamp: Answers = {
      "/BrandRefinement/64193SUP": [{ BRAND: "ams-OSRAM", DISPLAY_NR: "64193SUP", TYPE: "ArticleNumber" }],
      "/v2/cross/parts/Analogs/getCrossInfo?article=64193SUP&brand=ams-OSRAM": { article: "64193SUP", brand: "ams-OSRAM", catalogId: 9301, td: { ARTICLE_NR: "64193SUP", ART_ID: 9301, BRAND: "ams-OSRAM" } },
      "/ArticleLinks/9301": { PC: [SPRINTER_313] },
    };
    expect(await setup({ answers: lamp, product: osram }).service.productFitment(osram.id, {}, VISITOR, "list")).toMatchObject({ parts: [{ brand: "ams-OSRAM", via: "own" }], status: "ok" });
  });

  it("tries the number written in the name when ours is unknown, and picks the maker the name mentions", async () => {
    const sheft: TestProduct = { brand: "SHEFT", id: "00000000-0000-4000-8000-000000000104", name: "(LX1734) Фильтр воздушный MB Actros MAHLE SHEFT 16015-FS", section: "filtry", sku: "16015FS" };
    const answers: Answers = {
      "/BrandRefinement/16015FS": [],
      "/BrandRefinement/LX1734": [{ BRAND: "MAHLE", DISPLAY_NR: "LX 1734", TYPE: "ArticleNumber" }, { BRAND: "KNECHT", DISPLAY_NR: "LX 1734", TYPE: "ArticleNumber" }],
      "/v2/cross/parts/Analogs/getCrossInfo?article=LX1734&brand=MAHLE": { article: "LX 1734", brand: "MAHLE", catalogId: 9401, td: { ARTICLE_NR: "LX 1734", ART_ID: 9401, BRAND: "MAHLE" } },
      "/ArticleLinks/9401": { PC: [SPRINTER_313] },
    };
    expect(await setup({ answers, product: sheft }).service.productFitment(sheft.id, {}, VISITOR, "list")).toMatchObject({ parts: [{ article: "LX 1734", brand: "MAHLE", via: "name" }], status: "ok" });
  });

  it("takes our maker for a number written in the name, and an original number behind our maker", async () => {
    const belt: TestProduct = { brand: "ContiTech", id: "00000000-0000-4000-8000-000000000105", name: "AVX13X1385 Ремень клиновой Contitech", section: "remni", sku: "13X1385" };
    const beltAnswers: Answers = {
      "/BrandRefinement/13X1385": [{ BRAND: "PROCODIS FRANCE", DISPLAY_NR: "13X1385", TYPE: "ArticleNumber" }],
      "/BrandRefinement/AVX13X1385": ["CONTINENTAL CTAM", "GMB", "OPTIBELT"].map((BRAND) => ({ BRAND, DISPLAY_NR: "AVX13X1385", TYPE: "ArticleNumber" })),
      "/v2/cross/parts/Analogs/getCrossInfo?article=AVX13X1385&brand=CONTINENTAL+CTAM": { article: "AVX13X1385", brand: "CONTINENTAL CTAM", catalogId: 9501, td: { ARTICLE_NR: "AVX13X1385", ART_ID: 9501, BRAND: "CONTINENTAL CTAM" } },
      "/ArticleLinks/9501": { PC: [SPRINTER_313] },
    };
    expect(await setup({ answers: beltAnswers, product: belt }).service.productFitment(belt.id, {}, VISITOR, "list")).toMatchObject({ parts: [{ brand: "CONTINENTAL CTAM" }], status: "ok" });
    const seal: TestProduct = { brand: "NOK", id: "00000000-0000-4000-8000-000000000106", name: "BE1192-E0 Сальник раздатки NOK 90311-48009", section: "kpp", sku: "9031148009" };
    const sealAnswers: Answers = {
      "/BrandRefinement/9031148009": [{ BRAND: "TOYOTA", DISPLAY_NR: "90311-48009", TYPE: "OENumber" }],
      "/Analogs/9031148009/TOYOTA": { data: [{ ARTICLE_NR: "AB1234", ART_ID: 9601, BRAND: "CORTECO" }] },
      "/ArticleLinks/9601": { PC: [SPRINTER_313] },
    };
    expect(await setup({ answers: sealAnswers, product: seal }).service.productFitment(seal.id, {}, VISITOR, "list")).toMatchObject({ parts: [{ through: { brand: "TOYOTA" } }], status: "ok" });
  });

  it("lists lorries too, and never takes one for the customer's car", async () => {
    const actros = { AXLE_CONFIGURATION: "4x2", CI_FROM: "2002-11-01", COMMERCIAL_VEHICLE: "1831", CV_ID: 32001, MANUFACTURER: "MERCEDES-BENZ", MFA_ID: 74, MODEL_SERIES: "ACTROS MP2 / MP3", MS_ID: 5590, POWER_PS_START: "313.00" };
    const answers: Answers = { ...FILTER_ANSWERS, "/ArticleLinks/7001": { CV: [actros] } };
    const product = { ...AFW, brand: "FILTRON", name: "Фильтр FILTRON K1288", sku: "K1288" };
    const { service } = setup({ answers, product });
    expect(await service.productFitment(product.id, {}, VISITOR, "list")).toMatchObject({ makes: [{ make: "MERCEDES-BENZ", models: [{ cars: [{ name: "1831 · 313 л.с. · 4x2" }] }] }], total: 1 });
    // Its CV_ID equals the customer's PC_ID and its MS_ID the model's: still «not listed» for the car.
    expect(await service.productFitment(product.id, { modificationId: 100_000_123 }, VISITOR, "check")).toMatchObject({ verdict: "not_listed" });
  });
});

describe("UmapiService: the maker's photo and characteristics are kept for the product", () => {
  it("keeps the product's own part with its characteristics, and never an analogue's", async () => {
    const product = { ...AFW, brand: "FILTRON", name: "Фильтр салона FILTRON K1288", sku: "K1288" };
    const answers: Answers = {
      ...FILTER_ANSWERS,
      "/Article/7001": { COMPLETE_DES: "Фильтр, воздух во внутреннем пространстве", CRITERIAS: [
        { CRI_DES: "Длина [мм]", CRI_SHORT_DES: "Длина", CRI_UNIT_DES: "мм", VALUE: "254" },
        { CRI_DES: "Учитывать технические данные", CRI_TYPE: "NoValue" },
        { CRI_DES: "Тормозная система", DES: "только со стальными дисками", VALUE: "80" },
      ] },
    };
    const { keep, service } = setup({ answers, product });
    const answer = await service.productPhotos(product.id, VISITOR);
    expect(answer).toMatchObject({
      photos: ["https://media.example/256/k1288.webp"],
      specs: [{ label: "Длина", value: "254 мм" }, { label: "Тормозная система", value: "только со стальными дисками" }],
      status: "ok",
      title: "Фильтр, воздух во внутреннем пространстве",
    });
    expect(keep).toHaveBeenCalledWith(expect.objectContaining({ id: product.id }), expect.objectContaining({ artId: 7001 }), expect.objectContaining({ photos: ["https://media.example/256/k1288.webp"] }));
  });

  it("shows an analogue's photo, labelled, when the part's own card has none, and keeps no photo for the product", async () => {
    const product = { ...AFW, brand: "MANN", name: "Фильтр салона MANN CU3569", sku: "CU3569" };
    const answers: Answers = { ...FILTER_ANSWERS, "/Article/7002": { CRITERIAS: [{ CRI_DES: "Длина [мм]", CRI_UNIT_DES: "мм", VALUE: "254" }] } };
    const { keep, service } = setup({ answers, product, confirmedAnalogues: [{ article: "K 1288", brand: "FILTRON" }] });
    const answer = await service.productPhotos(product.id, VISITOR);
    expect(answer).toMatchObject({
      part: { article: "K 1288", brand: "FILTRON", through: { article: "CU3569", brand: "MANN" } },
      photos: ["https://media.example/256/k1288.webp"],
      specs: [{ label: "Длина", value: "254 мм" }],
      status: "ok",
    });
    expect(keep).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ artId: 7002 }), expect.objectContaining({ photos: [] }));
  });

  it("ignores a single catalogue's unconfirmed analogue when selecting an image", async () => {
    const product = { ...AFW, brand: "MANN", name: "Фильтр салона MANN CU3569", sku: "CU3569" };
    const { keep, service } = setup({ product });
    expect(await service.productPhotos(product.id, VISITOR)).toMatchObject({ photos: [], status: "none" });
    expect(keep).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ artId: 7002 }), expect.objectContaining({ photos: [] }));
  });

  it("requires evidence for another maker’s number mentioned in a name", async () => {
    // AFW1272 names FILTRON K1288 and MANN CU3569 in brackets: their photo is an analogue's, not this part's.
    const { keep, service } = setup({ answers: { ...FILTER_ANSWERS, "/Article/7001": { CRITERIAS: [{ CRI_DES: "Длина [мм]", VALUE: "254" }] } } });
    const answer = await service.productPhotos(AFW.id, VISITOR);
    expect(answer).toEqual({ status: "unknown_part" });
    expect(keep).not.toHaveBeenCalled();
  });

  it("rejects an analogue media card whose actual maker disagrees with the confirmed pair", async () => {
    const product = { ...AFW, brand: "MANN", name: "Фильтр салона MANN CU3569", sku: "CU3569" };
    const answers = {
      ...FILTER_ANSWERS,
      "/v2/cross/parts/Analogs/getCrossInfo?article=K1288&brand=FILTRON": {
        article: "K 1288", brand: "BOSCH", catalogId: 7001,
        td: { ARTICLE_NR: "K 1288", ART_ID: 7001, BRAND: "BOSCH", MEDIAS: [{ FILE_NAME: "wrong.webp", SUP_ID: 256 }] },
      },
    };
    const { service } = setup({ answers, product, confirmedAnalogues: [{ article: "K 1288", brand: "FILTRON" }] });
    expect(await service.productPhotos(product.id, VISITOR)).toMatchObject({ photos: [], status: "none" });
  });
});

