import { describe, expect, it } from "vitest";

import { cleanGroupName, isServiceGroupName } from "./catalog-group-names.js";

describe("the name of a 1С group without the owner's numbering and notes", () => {
  it.each([
    ["01.04 Ф/маслянный", "Ф/маслянный"],
    ["01.04 Ф/маслянный 2023", "Ф/маслянный"],
    ["01.05 Ф/воздушный ОТОШЛО", "Ф/воздушный"],
    ["01.03 Ф/топливный (Ш)", "Ф/топливный"],
    ["01.14. Шаровая опора", "Шаровая опора"],
    ["02.21.01 Ступица подшип", "Ступица подшип"],
    ["11. Шинка", "Шинка"],
    ["02 Прокладка ГБЦ", "Прокладка ГБЦ"],
    ["01.2025 ТОРМОЗНЫЕ КОЛОДКИ", "ТОРМОЗНЫЕ КОЛОДКИ"],
    ["САЙЛЕНТБЛОК 2022", "САЙЛЕНТБЛОК"],
    ["ТЯГИ 2022 1508", "ТЯГИ 1508"],
    ["ВТУЛКИ 1 КОРОБКА", "ВТУЛКИ"],
    ["15. + Фитинг", "+ Фитинг"],
  ])("%s → %s", (name, cleaned) => {
    expect(cleanGroupName(name)).toBe(cleaned);
  });

  it.each([
    // A number that is the name itself stays; so does a year glued to a dot (the root group «...2022» has no
    // letters either way, and a name without letters is not read at all).
    "12V (12 Вольт)", "4PK", "8x", "Электрика 220V", "Амортизаторы KYB", "...2022",
  ])("leaves «%s» as it is", (name) => {
    expect(cleanGroupName(name)).toBe(name);
  });
});

describe("a 1С group that holds the workshop's price list, not goods", () => {
  it.each(["Шиномонтажа", "СТО", "Услуги доставки", "Услуги спецтехники", "Ремонт грузовой", "Изготовление РВД"])("%s", (name) => {
    expect(isServiceGroupName(name)).toBe(true);
  });

  it.each(["Ремонтные комплекты суппорта", "11. Шинка", "Стойки", "Автохимия", "02.09 Суппорт рем. ком.", "Монтажный инструмент"])("not %s", (name) => {
    expect(isServiceGroupName(name)).toBe(false);
  });
});
