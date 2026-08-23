import { describe, expect, it } from "vitest";

import {
  inferCategoryFromProductName,
  isJunkCategoryGroupName,
  JUNK_CATEGORY_GROUP_NAMES,
  KNOWN_CATALOG_CATEGORIES,
  UNCATEGORIZED_CATEGORY_SLUG,
} from "./catalog-known-categories.js";

describe("isJunkCategoryGroupName", () => {
  it("recognises every documented catch-all name, case- and ё/е-insensitively", () => {
    expect(isJunkCategoryGroupName("Товары")).toBe(true);
    expect(isJunkCategoryGroupName("товары")).toBe(true);
    expect(isJunkCategoryGroupName("ТОВАРЫ")).toBe(true);
    expect(isJunkCategoryGroupName("Прочее")).toBe(true);
    expect(isJunkCategoryGroupName("Основная группа")).toBe(true);
    expect(isJunkCategoryGroupName("Номенклатура")).toBe(true);
  });

  it("tolerates the surrounding whitespace real 1С exports sometimes carry", () => {
    expect(isJunkCategoryGroupName("  Товары  ")).toBe(true);
  });

  it("does not flag a real, specific category name", () => {
    expect(isJunkCategoryGroupName("Тормозная система")).toBe(false);
    expect(isJunkCategoryGroupName("Колодки тормозные")).toBe(false);
    expect(isJunkCategoryGroupName("Фильтры")).toBe(false);
  });

  it("every documented junk name round-trips through the same fold used to check it", () => {
    for (const name of JUNK_CATEGORY_GROUP_NAMES) expect(isJunkCategoryGroupName(name)).toBe(true);
  });
});

describe("inferCategoryFromProductName", () => {
  it("matches the base form of each known category's distinctive word", () => {
    expect(inferCategoryFromProductName("Фильтр масляный Bosch")).toBe("filtry");
    expect(inferCategoryFromProductName("Аккумулятор Тюмень 62Ач")).toBe("akkumulyatory");
    expect(inferCategoryFromProductName("Антифриз G12 1л")).toBe("antifriz");
    expect(inferCategoryFromProductName("Лампа H4 12V")).toBe("avtolampy");
    expect(inferCategoryFromProductName("Жидкость гидравлическая ГЖ-3")).toBe("gidravlicheskaya-zhidkost");
    expect(inferCategoryFromProductName("Автохимия — очиститель салона")).toBe("avtohimiya");
    expect(inferCategoryFromProductName("Инструмент — набор ключей")).toBe("instrumenty");
    expect(inferCategoryFromProductName("Комплект для техосмотра")).toBe("tehosmotr");
  });

  it("matches declined Russian forms of the same word (case endings are suffixes, not prefix changes)", () => {
    expect(inferCategoryFromProductName("Масло моторное 5W-40")).toBe("motornye-masla");
    expect(inferCategoryFromProductName("Масло моторного типа")).toBe("motornye-masla");
    expect(inferCategoryFromProductName("Замена моторных масел")).toBe("motornye-masla");
  });

  it("matches the 1С-style abbreviation 'мот.' the task's own example uses", () => {
    expect(inferCategoryFromProductName("Масло мот. 5W-40")).toBe("motornye-masla");
  });

  it("matches regardless of word order", () => {
    expect(inferCategoryFromProductName("Колодки тормозные передние TRW")).toBe("tormoznaya-sistema");
    expect(inferCategoryFromProductName("Тормозные колодки передние TRW")).toBe("tormoznaya-sistema");
  });

  it("matches ё and е spellings of the same word identically", () => {
    expect(inferCategoryFromProductName("Щётка стеклоочистителя Bosch 600мм")).toBe("shchetki");
    expect(inferCategoryFromProductName("Щетка стеклоочистителя Bosch 600мм")).toBe("shchetki");
  });

  it("does not confuse motor oil with transmission oil despite sharing the word 'масло'", () => {
    expect(inferCategoryFromProductName("Масло трансмиссионное 75W-90")).toBe("transmissionnye-masla");
    expect(inferCategoryFromProductName("Масло моторное 5W-40")).toBe("motornye-masla");
  });

  it("returns null (not a guess) for a name with no recognisable known-category word", () => {
    expect(inferCategoryFromProductName("Наклейка декоративная на бампер")).toBeNull();
    expect(inferCategoryFromProductName("")).toBeNull();
  });

  it("returns null when a name plausibly matches more than one known category, rather than picking one", () => {
    // A single word from each of two different known categories' distinctive
    // vocabulary in the same name is treated as ambiguous, not resolved by
    // picking the first or the longest match.
    expect(inferCategoryFromProductName("Фильтр гидравлический для тормозной системы")).toBeNull();
  });

  it("every known category's own label is inferred back to its own slug", () => {
    for (const category of KNOWN_CATALOG_CATEGORIES) {
      expect(inferCategoryFromProductName(category.label)).toBe(category.slug);
    }
  });

  it("UNCATEGORIZED_CATEGORY_SLUG is never itself one of the twelve known slugs", () => {
    expect(KNOWN_CATALOG_CATEGORIES.some((category) => category.slug === UNCATEGORIZED_CATEGORY_SLUG)).toBe(false);
  });
});
