import { describe, expect, it } from "vitest";

import { packLabel, packOf, partSizeKey, partSpecs, sizeLabel, sizeSearch, specLabels, specsConflict } from "./catalog-part-specs.js";

// Names from the owner's 1С base (export of 2026-11-22).
describe("what a 1С name says about the part", () => {
  it.each([
    ["3930 Лампа T4W 24V BA9s Osram", { lampBase: "BA9S", lampType: "T4W", voltage: 24 }],
    ["Лампа галогеновая H7 24V 70W FenixPro Light", { lampType: "H7", voltage: 24, watts: "70" }],
    ["Лампа накаливания H21W 24V BAY9S Bosch", { lampBase: "BAY9S", lampType: "H21W", voltage: 24 }],
    ["Лампа фарная Луч Л-2455/50 24V 50/55W P45t-41", { lampBase: "P45T-41", voltage: 24, watts: "50/55" }],
    ["4PK898 Ремень поликлиновый LYNXauto 4PK0898", { belt: "4PK898" }],
    ["4pk765 Ремень поликлиновый Gates 4PK765", { belt: "4PK765" }],
    ["13X1040 Ремень клиновой AVX13X1040", { belt: "13X1040" }],
    ["Подшипник 6312", { bearing: "6312" }],
    ["Подшипник P6 180312С17(6312 2RS) шариковый радиальный однорядный закрытый Technik", { bearing: "6312-2RS" }],
    ["Подшипник 6204 (204) 20*47*14мм", { bearing: "6204" }],
    ["Сальник задней ступицы внутренний MB Actros, 145x175x15 75443", { axle: "rear", seal: "145X175X15" }],
    ["Сальник первичного вала кпп HONDA CIVIC SD19x35x7L", { seal: "19X35X7" }],
    ["Щетка стеклоочистителя Avantech Aerodynamic 550мм (22\") A-22", { lengthMm: 550 }],
    ["Щетка стеклоочистителя HOFER БЕСКАРКАСНАЯ ассиметричная 380 мм.(15\") 4 адаптера", { lengthMm: 380 }],
    ["АКБ Rocket 95D26R 85 Ач 710А прямая полярность", { capacityAh: 85, polarity: "direct" }],
    ["АКБ Аккумулятор ZEUS SUPER AGM 30 Ач о.п. (YTX30L-BS) 166*127*175", { capacityAh: 30, polarity: "reverse" }],
    ["Масло моторное Totachi Grand Touring SN CF 5w-40 синт. 4л.", { viscosity: "5W-40", volumeLitres: 4 }],
    ["Моторное масло Shell Helix HX8 Syntetic 5W-30 (API SN/CF; ACEA: A3/B3, A3/B4) 1л.", { viscosity: "5W-30", volumeLitres: 1 }],
    ["MA-1172L Опора амортизационной стойки зад лев Febest TSS-053", { axle: "rear", side: "left" }],
    ["Рычаг передний правый нижний", { axle: "front", level: "lower", side: "right" }],
    ["Сайлентблок поперечной тяги зад прав/лев Febest VWAB-002", { axle: "rear" }],
    ["А/шина 225/50R17 NEXEN WInquard ice Plus (зима)", { tyreSize: "225/50R17" }],
    ["А/шина КНР 205/55R16 GOFORM (ЛЕТО)", { tyreSize: "205/55R16" }],
  ])("«%s»", (name, specs) => {
    expect(partSpecs(name)).toEqual(specs);
  });

  it("says nothing it is not sure of", () => {
    // «Солевая» is not «левая»; «R03» is not the right side; a volume «4л/5л» is two volumes.
    expect(partSpecs("Солевая батарейка Luazon Heavy Duty, ААА, R03, спайка, 4 шт. 1740934")).toEqual({});
    expect(partSpecs("3930 10W-40 SL/CF OPTIMAL 4л/5л (полусинт.мотор.масло) Liqui Moly 3930")).toEqual({ viscosity: "10W-40" });
    expect(partSpecs("Ступица колеса | перед прав/лев | DJB")).toEqual({ axle: "front" });
    // A lamp's marking only in a lamp's name; voltages «12/24V» are both.
    expect(partSpecs("Патрон фары H7 12/24V")).toEqual({});
    expect(partSpecs("Фильтр масляный MANN W 914/2")).toEqual({});
    // A car's model is not a bearing's number; four dimensions are not a seal's three.
    expect(partSpecs("Подшипник ступицы 2101 к-т 2 шт. (2101-3103020/25) HOFER")).toEqual({});
    expect(partSpecs("Подшипник 7510 дифференциала УАЗ, газель (ступицы 3302 задний внутренний)")).toEqual({ axle: "rear" });
    expect(partSpecs("Америка (88x114x123x23) Сальник ступицы передней (зеленый) SKF 35066")).toEqual({ axle: "front" });
    // A part that only has bearings or holds a lamp is not that bearing or lamp.
    expect(partSpecs("Рычаг маятниковый ВАЗ 2121 на подшипниках Автореал (6059)")).toEqual({});
    expect(partSpecs("Патрон лампы H7 24V PX26d")).toEqual({ voltage: 24 });
    // A seal is written inner × outer × height, whichever way 1С has it.
    expect(partSpecs("SO-0467 Сальник распределительного вала (47x30x7-R) LYNXauto")).toEqual({ seal: "30X47X7" });
  });
});

describe("two parts that cannot be one", () => {
  it("disagree when a feature both of them have differs", () => {
    expect(specsConflict(partSpecs("Лампа T4W 24V BA9s"), partSpecs("Лампа T4W 12V BA9s"))).toBe(true);
    expect(specsConflict(partSpecs("Опора стойки перед лев"), partSpecs("Опора стойки перед прав"))).toBe(true);
    expect(specsConflict(partSpecs("Щетка стеклоочистителя 600 мм"), partSpecs("Щетка стеклоочистителя 650 мм"))).toBe(true);
  });

  it("agree when the features they share are the same, or one of them says nothing", () => {
    expect(specsConflict(partSpecs("Лампа T4W 24V BA9s"), partSpecs("Лампа T4W 24V"))).toBe(false);
    expect(specsConflict(partSpecs("Опора стойки перед лев"), partSpecs("Опора стойки"))).toBe(false);
    // Another volume of the same oil is another pack, not another part.
    expect(specsConflict(partSpecs("Масло 5W-40 4л"), partSpecs("Масло 5W-40 1л"))).toBe(false);
  });
});

describe("the standard size any maker's part of it fits", () => {
  it("is known for belts, lamps, bearings, seals and tyres when every part of it is", () => {
    expect(partSizeKey(partSpecs("4PK898 Ремень поликлиновый LYNXauto"))).toBe("belt:4PK898");
    expect(partSizeKey(partSpecs("3930 Лампа T4W 24V BA9s Osram"))).toBe("lamp:T4W:24:BA9S");
    expect(partSizeKey(partSpecs("Лампа T4W 24V"))).toBeNull();
    expect(partSizeKey(partSpecs("Подшипник 6204-2RS"))).toBe("bearing:6204-2RS");
    expect(partSizeKey(partSpecs("Сальник 35x50x8"))).toBe("seal:35X50X8");
    expect(partSizeKey(partSpecs("А/шина 205/55R16 GOFORM"))).toBe("tyre:205/55R16");
    expect(partSizeKey(partSpecs("Масло 5W-40 4л"))).toBeNull();
  });

  it("is written for the customer", () => {
    expect(specLabels(partSpecs("3930 Лампа T4W 24V BA9s Osram"))).toEqual([["Тип лампы", "T4W"], ["Напряжение", "24 В"], ["Цоколь", "BA9s"]]);
    expect(specLabels(partSpecs("MA-1172L Опора амортизационной стойки зад лев"))).toEqual([["Сторона", "левая"], ["Ось", "задняя"]]);
    expect(specLabels(partSpecs("АКБ Rocket 85 Ач 710А обратная полярность"))).toEqual([["Ёмкость", "85 А·ч"], ["Полярность", "обратная"]]);
  });
});

describe("finding the parts of one standard size among the names", () => {
  it("narrows the names a database reads before the names are read in full", () => {
    expect(sizeSearch("belt:4PK898")).toEqual({ all: ["%898%"], any: ["%pk%"] });
    expect(sizeSearch("belt:13X1040")).toEqual({ all: ["%1040%"], any: ["%13%"] });
    expect(sizeSearch("lamp:H7:24:PX26D")).toEqual({ all: ["%24%"], any: ["%h7%", "%н7%"] });
    expect(sizeSearch("lamp:T4W:24:BA9S")).toEqual({ all: ["%24%"], any: ["%t4w%"] });
    expect(sizeSearch("bearing:6204-2RS")).toEqual({ all: [], any: ["%6204%"] });
    expect(sizeSearch("seal:35X50X8")).toEqual({ all: ["%50%"], any: ["%35%"] });
    expect(sizeSearch("tyre:205/55R16")).toEqual({ all: [], any: ["%205/55%"] });
    expect(sizeSearch("anything")).toBeNull();
  });

  it("names the size for the customer", () => {
    expect(sizeLabel(partSpecs("3930 Лампа T4W 24V BA9s Osram"))).toBe("T4W 24 В BA9s");
    expect(sizeLabel(partSpecs("4PK898 Ремень поликлиновый LYNXauto"))).toBe("4PK898");
    expect(sizeLabel(partSpecs("Сальник 35x50x8"))).toBe("35×50×8 мм");
    expect(sizeLabel(partSpecs("А/шина 205/55R16 GOFORM"))).toBe("205/55 R16");
    expect(sizeLabel(partSpecs("Фильтр масляный"))).toBeNull();
  });
});


// Names from the owner's 1С base (export of 2026-11-22).
describe("the pack a liquid is sold in", () => {
  it("reads two packs of one oil as one product: only the amount differs", () => {
    const one = packOf("9066 5W-50 Synthoil High Tech 1л", "9066");
    const four = packOf("9067 5W-50 Synthoil High Tech 4л", "9067");
    expect(one).toMatchObject({ amount: 1, unit: "l" });
    expect(four).toMatchObject({ amount: 4, unit: "l" });
    expect(four!.key).toBe(one!.key);
  });

  it("does not mind the word order, the box count or how the litre is written", () => {
    const key = packOf("Масло моторное Totachi Grand Touring SN CF 5w-40 синт. 4л.", "4562374690820")!.key;
    expect(packOf("Моторное масло Totachi Grand Touring SN CF 5W-40 синт. 1 л 1/12", "4562374690813")!.key).toBe(key);
    expect(packOf("Масло моторное Totachi Grand Touring SN CF 5w-40 синт. 20 литров", null)).toMatchObject({ amount: 20, key, unit: "l" });
    expect(packOf("Масло моторное Totachi Grand Touring SN CF 5w-40 синт. 0,946L 1*4", null)).toMatchObject({ amount: 0.946, key });
  });

  it("knows an oil by its viscosity when the name does not say «масло»", () => {
    expect(packOf("ALPHA'S 10W40 SN (бензин, синтетика) 1л", "709741")).toMatchObject({ amount: 1, unit: "l" });
  });

  it("keeps another viscosity, line or approval another product", () => {
    const key = packOf("Масло моторное Totachi Grand Touring SN CF 5w-40 синт. 4л", null)!.key;
    expect(packOf("Масло моторное Totachi Grand Touring SN CF 5w-30 синт. 4л", null)!.key).not.toBe(key);
    expect(packOf("Масло моторное Totachi Eco Gasoline SN CF 5w-40 синт. 4л", null)!.key).not.toBe(key);
    expect(packOf("Масло моторное Totachi Grand Touring SP CF 5w-40 синт. 4л", null)!.key).not.toBe(key);
  });

  it("weighs grease and the like in kilograms, apart from litres", () => {
    expect(packOf("Антифриз Felix Carbox G12+ красный 10 кг", null)).toMatchObject({ amount: 10, unit: "kg" });
    expect(packOf("Антифриз Felix Carbox G12+ красный 5кг", null)).toMatchObject({ amount: 5, unit: "kg" });
  });

  it("says nothing of a part that is not a liquid, or of a name with two amounts or none", () => {
    expect(packOf("Фильтр масляный двигателя 4л MANN W 712/75", "W71275")?.amount ?? null).not.toBe(712);
    expect(packOf("Колодки тормозные передние Toyota Corolla", null)).toBeNull();
    expect(packOf("Масло моторное Mobil Super 3000 5W-40 4л/5л", null)).toBeNull();
    expect(packOf("Масло моторное Mobil Super 3000 5W-40", null)).toBeNull();
    expect(packOf("Канистра 20л", null)).toBeNull();
  });

  it("names a pack the way a price tag does", () => {
    expect(packLabel({ amount: 4, unit: "l" })).toBe("4 л");
    expect(packLabel({ amount: 0.5, unit: "l" })).toBe("0,5 л");
    expect(packLabel({ amount: 10, unit: "kg" })).toBe("10 кг");
  });
});
