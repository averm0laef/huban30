import { describe, expect, it } from "vitest";

import { partMakerInName } from "./catalog-part-makers.js";

// The owner's 1С base names no manufacturer: the brand filter of the catalogue stayed empty for 42 723 items. The
// maker stands in the name itself, though — these are names of that base, read by eye on 23.11.2026.
describe("the maker of a part, read from its name", () => {
  it.each([
    ["SL-1767 Втулка амортизатора зад прав/лев SUFIX", "SUFIX"],
    ["Колодка тормозная передняя 2101 (4 шт.) HOFER", "HOFER"],
    ["Стойка стабилизатора |перед прав/лев| IHOYEI 48820-33010 (CTR CLT-34)", "IHOYEI"],
    ["02-134 TG-2160 Пыльник ШРУСа Ti-Guar", "Ti-Guar"],
    ["Втулка рессоры Ti-Guar TG-54045-0T000", "Ti-Guar"],
    ["краска-спрей ABRO Masters черный глянцевый", "ABRO"],
    ["Оплетка CarFort Silver, мягкая текстура, черная, S (1/35)", "CarFort"],
    ["TSB-786 Втулка амортизатора TG-90385-16004 ST-90385-16004 LYNXauto B8282", "LYNXauto"],
    ["Фильтр масляный MANN-FILTER W 914/2", "MANN-FILTER"],
    ["антифриз Totachi SUPER LLC -50C зеленый 2л.", "TOTACHI"],
    ["Лампа автомобильная Skyway Спутник W1.2W, 12 В, 1.2 Вт", "SKYWAY"],
    ["Клипса крепежная TORSO, универсальная, КП-0012 1293458", "TORSO"],
    ["Сальник NOK 90311-38034", "NOK"],
  ])("«%s» → %s", (name, maker) => {
    expect(partMakerInName(name)).toBe(maker);
  });

  it("names the first maker when the name lists another one as a cross", () => {
    expect(partMakerInName("C4T-52341 Пружина ходовой части | перед прав/лев | OBK KYB RK3344")).toBe("OBK");
  });

  it("does not take the make of the car for the maker of the part", () => {
    expect(partMakerInName("Фильтр масляный Toyota Corolla 1.6")).toBeNull();
    expect(partMakerInName("Колодки тормозные Nissan X-Trail T31 передние")).toBeNull();
    expect(partMakerInName("Свеча зажигания Лада Веста")).toBeNull();
  });

  it("does not find a maker inside another word or a code", () => {
    // «SAT» is a maker; «SATURN», «ST-…» and a truck series «FH/FM/RVI» are not.
    expect(partMakerInName("Болт колесный M22*1.5*124/114 FH/FM/RVI 10.0128")).toBeNull();
    expect(partMakerInName("Лампа SATURN H4 12V")).toBeNull();
    expect(partMakerInName("Набор ключей 12 предметов")).toBeNull();
  });

  it("does not take a maker named in brackets: there it is the number of an analogue, not who made the part", () => {
    // Names of the owner's base: the part is by XBAOO, by an unnamed maker, by JS Asakashi — the brackets name crosses.
    expect(partMakerInName("Опора шаровая | перед прав/лев | XBAOO 51220-SAA-A01 ( CTR CBHO-44)")).toBeNull();
    expect(partMakerInName("C-419 Фильтр масляный MAZDA TITAN (Sakura C-1541) (JS Asakashi C522J) ISUZU 4HF1 4HG1")).toBeNull();
    expect(partMakerInName("Диск тормозной передний CARINA/CALDINA/CORONA (TRW DF7248) K001662")).toBeNull();
  });

  it("still takes the maker standing outside the brackets", () => {
    expect(partMakerInName("CVKD-9 Сайлентблок рычага подвески | перед прав/лев | 09319-12039 CTR   (Febest SZAB-036)")).toBe("CTR");
    expect(partMakerInName("GS8714 Колодки тормозные барабанные | зад | TRW (ST-46550-33010  SAT)")).toBe("TRW");
  });

  it("reads «SAT» only as a whole word in capitals", () => {
    expect(partMakerInName("ST-48510-0D130 Амортизатор передний SAT")).toBe("SAT");
    expect(partMakerInName("Кабель sat антенный 10 м")).toBeNull();
  });
});
