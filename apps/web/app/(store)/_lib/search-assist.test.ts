import { describe, expect, it } from "vitest";

import { categoryHrefBySlug, exactCategoryMatch, highlightParts, matchCategories, swapKeyboardLayout } from "./search-assist";

describe("swapKeyboardLayout", () => {
  it("re-types Latin keys as Russian", () => {
    expect(swapKeyboardLayout("vfckj")).toBe("масло");
    expect(swapKeyboardLayout("abkmnh")).toBe("фильтр");
  });
  it("re-types Russian keys as Latin", () => {
    expect(swapKeyboardLayout("ищыср")).toBe("bosch");
  });
  it("leaves article numbers and mixed text alone", () => {
    expect(swapKeyboardLayout("W914/2")).toBeNull();
    expect(swapKeyboardLayout("12")).toBeNull();
    expect(swapKeyboardLayout("масло 5w40")).toBeNull();
    expect(swapKeyboardLayout("ывап")).toBeNull();
  });
});

describe("matchCategories", () => {
  const categories = [
    { id: "1", name: "Фильтры", parentId: null, productCount: 4, slug: "filtry" },
    { id: "2", name: "Фильтры масляные", parentId: "1", productCount: 2, slug: "maslyanye" },
    { id: "3", name: "Моторные масла", parentId: null, productCount: 0, slug: "motornye-masla" },
  ];
  it("matches by word stem and builds the nested path", () => {
    expect(matchCategories(categories, "фильтр")).toEqual([
      { href: "/catalog/filtry", name: "Фильтры", parentName: null, productCount: 4 },
      { href: "/catalog/filtry/maslyanye", name: "Фильтры масляные", parentName: "Фильтры", productCount: 2 },
    ]);
  });
  it("skips empty sections", () => {
    expect(matchCategories(categories, "моторные")).toEqual([]);
  });
});

describe("highlightParts", () => {
  it("marks the typed word regardless of ё", () => {
    expect(highlightParts("Щётка стеклоочистителя", "щетка")).toEqual([
      { match: true, text: "Щётка" },
      { match: false, text: " стеклоочистителя" },
    ]);
  });
});

describe("exactCategoryMatch", () => {
  const categories = [
    { id: "1", name: "Аккумуляторы", parentId: null, productCount: 3, slug: "akkumulyatory" },
    { id: "2", name: "Фильтры", parentId: null, productCount: 4, slug: "filtry" },
    { id: "3", name: "Моторные масла", parentId: null, productCount: 2, slug: "motornye-masla" },
    { id: "4", name: "Масляные", parentId: "2", productCount: 1, slug: "maslyanye" },
  ];
  it("opens the section a query names", () => {
    expect(exactCategoryMatch(categories, "аккумулятор")?.slug).toBe("akkumulyatory");
    expect(exactCategoryMatch(categories, "Фильтры")?.slug).toBe("filtry");
    expect(exactCategoryMatch(categories, "моторное масло")?.slug).toBe("motornye-masla");
  });
  it("searches by the word when the section it names holds no products", () => {
    // A filter filed elsewhere («Демонстрационные расходники», «Без категории») is found by its name, not lost behind an empty page.
    const empty = categories.map((category) => (category.slug === "filtry" ? { ...category, productCount: 0 } : category));
    expect(exactCategoryMatch(empty, "фильтр")).toBeNull();
    expect(exactCategoryMatch(empty, "аккумулятор")?.slug).toBe("akkumulyatory");
  });
  it("keeps product searches as searches", () => {
    expect(exactCategoryMatch(categories, "масляный фильтр")).toBeNull();
    expect(exactCategoryMatch(categories, "W914/2")).toBeNull();
  });
  it("builds nested paths", () => {
    expect(categoryHrefBySlug(categories, "maslyanye")).toBe("/catalog/filtry/maslyanye");
    expect(categoryHrefBySlug(categories, "nope")).toBeNull();
  });
});
