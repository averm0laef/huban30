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

  it("reads «SAT» only as a whole word in capitals", () => {
    expect(partMakerInName("ST-48510-0D130 Амортизатор передний SAT")).toBe("SAT");
    expect(partMakerInName("Кабель sat антенный 10 м")).toBeNull();
  });
});
