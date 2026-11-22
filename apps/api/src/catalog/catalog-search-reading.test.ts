import { describe, expect, it } from "vitest";

import { productSearchText, searchReadingWords } from "./catalog-search-reading.js";

describe("the words a product's name is read by but is not written with", () => {
  // The catalogue search compares a query with the name as typed in 1С. In the owner's base 1 893 names of 42 723
  // are typed with shorthand, a misprint or a Latin look-alike letter, and were not found by the proper word.
  it.each([
    // A Latin letter that looks like the Russian one: «Cальник», «Pемень», «AкБ».
    ["Cальник привода FR TY NCP1#/2#/3#/5#/6#, EL4#/5#", "сальник"],
    ["Pемень автомобильный (150 руб)", "ремень"],
    ["AкБ мото PRESIDENT 12V 7а/ч 6FM-7 IGEL", "акб"],
    // 1С shorthand.
    ["Аром-р AURA FRESH CAR GEL Black Ice, бл.12шт, кор.72шт", "ароматизатор"],
    ["Предохр. MASUMA Флажковые Стандарт 7.5А", "предохранитель"],
    ["(54)В РОЗЛИВ Shell Helix HX7 5w30 бенз (п/син) масло моторное (209л.)", "полусинтетическое"],
    ["фильтр топл.FC-236 RB", "топливный"],
    ["Фильтр воздуш ВАЗ 2108-0LADA / AUDI 100/VW POLO/T2/T3 AFAU009 (FILTRON)", "воздушный"],
    ["Клемма АКБ PIBC-017-1 бол. (к-т 2шт)", "комплект"],
    ["Провода в/в 2123 силикон СЛОН", "высоковольтные"],
  ])("«%s» is also «%s»", (name, word) => {
    expect(searchReadingWords(name)).toContain(word);
  });

  it("adds nothing to a name that is written as it is read", () => {
    expect(searchReadingWords("Фильтр масляный MANN W 914/2")).toEqual([]);
    expect(searchReadingWords("Амортизатор передний левый KYB 333114")).toEqual([]);
  });

  it.each([
    // Found on the owner's whole base: 1 363 names had «сайлентблок» added though it is written in them. The stem
    // of a word in «-ок» / «-ек» drops the vowel («сайлентблк»), and that is not in the word as written.
    "САЙЛЕНТБЛОК ЗАДНЕЙ ПОПЕРЕЧНОЙ ТЯГИ TOYOTA CAMRY", "Патрубок радиатора верхний", "Подкрылок задний MITSUBISHI PAJERO SPORT 08- LH",
    "Набор головок", "Бачок расширительный Газель Некст", "Колпачек вентиля пластик", "Замок красный",
  ])("adds nothing to «%s»: every word of it is written", (name) => {
    expect(searchReadingWords(name)).toEqual([]);
  });

  it("does not add «для»", () => {
    expect(searchReadingWords("Герметик силакриловый д/окон и стекол")).not.toContain("для");
  });

  it("does not add the labels typed into a name", () => {
    // «cтрана:» is typed with a Latin c in seven names of the owner's base.
    const words = searchReadingWords("Фара TOYOTA PREMIO 01-04 RH галоген артикул: ST-20-426R бренд: SAT cтрана: Тайвань");
    expect(words).not.toContain("страна");
  });

  it("adds no word the search already finds by its stem", () => {
    // «маслянный» with two «н» is found by «масляный» as it is: the search looks for the stem «маслян».
    expect(searchReadingWords("Маслянный фильтр Эл.фильтр.оч. масл. LUXE LX-412-М ГАЗ, Москвич")).not.toContain("масляный");
  });

  it("adds no word that is already in the article or in the rest of the search text", () => {
    expect(searchReadingWords("Cальник привода", "сальник-90311 Cальник привода")).toEqual([]);
  });

  it("does not make a word of a trade mark sign", () => {
    expect(searchReadingWords("Фитинг прямой комбинир. пластик pg08-10 МАЯКАВТО™").join(" ")).not.toMatch(/маякавтотм/u);
  });

  it("adds a dozen words at most", () => {
    const name = "аром-р предохр. п/син топл. воздуш к-т в/в аморт. торм. рул. сигн. масл. нар. внутр. перед. задн. прав. лев.";
    expect(searchReadingWords(name).length).toBeLessThanOrEqual(12);
  });
});

describe("the text a product is searched by", () => {
  it("is the article, the name as typed, whatever else the exchange knows, and the words the name is read by", () => {
    expect(productSearchText("90311-34022", "Cальник привода FR", ["Toyota Vitz"])).toBe("90311-34022 Cальник привода FR Toyota Vitz сальник");
  });

  it("is the article and the name when the name is written as it is read", () => {
    expect(productSearchText("0 986 452 041", "Фильтр масляный", ["Toyota Camry V40"])).toBe("0 986 452 041 Фильтр масляный Toyota Camry V40");
  });

  it("stays within ten thousand characters", () => {
    expect(productSearchText("A1", "Cальник", ["x".repeat(20_000)]).length).toBe(10_000);
  });
});
