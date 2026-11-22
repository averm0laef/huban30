import { describe, expect, it } from "vitest";

import { STOREFRONT_TAXONOMY } from "@an30/contracts";

import { originalNumberShelves, originalPartCode, shelfByOriginalNumber } from "./catalog-original-numbers.js";

const TREE = new Set(STOREFRONT_TAXONOMY.flatMap((section) => [section.slug, ...section.children.map((child) => child.slug)]));

describe("the part code of a Japanese or Korean original number", () => {
  // «48815-60111»: the first five digits say what the part is, the rest which car it is for.
  it.each([
    ["48815-10090 Втулка стабилизатора зад прав/лев КОРОБКА 9", "48815"],
    ["Втулка TG-48815-60121 * Ti·GUAR TSB-797", "48815"],
    ["ST-42450-52060 Ступичный узел задн. TOYOTA VITZ KSP90", "42450"],
    ["Болт головки блока цилиндров TOYOTA 4 / 5E (длинный) 90 SAT STP-90910-02101", "90910"],
    ["NSB-T31R17 Втулка TG-54613-JG17C * Ti·GUAR", "54613"],
    ["(04111-16230) Ремкомплект двигателя 4A-FE", "04111"],
  ])("%s → %s", (text, code) => {
    expect(originalPartCode(text)).toBe(code);
  });

  it.each([
    "Масло моторное 5W-40 4 л", "А/шина 215/55R17 Three A (ЛЕТО)", "Шланги системы отопления для а/м ВАЗ 2101-2107 2101-8101200Р",
    "Футорка для грузовика MASUMA OEM_8-94365-143-1 Isuzu", "болт заднего колеса 40-3104021 МТЗ", "00-00021038", "Фильтр 12345-123",
    "Ремень 6PK1700", "123456-12345", "12345-123456",
  ])("finds none in «%s»", (text) => {
    expect(originalPartCode(text)).toBeNull();
  });
});

describe("the shelf an original number points at", () => {
  it("answers only with slugs of the storefront tree", () => {
    expect([...originalNumberShelves().values()].filter((slug) => !TREE.has(slug))).toEqual([]);
  });

  it.each([
    // The cases the shop's base has in its queue: the name says only «Втулка».
    ["Втулка TG-48815-60121 * Ti·GUAR TSB-797", "stabilizator"],
    ["Втулка TG-48818-06100* Ti·GUAR TSB-743", "stabilizator"],
    ["NSB-T31R17 Втулка TG-54613-JG17C * Ti·GUAR", "stabilizator"],
    ["04111-11090 5E", "prokladki-i-salniki"],
    ["ST-42450-52060", "stupitsy-i-podshipniki"],
    // Codes that reached the threshold after the dictionary learnt more names (scripts/catalog-placement/original-number-codes.mjs).
    ["15208-65F0A", "maslyanye-filtry"],
    ["04152-YZZA1", "maslyanye-filtry"],
    ["Комплект TG-48190-25010 TiGuar", "rychagi"],
  ])("%s → %s", (text, slug) => {
    expect(shelfByOriginalNumber(text)).toBe(slug);
  });

  it.each([
    // Honda writes «51306-S47-003»: five digits, three characters, three characters (scripts/catalog-placement/
    // original-number-codes.mjs counts these apart; 12 bushes of the base's queue carry nothing but this number).
    ["HSB-051 Втулка TG-51306-S47-003 * Ti·GUAR", "stabilizator"],
    ["Втулка TG-51306-SDA-A03* Ti·GUAR КОРОБКА 2", "stabilizator"],
    ["ST-17220-5R0-008", "vozdushnye-filtry"],
    ["Шланг TG-01464-S2X-000", "tormoznye-shlangi"],
  ])("Honda's format: %s → %s", (text, slug) => {
    expect(shelfByOriginalNumber(text)).toBe(slug);
  });

  it("keeps Honda's codes apart from the other makers'", () => {
    // 42200 is a hub in Honda's numbering and 48815 a stabiliser bush in Toyota's: neither answers for the other format.
    expect(shelfByOriginalNumber("42200-S10-008")).toBe("stupitsy-i-podshipniki");
    expect(shelfByOriginalNumber("ST-42200-12345")).toBeNull();
    expect(shelfByOriginalNumber("48815-60111")).toBe("stabilizator");
    expect(shelfByOriginalNumber("48815-S47-003")).toBeNull();
  });

  it.each(["Фильтр 12345-123", "8-94365-143-1", "51306-S47-0034", "151306-S47-003", "51306-S47-003-1"])("finds no Honda number in «%s»", (text) => {
    expect(shelfByOriginalNumber(text)).toBeNull();
  });

  it("does not answer for a code that names different parts", () => {
    // Toyota's 90919 is ignition coils, high-voltage leads and sensors alike.
    expect(shelfByOriginalNumber("ST-90919-02249")).toBeNull();
  });

  it("does not answer when there is no original number", () => {
    expect(shelfByOriginalNumber("Втулка желтая ИПСУМ")).toBeNull();
  });
});
