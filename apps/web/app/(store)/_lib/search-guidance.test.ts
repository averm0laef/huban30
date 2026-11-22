import { describe, expect, it } from "vitest";

import { directSearchProduct, searchServiceLinks, suggestedCatalogSections } from "./search-guidance";

const labels = (query: string) => suggestedCatalogSections(query).map((section) => section.label);

describe("suggestedCatalogSections", () => {
  it.each([
    ["масло 5w40", "Моторные масла"],
    ["5W-30", "Моторные масла"],
    ["vfckj", "Моторные масла"],
    ["ajkmnh", "Фильтры"],
    ["фильр", "Фильтры"],
    ["калодки", "Тормозная система"],
    ["тормозных колодок", "Тормозная система"],
    ["аккамулятор", "Аккумуляторы"],
    ["акб", "Аккумуляторы"],
    ["75w90", "Трансмиссионные масла"],
    ["Н7", "Автолампы"],
    ["щётки", "Щётки стеклоочистителя"],
    ["дворники", "Щётки стеклоочистителя"],
    ["антифирз", "Антифриз"],
  ])("offers a section for %s", (query, label) => {
    expect(labels(query)).toContain(label);
  });

  it("does not offer a section for an article number", () => {
    expect(labels("W914/2")).toEqual([]);
    expect(labels("0 986 494 104")).toEqual([]);
  });

  it("links to the section query, never repeating the query itself", () => {
    expect(labels("фильтр")).not.toContain("Фильтры");
    expect(suggestedCatalogSections("ajkmnh")[0]?.href).toBe("/catalog?q=%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80");
  });
});

describe("directSearchProduct", () => {
  const item = { sku: "W 914/2", slug: "mann-w-914-2" };
  it("opens the product when an article in any spelling finds exactly it", () => {
    expect(directSearchProduct("w914-2", [item], 1)).toBe("mann-w-914-2");
    expect(directSearchProduct("W 914 2", [item], 1)).toBe("mann-w-914-2");
  });
  it("stays on the results for words or several products", () => {
    expect(directSearchProduct("фильтр", [item], 1)).toBeNull();
    expect(directSearchProduct("w914-2", [item, item], 2)).toBeNull();
  });
});

describe("searchServiceLinks", () => {
  it("routes service questions instead of searching parts", () => {
    expect(searchServiceLinks("доставка")).toEqual([{ href: "/delivery", label: "Доставка и самовывоз" }]);
    expect(searchServiceLinks("колодки")).toEqual([]);
  });
});
