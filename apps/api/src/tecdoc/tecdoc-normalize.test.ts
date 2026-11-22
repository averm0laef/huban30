import { describe, expect, it } from "vitest";

import {
  collectGenerationIds, hasMorePages, matchCategories, normalizeApplicability, normalizeCategories, normalizeGenerations,
  normalizeMakes, normalizeModels, normalizePartDetail, normalizeParts, normalizeSeries, normalizeSupplierRows, normalizeVin,
} from "./tecdoc-normalize.js";

const ok = (data: unknown) => ({ data, responseTime: 0.01, success: true });

describe("tecdoc answers reduced to what the site shows", () => {
  it("reads makes, series, models and modifications from the documented shapes", () => {
    expect(normalizeMakes(ok({ list: [{ MFA_BRAND: "ABARTH", MFA_ID: 3854, MFA_IMAGE: "manufacturer/3854.png", MFA_MODELS_COUNT: 11 }, { MFA_ID: 0 }], total: 1 })))
      .toEqual([{ id: 3854, modelsCount: 11, name: "ABARTH" }]);
    expect(normalizeSeries(ok({ list: [{ SR_ID: 54, SR_MFA_ID: 5, SR_MODELS_COUNT: 8, SR_NAME: "100" }] }))).toEqual([{ id: 54, name: "100" }]);
    expect(normalizeModels(ok({ list: [{ DATE_FROM: "1976-06-01", DATE_TO: "1984-08-01", MFA_ID: 5, MS_ID: 10, NAME: "100 C2 седан (431, 433, 434)" }] })))
      .toEqual([{ id: 10, makeId: 5, name: "100 C2 седан (431, 433, 434)", yearFrom: 1976, yearTo: 1984 }]);
    expect(normalizeGenerations(ok({ list: [{
      BODY: "Автобус", CAPACITY: "1957.0000", CAPACITY_LT: "2.0000", CYLINDERS: 4, DATE_END: "1990-09-01", DATE_START: "1981-09-01",
      ENG_CODES: [{ ENG_CODE: "170B (XN1T)", ENG_ID: 2836 }], ENGINE: "Бензиновый двигатель", FUEL: "бензин", GEN_ID: 2473, MFA_ID: 88, MS_ID: 5,
      NAME: "2.0", POWER_KW_FROM: "55.0000", POWER_PS_FROM: "75.0000",
    }] }))).toEqual([{
      body: "Автобус", capacityLiters: "2.0", engineCodes: ["170B (XN1T)"], fuel: "бензин", id: 2473, makeId: 88, modelId: 5, name: "2.0",
      powerPs: 75, yearFrom: 1981, yearTo: 1990,
    }]);
  });

  it("reads VIN candidates from the top-level list", () => {
    const answer = { list: [{ BODY: "Saloon", CAPACITY: "2997", CAPACITY_LT: "3.0000", DATE_FROM: "2002-09-01", DATE_TO: "2005-12-01", ENG_CODES: [{ ENG_CODE: "J30A4" }], FUEL: "Petrol", GEN_ID: 122276, GENERATION: "3.0", MANUFACTURER: "HONDA", MFA_ID: 45, MODEL: "ACCORD VII (CM)", MS_ID: 11444, POWER_PS: "243" }], success: true };
    expect(normalizeVin(answer)).toEqual([expect.objectContaining({ capacityLiters: "3.0", engineCodes: ["J30A4"], genId: 122276, make: "HONDA", model: "ACCORD VII (CM)", msId: 11444, powerPs: 243, yearFrom: 2002 })]);
  });

  it("builds the category tree from the nested and from the flat answer", () => {
    const nested = ok({ list: [{ NAME: "Фильтр", STR_ID: 1, children: [{ NAME: "Топливный фильтр", STR_ID: 2, children: [] }] }] });
    const flat = ok({ list: [{ LEVEL: 2, NAME: "Топливный фильтр", PARENT_ID: 1, STR_ID: 2 }, { LEVEL: 1, NAME: "Фильтр", PARENT_ID: null, STR_ID: 1 }] });
    const tree = [{ children: [{ children: [], id: 2, name: "Топливный фильтр" }], id: 1, name: "Фильтр" }];
    expect(normalizeCategories(nested)).toEqual(tree);
    expect(normalizeCategories(flat)).toEqual(tree);
    expect(normalizeCategories(ok({ list: null, total: 0 }))).toEqual([]);
  });

  it("reads parts, their OE numbers and only the provider's own HTTPS pictures", () => {
    const parts = normalizeParts(ok({ list: [{
      ART_ARTICLE_NR: "W 7030", ART_ID: 9674310, ART_PRODUCT_NAME: "Масляный фильтр", ARTICLE_CRITERIA: [{ CRI_DES: "86 мм", CRI_ID: 1, CRI_NAME: "Высота", CRI_VALUE: "86" }],
      FOUND_VIA: "ArticleNumber", IMAGES: ["https://tecdoc.site/storage/img/4/a.webp"], OEMS: [{ BRAND: "VAG", NUMBER: "5WA407272B", SUP_ID: 253 }], PRODUCT_GROUP: "Масляный фильтр", SUP_BRAND: "MANN-FILTER",
    }, {
      ART_ARTICLE_NR: "OC 90", ART_ID: "", FOUND_VIA: { ARL_BRA_BRAND: "BREMBO", ARL_SEARCH_NUMBER: "OC 90", ARL_TYPE: "IAMNumber" }, IMAGES: ["http://evil.example/x.webp"], SUP_BRAND: "KNECHT",
    }, { ART_ARTICLE_NR: "", SUP_BRAND: "X" }], pagination: { currentPage: 1, hasMore: true, perPage: 50 } }));
    expect(parts).toEqual([
      { artId: 9674310, article: "W 7030", brand: "MANN-FILTER", criteria: [{ name: "Высота", value: "86 мм" }], foundVia: "ArticleNumber", group: "Масляный фильтр", image: "https://tecdoc.site/storage/img/4/a.webp", name: "Масляный фильтр", oems: [{ brand: "VAG", number: "5WA407272B" }] },
      { artId: null, article: "OC 90", brand: "KNECHT", criteria: [], foundVia: "IAMNumber", group: null, image: null, name: "", oems: [] },
    ]);
    expect(hasMorePages(ok({ list: [], pagination: { currentPage: 1, hasMore: true, perPage: 50 } }))).toBe(true);
    expect(hasMorePages(ok({ list: [], pagination: { currentPage: 3, lastPage: 3, perPage: 20, total: 55 } }))).toBe(false);
    expect(normalizeSupplierRows(ok({ list: [{ ART_ARTICLE_NR: "A41628", PT_ID: 914, PT_NAME: "Наконечник поперечной рулевой тяги", SUP_BRAND: "4U Autoparts", SUP_ID: 4420 }] })))
      .toEqual([{ article: "A41628", brand: "4U Autoparts", productGroup: "Наконечник поперечной рулевой тяги", supId: 4420 }]);
  });

  it("groups applicability by make from both documented forms", () => {
    const row = { BRAND: "AUDI", GEN_TOTAL: 35, MFA_ID: 5, MODEL: "A4 B5 (8D2)", MS_ID: 253, SERIES: "A4" };
    const expected = [{ make: "AUDI", models: [{ generations: 35, makeId: 5, model: "A4 B5 (8D2)", msId: 253, series: "A4" }] }];
    expect(normalizeApplicability(ok({ list: { AUDI: [row] }, total: 1 }))).toEqual(expected);
    const detail = normalizePartDetail(ok({ item: { APPLICABILITY: { PASSENGER_CAR: [row] }, ART_ARTICLE_NR: "L1 50", ART_ID: 7846868, ART_PRODUCT_NAME: "АКБ", OEM: [{ ARL_BRAND: "VW", ARL_NUMBER: "1K0 915 105", ARL_TYPE: "OENumber" }], SUP_BRAND: "AAA" } }));
    expect(detail.fitment).toEqual(expected);
    expect(detail.oems).toEqual([{ brand: "VW", number: "1K0 915 105" }]);
    expect(detail.part).toMatchObject({ article: "L1 50", artId: 7846868, brand: "AAA" });
    expect(normalizePartDetail({ success: false })).toEqual({ fitment: [], oems: [], part: null });
  });

  it("finds vehicle ids in an applicability answer whatever its nesting", () => {
    expect(collectGenerationIds(ok({ list: { AUDI: [{ GEN_ID: 11 }, { generations: [{ GEN_ID: "12" }] }] } })).sort()).toEqual([11, 12]);
    expect(collectGenerationIds(ok({ list: [21, 22, "23"], total: 3 })).sort()).toEqual([21, 22, 23]);
    expect(collectGenerationIds(ok({ list: { AUDI: [{ GEN_TOTAL: 35, MS_ID: 253 }] }, total: 65 }))).toEqual([]);
  });

  it("finds a car's categories by the words of a request, for free", () => {
    const tree = [
      { children: [{ children: [], id: 2, name: "Топливный фильтр" }, { children: [], id: 3, name: "Масляный фильтр" }, { children: [], id: 5, name: "Корпус топливного фильтра" }], id: 1, name: "Фильтр" },
      { children: [{ children: [], id: 4, name: "Комплект тормозных колодок" }], id: 9, name: "Тормозная система" },
    ];
    expect(matchCategories(tree, "топливный фильтр").map((match) => match.id)).toEqual([2, 5]);
    expect(matchCategories(tree, "колодки тормозные")[0]).toEqual({ id: 4, leaf: true, name: "Комплект тормозных колодок", path: ["Тормозная система"] });
    expect(matchCategories(tree, "фильтр").map((match) => match.id)).toEqual([1, 3, 2, 5]);
    expect(matchCategories(tree, "на")).toEqual([]);
  });
});
