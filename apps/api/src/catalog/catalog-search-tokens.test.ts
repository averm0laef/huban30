import { describe, expect, it } from "vitest";

import { catalogSearchIdentity } from "./catalog-search-identity.js";
import { joinMeasurements, lightRussianStem, searchTokenPlan } from "./catalog-search-tokens.js";

function texts(query: string, word = 1) {
  return searchTokenPlan(query).alternatives.filter((alternative) => alternative.word === word).map((alternative) => alternative.text);
}

function pattern(query: string, word = 1) {
  const found = searchTokenPlan(query).alternatives.find((alternative) => alternative.word === word && alternative.pattern);
  return new RegExp(found!.pattern!, "u");
}

describe("searchTokenPlan", () => {
  it("keeps the literal word first and only ever adds alternatives", () => {
    expect(texts("фильтр")[0]).toBe("фильтр");
    expect(searchTokenPlan("масляный фильтр").words).toEqual(["масляный", "фильтр"]);
  });

  it("reads a word typed on the wrong keyboard layout", () => {
    expect(texts("vfckj")).toContain("масло");
    expect(texts("abkmnh")).toContain("фильтр");
    // "ajkmnh" is "фольтр" -- one letter off, matched as a close spelling.
    expect(searchTokenPlan("ajkmnh").alternatives).toContainEqual(expect.objectContaining({ text: "фольтр", fuzzy: true }));
    expect(texts("ищыср")).toContain("bosch");
  });

  it("stems Russian word forms, including the fleeting vowel Snowball misses", () => {
    expect(lightRussianStem("колодок")).toBe("колодк");
    expect(lightRussianStem("щеток")).toBe("щетк");
    expect(lightRussianStem("фильтров")).toBe("фильтр");
    expect(lightRussianStem("масляных")).toBe("маслян");
    expect(lightRussianStem("диск")).toBeNull();
    expect(texts("колодок")).toContain("колодк");
  });

  it("reads Latin names and codes typed in Cyrillic", () => {
    expect(texts("хеликс")).toContain("helix");
    expect(texts("гдб3332")).toContain("gdb3332");
    expect(texts("весту")).toContain("vest");
    expect(texts("шел")).toContain("shel");
  });

  it("understands everyday names of parts and fluids", () => {
    expect(texts("акб")).toContain("аккумулятор");
    expect(texts("дворники")).toEqual(expect.arrayContaining(["щетк", "стеклоочист"]));
    expect(texts("незамерзайка")).toContain("омыват");
    expect(texts("тормозуха")).toEqual(expect.arrayContaining(["dot", "тормозная жидкость"]));
    expect(searchTokenPlan("тормозуха").alternatives.every((alternative) => !alternative.fuzzy)).toBe(true);
    expect(texts("лампочка")).toContain("ламп");
  });

  it("expands brand spellings in both scripts", () => {
    expect(texts("бош")).toEqual(expect.arrayContaining(["bosch", "бош"]));
    expect(texts("lukoil")).toContain("лукойл");
    expect(texts("лемфордер")).toContain("lemförder");
    expect(searchTokenPlan("ликви моли").words).toEqual(["liquimoly"]);
    expect(texts("ликви моли")).toContain("liqui moly");
    expect(texts("тойота")).toContain("toyota");
    expect(texts("хендай")).toContain("hyundai");
  });

  it("reads Cyrillic look-alikes inside codes and Latin words as Latin", () => {
    expect(texts("Н7")).toContain("h7");
    expect(texts("МАNN")).toContain("mann");
  });

  it("matches oil viscosity in any spelling but never a neighbouring grade", () => {
    for (const query of ["5w40", "5W-40", "5W 40", "5в40", "5ц40", "5 w - 40"]) {
      expect(joinMeasurements(query.toLowerCase())).toBe("5w-40");
    }
    const viscosity = pattern("5w40");
    expect(viscosity.test("масло 5w-40 4 л")).toBe(true);
    expect(viscosity.test("sae 5w40 4л")).toBe(true);
    expect(viscosity.test("масло 15w-40")).toBe(false);
    expect(viscosity.test("масло 5w-30")).toBe(false);
  });

  it("matches volumes and sizes as whole numbers with their unit", () => {
    const litres = pattern("масло 4 литра", 2);
    expect(litres.test("масло 5w-40 4 л")).toBe(true);
    expect(litres.test("масло 4л")).toBe(true);
    expect(litres.test("масло 14 л")).toBe(false);
    expect(litres.test("масло 0,4 л")).toBe(false);
    expect(litres.test("4 лампы")).toBe(false);
    const half = pattern("0,5 л");
    expect(half.test("жидкость тормозная dot 4 0,5 л")).toBe(true);
    const wiper = pattern("щетка 600 мм", 2);
    expect(wiper.test("aerotwin 600/450 мм")).toBe(true);
    const number = pattern("varta 60", 2);
    expect(number.test("60ач 540а")).toBe(true);
    expect(number.test("560408054")).toBe(false);
  });

  it("reads everyday names of parts as what the catalogue calls them", () => {
    // Measured on the owner's assortment (22.11.2026): each of these found nothing, or the wrong goods.
    expect(texts("гранаты")).toContain("шрус");
    expect(texts("косточки")).toContain("стойка стабилизатора");
    expect(texts("саленблок")).toEqual(expect.arrayContaining(["сайлентблок", "сайленблок"]));
    expect(texts("бронепровода")).toContain("высоковольт");
    expect(texts("вд40")).toContain("wd-40");
    expect(texts("вэдэшка")).toContain("wd-40");
    expect(texts("секретки")).toContain("секрет");
    expect(texts("пахучка")).toEqual(expect.arrayContaining(["ароматизатор", "освежител"]));
    expect(texts("балонник")).toEqual(expect.arrayContaining(["баллонн", "балонн"]));
  });

  it("reads «воздушник», «салонник», «топливник» as the filter, not as everything with that adjective", () => {
    for (const [word, phrase] of [["воздушник", "фильтр возд"], ["салонник", "фильтр салон"], ["топливник", "фильтр топл"]] as const) {
      const plan = searchTokenPlan(word);
      expect(plan.leads, word).toEqual(["фильтр"]);
      expect(texts(word), word).toContain(phrase);
      // The everyday word itself is not looked for by close spelling: «воздушник» is close to «воздушный».
      expect(plan.alternatives.every((alternative) => !alternative.fuzzy), word).toBe(true);
    }
  });

  it("caps the plan so a pasted paragraph stays cheap", () => {
    const plan = searchTokenPlan("а бб вв гг дд ее жж зз ии кк лл мм");
    expect(plan.words.length).toBeLessThanOrEqual(8);
  });
});

describe("catalogSearchIdentity with measurements", () => {
  it.each(["5в40", "vfckj 5w40", "масло 4 л", "W914/2 4л"])("does not treat %s as a concrete article", (query) => {
    expect(catalogSearchIdentity(query).articleOnly).toBe(false);
  });

  it("reads a mixed-script brand before a concrete article", () => {
    expect(catalogSearchIdentity("МАNN W914/2")).toEqual({ article: "W9142", brandKeys: ["MANN", "MANNFILTER"], articleOnly: true });
    expect(catalogSearchIdentity("lukoil 207465").brandKeys).toEqual(["ЛУКОЙЛ", "LUKOIL"]);
  });
});
