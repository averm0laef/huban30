import { describe, expect, it } from "vitest";

import { combinedVerdict, groupCars, verdictFor } from "./umapi-fitment.js";
import { bracketedNumbers, umapiCatalogueApplies, umapiPhotoApplies } from "@an30/contracts";

import { partCandidates, sameMaker } from "./umapi-identify.js";
import { normalizeArticleRows, normalizeBrandRows, normalizeCarLinks, normalizeCrossInfo, normalizeMedias } from "./umapi-normalize.js";

// Shapes follow the UMAPI OpenAPI 2.1.1 schemas; values are made up for the tests (no paid call in tests).
const LINKS = { PC: [
  { CI_FROM: "2006-06-01", CI_TO: "2018-12-01", MANUFACTURER: "MERCEDES-BENZ", MFA_ID: 74, MODEL_SERIES: "SPRINTER 3,5-t Фургон (B906)", MS_ID: 5590, PASSENGER_CAR: "313 CDI", PC_ID: 32001 },
  { CI_FROM: "2006-06-01", MANUFACTURER: "MERCEDES-BENZ", MFA_ID: 74, MODEL_SERIES: "SPRINTER 3,5-t Фургон (B906)", MS_ID: 5590, PASSENGER_CAR: "316 CDI", PC_ID: 32002 },
  { CI_FROM: "2006-04-01", CI_TO: "2016-12-01", MANUFACTURER: "VW", MFA_ID: 121, MODEL_SERIES: "CRAFTER 30-50 Фургон (2E_)", MS_ID: 5833, PASSENGER_CAR: "2.5 TDI", PC_ID: 40001 },
  { CI_FROM: "2006-04-01", MANUFACTURER: "VW", MODEL_SERIES: "broken row without PC_ID" },
] };

describe("UMAPI answers", () => {
  it("reads brand, catalogue article, car link and photo rows, dropping broken ones", () => {
    expect(normalizeBrandRows([{ BRAND: "FILTRON", BRA_ID: 51, DISPLAY_NR: "K 1288", TITLE: "Фильтр, воздух во внутреннем пространстве", TYPE: "ArticleNumber" }, { BRAND: "" }]))
      .toEqual([{ article: "K 1288", brand: "FILTRON", brandId: 51, title: "Фильтр, воздух во внутреннем пространстве", type: "ArticleNumber" }]);
    expect(normalizeArticleRows({ data: [{ ARTICLE_NR: "K 1288", ART_ID: "7001", BRAND: "FILTRON", COMPLETE_DES: "Фильтр салона" }, { ART_ID: 0 }], rows: 2 }))
      .toEqual([{ artId: 7001, article: "K 1288", brand: "FILTRON", name: "Фильтр салона", supId: null }]);
    const links = normalizeCarLinks(LINKS);
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({ car: "313 CDI", make: "MERCEDES-BENZ", makeId: 74, model: "SPRINTER 3,5-t Фургон (B906)", msId: 5590, pcId: 32001, yearFrom: 2006, yearTo: 2018 });
    expect(normalizeMedias({ MEDIAS: [{ FILE_NAME: "b.jpg", SORT: 2, SUP_ID: 256 }, { FILE_NAME: "a.png", SORT: 1 }, { FILE_NAME: "manual.pdf", SORT: 0 }] }))
      .toEqual([{ file: "a.png", supId: null }, { file: "b.jpg", supId: 256 }]);
    expect(normalizeCrossInfo({ article: "K 1288", brand: "FILTRON", catalogId: 7705805, td: { ARTICLE_NR: "K 1288", ART_ID: 7705805, BRAND: "FILTRON", COMPLETE_DES: "Фильтр", MEDIAS: [{ FILE_NAME: "x.webp", SUP_ID: 256 }] } }))
      .toEqual({ article: "K 1288", artId: 7705805, brand: "FILTRON", medias: [{ file: "x.webp", supId: 256 }], title: "Фильтр" });
    expect(normalizeCrossInfo({ message: "not found" })).toBeNull();
    expect(normalizeCarLinks(null)).toEqual([]);
  });
});

describe("which part a product is", () => {
  it("reads makers and numbers from the name's brackets, not sizes or bare words", () => {
    expect(bracketedNumbers("Фильтр салона MB SPRINTER/VW CRAFTER 06- AFW1272 (FILTRON K1288, MANN CU3569) AFW1272"))
      .toEqual([{ article: "K1288", brand: "FILTRON" }, { article: "CU3569", brand: "MANN" }]);
    expect(bracketedNumbers("Масло (синтетика 4л)")).toEqual([]);
    expect(bracketedNumbers("Колодки (передние)")).toEqual([]);
  });

  it("asks the catalogue about parts without a maker of ours too, never about oils or tools", () => {
    expect(umapiCatalogueApplies({ brand: null, name: "Фильтр салона AFW1272 (FILTRON K1288, MANN CU3569)", section: "filtry", sku: "AFW1272" })).toBe(true);
    expect(umapiCatalogueApplies({ brand: null, name: "Хомут 20-22", section: "homuty", sku: "20-22" })).toBe(false);
    expect(umapiCatalogueApplies({ brand: "LIQUI MOLY", name: "Масло 5W-40", section: "motornye-masla", sku: "3930" })).toBe(false);
    expect(umapiCatalogueApplies({ brand: "TRW", name: "Колодки", section: "tormoznaya-sistema", sku: "GDB1550" })).toBe(true);
  });

  it("asks for a photo of an oil or a fluid only of the makers the catalogue has (measured 24.11.2026)", () => {
    expect(umapiPhotoApplies({ brand: "LIQUI MOLY", name: "2322 5W-30 TOP TEC 4400 5л", section: "motornye-masla", sku: "2322" })).toBe(true);
    expect(umapiPhotoApplies({ brand: "Mobil", name: "Mobil Super 3000 XE 5w30 4 л", section: "motornye-masla", sku: "153018" })).toBe(true);
    expect(umapiPhotoApplies({ brand: "MILES", name: "Антифриз MILES G11 1кг", section: "antifriz", sku: "AFGR001" })).toBe(true);
    // Measured: none of these makers' oils is in the catalogue — a button would only spend a press.
    expect(umapiPhotoApplies({ brand: "Shell", name: "Масло моторное Shell Helix HX7 5W-40 4л", section: "motornye-masla", sku: "550040341" })).toBe(false);
    expect(umapiPhotoApplies({ brand: "TOTACHI", name: "Антифриз TOTACHI -40C 4л", section: "antifriz", sku: "41604" })).toBe(false);
    expect(umapiPhotoApplies({ brand: null, name: "Тосол А-40 (200 кг)", section: "antifriz", sku: "AT40200" })).toBe(false);
    // A part keeps the rule of the other buttons; the car list for an oil stays off.
    expect(umapiPhotoApplies({ brand: "TRW", name: "Колодки", section: "tormoznaya-sistema", sku: "GDB1550" })).toBe(true);
    expect(umapiCatalogueApplies({ brand: "LIQUI MOLY", name: "Масло", section: "motornye-masla", sku: "2322" })).toBe(false);
  });

  it("asks for our own brand and number first, and for bracketed numbers only without a brand of ours", () => {
    const name = "Фильтр салона MB SPRINTER AFW1272 (FILTRON K1288, MANN CU3569)";
    expect(partCandidates({ brand: null, name, sku: "AFW1272" })).toEqual([
      { article: "AFW1272", brand: null, via: "own" },
      { article: "K1288", brand: "FILTRON", via: "name" },
      { article: "CU3569", brand: "MANN", via: "name" },
    ]);
    expect(partCandidates({ brand: "TRW", name: "Колодки (TRW GDB1550)", sku: "GDB1550" })).toEqual([{ article: "GDB1550", brand: "TRW", via: "own" }]);
  });

  it("treats the short and the catalogue spelling of a maker as one", () => {
    expect(sameMaker("MANN", "MANN-FILTER")).toBe(true);
    expect(sameMaker("Mann filter", "MANN-FILTER")).toBe(true);
    expect(sameMaker("FILTRON", "FILTRON")).toBe(true);
    expect(sameMaker("FILTRON", "MANN-FILTER")).toBe(false);
  });
});

describe("compatibility", () => {
  const links = normalizeCarLinks(LINKS);

  it("fits the engine, fits the model with another engine, the model only, or is not listed", () => {
    expect(verdictFor(links, { msId: 5590, pcId: 32001 })).toBe("fits");
    expect(verdictFor(links, { msId: 5590, pcId: 99999 })).toBe("other_engine");
    expect(verdictFor(links, { msId: 5590, pcId: null })).toBe("model");
    expect(verdictFor(links, { msId: 1, pcId: 2 })).toBe("not_listed");
  });

  it("lets our own number decide, and analogue numbers only when they agree", () => {
    expect(combinedVerdict([{ verdict: "not_listed", via: "own" }, { verdict: "fits", via: "name" }])).toBe("not_listed");
    expect(combinedVerdict([{ verdict: "fits", via: "name" }, { verdict: "fits", via: "name" }])).toBe("fits");
    expect(combinedVerdict([{ verdict: "fits", via: "name" }, { verdict: "not_listed", via: "name" }])).toBeNull();
  });

  it("groups the cars by make and model with the customer's car first", () => {
    const { makes, total } = groupCars(links, { msId: 5590, pcId: 32001 });
    expect(total).toBe(3);
    expect(makes.map((make) => [make.make, make.mine])).toEqual([["MERCEDES-BENZ", true], ["VW", false]]);
    expect(makes[0]!.models[0]).toMatchObject({ mine: true, model: "SPRINTER 3,5-t Фургон (B906)", yearFrom: 2006, yearTo: null });
    expect(makes[0]!.models[0]!.cars.map((car) => [car.name, car.mine])).toEqual([["313 CDI", true], ["316 CDI", false]]);
  });
});
