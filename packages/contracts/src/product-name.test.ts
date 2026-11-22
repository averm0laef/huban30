import { describe, expect, it } from "vitest";

import { publicProductName } from "./product-name.js";

describe("the name of a product as a customer sees it", () => {
  // The owner's staff type notes for themselves into product names in 1С: «(Ш)», «+++», the number of a shelf box.
  // Measured on the owner's base (22.11.2026): about 1 700 names of 42 723 carry one.
  it.each([
    ["(Ш) Заклепка ножа 5*26", "Заклепка ножа 5*26"],
    ["+++ Клипса крепежная TORSO, KP-170", "Клипса крепежная TORSO, KP-170"],
    ["+ (SAMPA 095.568) Ремкомплект суппорта", "(SAMPA 095.568) Ремкомплект суппорта"],
    ["(Ш) +++ Клипса крепежная", "Клипса крепежная"],
    // A note typed without a space before the name: found in the database after a rehearsal of the exchange.
    ["(Ш)Топливный насос SAT ST-FP14 12V, 3BAR", "Топливный насос SAT ST-FP14 12V, 3BAR"],
    ["(Ш)17X1130 Ремень клиновый MASUMA", "17X1130 Ремень клиновый MASUMA"],
    ["+++САЙЛЕНТБЛОК ПЕРЕДНИЙ ПЕРЕДНЕГО РЫЧАГА NAB-J32S", "САЙЛЕНТБЛОК ПЕРЕДНИЙ ПЕРЕДНЕГО РЫЧАГА NAB-J32S"],
    ["+++335015 Стойка амортизационная - Excel-G | перед прав | KYB", "335015 Стойка амортизационная - Excel-G | перед прав | KYB"],
    ["++(SAMPA 095.625) Р/К дискового тормоза", "(SAMPA 095.625) Р/К дискового тормоза"],
    ["+TAB-211 САЙЛЕНТБЛОК ЗАДНЕГО ПРОДОЛЬНОГО РЫЧАГА", "TAB-211 САЙЛЕНТБЛОК ЗАДНЕГО ПРОДОЛЬНОГО РЫЧАГА"],
    ["(15) В РОЗЛИВ Масло моторное Gazpromneft", "В РОЗЛИВ Масло моторное Gazpromneft"],
    ["АКЦИЯ (Ш) Зимний очиститель-осушитель топлива", "АКЦИЯ Зимний очиститель-осушитель топлива"],
    ["Втулка стабилизатора нижняя HiAce КОРОБКА 8", "Втулка стабилизатора нижняя HiAce"],
    ["Втулка рессоры Ti-Guar TG-MB584531 КОРОБКА 2/1", "Втулка рессоры Ti-Guar TG-MB584531"],
    ["Втулка рессоры Ti-Guar TG-MB025185 (Коробка 2)", "Втулка рессоры Ti-Guar TG-MB025185"],
    ["NSB-035 Втулка рессоры TG-55045-10W00 КОРОБКА 2 ST-55046-01W00", "NSB-035 Втулка рессоры TG-55045-10W00 ST-55046-01W00"],
    ["C7526LR Линк передний Noah 2WD АУДИТ", "C7526LR Линк передний Noah 2WD"],
    ["LA-1272 Фильтр воздушный LYNXauto АУДИТ 2023", "LA-1272 Фильтр воздушный LYNXauto"],
    ["АУДИТ ПРОДАТЬ LA-206-1 Фильтр воздушный UNION", "LA-206-1 Фильтр воздушный UNION"],
  ])("«%s» is shown as «%s»", (name, shown) => {
    expect(publicProductName(name)).toBe(shown);
  });

  it.each([
    // A number of five digits or more in brackets is the part's own number.
    "(29088) Тормозные колодки дисковые MAN/DAF ROSTAR", "(Ф-57) Латка камерная круглая ROSSVIK, 57мм",
    // «(Ш)» glued to a word is a thread designation.
    "Соединитель РВД / BSP(Ш)3/8 - BSP(Ш)1/2 / Ключ 27",
    // «коробка» of so many pieces, or of a gearbox, is about the product.
    "Перчатки латексные неопудренные М (коробка 100шт)", "Салфетки бумажные YOKO Misaki, коробка 200 шт (1/30)", "RNU070620A Подшипник коробки передач Koyo",
    // Marks whose meaning only the owner knows, and facts about the product, stay.
    "Крышка радиатора TI-GUAR* TG-C11", "В РОЗЛИВ АКЦИЯ Масло моторное 5W-40", "Набор резиновых колец 404 шт (ЦЕНА ЗА ШТУКУ!!!)", "Масло моторное 5W-40 4 л",
  ])("«%s» is shown as it is", (name) => {
    expect(publicProductName(name)).toBe(name);
  });

  it.each([
    // Found on the owner's base: 80 names carry the quoting of a CSV price list that was loaded into 1С — the whole
    // name in quotes, the quotes inside doubled. Such names also sorted before every other name of their section.
    ['"Щетка стеклоочистителя ""AIDO"" ГИБРИДНАЯ 600 ММ (24"") (АДАПТЕР AD531)"', 'Щетка стеклоочистителя "AIDO" ГИБРИДНАЯ 600 ММ (24") (АДАПТЕР AD531)'],
    ['"Щетка стеклоочистителя ""AIDO"" КАРКАСНАЯ 450 ММ (18"")"', 'Щетка стеклоочистителя "AIDO" КАРКАСНАЯ 450 ММ (18")'],
    // …cut off before its closing quote,
    ['"Щетка стеклоочистителя ""AIDO"" БЕСКАРКАСНАЯ 475 ММ (19"")', 'Щетка стеклоочистителя "AIDO" БЕСКАРКАСНАЯ 475 ММ (19")'],
    // …or with its opening quote lost,
    ['Головка торцевая 6-гранная 1/2"" х 18мм, длина 38мм JTC /1/10/200"', 'Головка торцевая 6-гранная 1/2" х 18мм, длина 38мм JTC /1/10/200'],
    // …with nothing inside to double,
    ['"OC1006 Крышка маслозаливной горловины (1180-46031) (ALFIparts)"', "OC1006 Крышка маслозаливной горловины (1180-46031) (ALFIparts)"],
    // …or only the doubling.
    ['Щетка стеклоочистителя 300 мм (12"") задняя CWR12XA', 'Щетка стеклоочистителя 300 мм (12") задняя CWR12XA'],
    ['Диск тормозной HONDA CIVIC 01-06 15""', 'Диск тормозной HONDA CIVIC 01-06 15"'],
    // Dashes before a name are a mark like the pluses.
    ['---Ароматизатор "Tensy"эксклюзив гел.', 'Ароматизатор "Tensy"эксклюзив гел.'],
    ["----- домкрат ромб 1.0т с резиновой опорой", "домкрат ромб 1.0т с резиновой опорой"],
    ['(Ш) "Набор ключей ""JTC"" 12 пр."', 'Набор ключей "JTC" 12 пр.'],
  ])("«%s» is shown as «%s»", (name, shown) => {
    expect(publicProductName(name)).toBe(shown);
  });

  it.each([
    // Quotes around a trade name are the name's own.
    '"Быстрый старт" аэрозоль 520 мл', 'Быстрый запуск двигателя Caratt "Быстрый старт", аэрозоль, 520 мл', 'Ключ 1/2" х 13мм', 'Шланг 3/8"',
    // One dash is a part of the name.
    "-40 Тосол Felix 5 кг",
  ])("«%s» is shown as it is", (name) => {
    expect(publicProductName(name)).toBe(name);
  });

  it("gives the same name when asked twice", () => {
    for (const name of ['"Щетка ""AIDO"" 600 ММ (24"")"', "(Ш) +++ Клипса КОРОБКА 9", '(15) --- "Масло ""X"""', '""AIDO"" щетка']) {
      const once = publicProductName(name);
      expect(publicProductName(once), name).toBe(once);
    }
  });

  it("keeps a name that is nothing but a note: such a product is the staff's to hide", () => {
    expect(publicProductName("АУДИТ 17.07.2025")).toBe("АУДИТ 17.07.2025");
    expect(publicProductName("+++")).toBe("+++");
  });
});

describe("the name of a product read with its article", () => {
  it.each([
    // 8 099 names of the owner's base start with the article, which the page already shows on a line of its own.
    ["3930 Лампа T4W 24V BA9s Osram", "3930", "Лампа T4W 24V BA9s Osram"],
    ["LC-341 Фильтр масляный LYNXauto Union C-341", "LC-341", "Фильтр масляный LYNXauto Union C-341"],
    ["20-22 Хомут силовой 20-22мм", "20-22", "Хомут силовой 20-22мм"],
    ["AF0258W Фильтр воздушный Avantech AVANTECH", "af0258w", "Фильтр воздушный Avantech AVANTECH"],
    // The same article written another way at the start (2 339 names more).
    ["KJ-1006 Клипса крепежная MASUMA KJ-1006 17120", "KJ1006", "Клипса крепежная MASUMA KJ-1006 17120"],
    ["30-45 хомут червячный 30-45мм NORMA", "3045", "Хомут червячный 30-45мм NORMA"],
    ["1 987 302 533 Лампа накаливания H21W 24V BAY9S Bosch", "1 987 302 533", "Лампа накаливания H21W 24V BAY9S Bosch"],
    // The article said twice at the end.
    ["Набор резиновых колец 404 шт (ЦЕНА ЗА ШТУКУ!!!) DA-00997 DA-00997", "DA00997", "Набор резиновых колец 404 шт (ЦЕНА ЗА ШТУКУ!!!) DA-00997"],
    ["10PK1620 Ремень поликлиновый DONGIL 10PK1620 10PK1620", "10PK1620", "Ремень поликлиновый DONGIL 10PK1620"],
    // Typed all in small letters: the first letter is a capital, a shorthand all capitals.
    ["лента изоляционная ПВХ 19мм", "LI-19", "Лента изоляционная ПВХ 19мм"],
    ["элемент масляного фильтра 7405-1012040 бумага", "7405-1012040", "Элемент масляного фильтра 7405-1012040 бумага"],
    ["акб BARS Silver - 60а/ч о.п.", "0602110188", "АКБ BARS Silver - 60а/ч о.п."],
    ["р/к суппорта переднего", "RK-1", "Р/к суппорта переднего"],
    ["3930 лампа 24V", "3930", "Лампа 24V"],
  ])("«%s» (article %s) is shown as «%s»", (name, sku, shown) => {
    expect(publicProductName(name, sku)).toBe(shown);
  });

  it.each([
    ["Лампа OSRAM 3930", "3930"],
    // The article is the start of a longer number, not the number itself.
    ["39301 Лампа накаливания", "3930"],
    // Nothing but codes would be left, or one word that says less than the number: «6409 Подшипник».
    ["3930 24V", "3930"],
    ["6409 Подшипник", "6409"],
    // A brand or a code in small letters, a name in capitals: as typed.
    ["masuma MFC-112 фильтр", "MFC-112"],
    ["ФИЛЬТР САЛОНА SHAANXI 81.61910.0011 CREATEK CK5655", "CK5655"],
  ])("«%s» (article %s) is shown as it is", (name, sku) => {
    expect(publicProductName(name, sku)).toBe(name);
  });

  it("leaves the leading article alone when the article is not given: the exchange stores the name so", () => {
    expect(publicProductName("3930 Лампа T4W 24V BA9s Osram")).toBe("3930 Лампа T4W 24V BA9s Osram");
  });
});
