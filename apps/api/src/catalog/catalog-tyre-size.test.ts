import { describe, expect, it } from "vitest";

import { tyreKindBySize } from "./catalog-tyre-size.js";

describe("what a tyre's size says about the tyre", () => {
  // The shop files tyres by the rim: R13–R19 are car tyres (its 1С group «05. А/шина легковая»), the «,5» rims and
  // the inch sizes are truck tyres («03. А/шина грузовая»).
  it.each([
    ["А/шина 205/70R15 КАМА VIATTI-526 (зима)", "shiny-legkovye"],
    ["Автошина 185/70 R14 GOODRIDE", "shiny-legkovye"],
    ["автошина TRIANGLE TE307 195/65R15 91Н лето б/к", "shiny-legkovye"],
    ["А/шина 245/55R19 Three A (ЛЕТО)", "shiny-legkovye"],
    // A commercial «C» tyre on a car rim is filed with the car rims.
    ["А/шина 195R15C ГОФОРМ (зима)", "shiny-legkovye"],
    ["А/шина 185/75R16C Forward Professional 600 104/102 Q TL б/к (всесез)", "shiny-legkovye"],
    ["А/шина 315/70R22,5 KAPSEN HS202 20PR (ведущая)", "shiny-gruzovye"],
    ["А/шина 385/65/22,5", "shiny-gruzovye"],
    ["А/шина 235/75R17,5 143/141J 18PR M+S GOODRIDE", "shiny-gruzovye"],
    ["А/шина 445/45R19.5 б/у Европа МЕГА", "shiny-gruzovye"],
    ["А/ШИНА КАМА-310 10.00-20  КАМАЗ 16PR C/K", "shiny-gruzovye"],
    ["А/шина 12.00R20 КАМА", "shiny-gruzovye"],
  ])("%s → %s", (name, slug) => {
    expect(tyreKindBySize(name)).toBe(slug);
  });

  it.each([
    // No size, or a size that is not a tyre's.
    "А/шина б/у Европа ПЛЮС", "Рк шин City Up СА-787", "Диск колесный 6.5x16 5/114.3 ET45", "Колпаки R15 4 шт",
    'Цепь противоскольжения для грузового автомобиля R-22,5 295/80, тип "лесенка" d-8мм (1 шт.)',
    // Load indexes and prices are not sizes.
    "А/шина зимняя 104/102 Q", "Камера 175/185-14",
  ])("says nothing about «%s»", (name) => {
    expect(tyreKindBySize(name)).toBeNull();
  });
});
