import { describe, expect, it } from "vitest";

import { STOREFRONT_TAXONOMY } from "@an30/contracts";

import {
  HIDDEN_CATEGORY_SLUG,
  JUNK_CATEGORY_GROUP_NAMES,
  STOREFRONT_CATEGORY_SLUGS,
  UNCATEGORIZED_CATEGORY_SLUG,
  decideStorefrontCategory,
  inferCategoryFromProductName,
  inferStorefrontCategory,
  inferSubsection,
  isJunkCategoryGroupName,
  matchPlacementRule,
  storefrontParentSlug,
} from "./catalog-known-categories.js";
import { partSectionFromGroupName } from "./catalog-part-dictionary.js";

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
    expect(inferCategoryFromProductName("Узел гидравлический тормозной системы")).toBeNull();
  });

  it("every known category's own label is inferred back to its own slug", () => {
    for (const section of STOREFRONT_TAXONOMY) {
      // The first twelve sections are read by their own words; the parts sections by the part dictionary.
      expect(inferCategoryFromProductName(section.label) ?? partSectionFromGroupName(section.label), section.label).toBe(section.slug);
    }
  });

  it("UNCATEGORIZED_CATEGORY_SLUG is never itself one of the twelve known slugs", () => {
    expect(STOREFRONT_TAXONOMY.some((section) => section.slug === UNCATEGORIZED_CATEGORY_SLUG)).toBe(false);
  });
});

describe("inferCategoryFromProductName context rules", () => {
  it.each([
    ["Фильтр масляный MANN W914/2", "filtry"],
    ["Фильтр гидравлический для тормозной системы", "filtry"],
    ["Ключ для масляного фильтра 65-110 мм", "instrumenty"],
    ["Масло моторное 5W-40 синтетика 4 л", "motornye-masla"],
    ["Масло 5W-40 4 л", "motornye-masla"],
    ["Масло мот. 10W-40", "motornye-masla"],
    ["Масло трансмиссионное 75W-90", "transmissionnye-masla"],
    ["Масло ATF Dexron III", "transmissionnye-masla"],
    ["Масло гидравлическое для ГУР", "gidravlicheskaya-zhidkost"],
    ["Щёток комплект 600/400", "shchetki"],
    ["Дворник бескаркасный 550 мм", "shchetki"],
    ["Антифриз G12 красный 5 кг", "antifriz"],
    ["Жидкость охлаждающая -40", "antifriz"],
  ])("%s → %s", (name, slug) => {
    expect(inferCategoryFromProductName(name)).toBe(slug);
  });

  it.each([
    ["Клемма аккумулятора плюсовая", "akkumulyatory"],
    ["Зарядное устройство для аккумулятора 12 В", "akkumulyatory"],
  ])("battery accessories go to the battery section (its own subsections): %s", (name, slug) => {
    expect(inferCategoryFromProductName(name)).toBe(slug);
  });

  it.each([
    "Моторчик стеклоочистителя передний",
    "Мотор отопителя",
  ])("%s → Без категории rather than a wrong section", (name) => {
    expect(inferCategoryFromProductName(name)).toBeNull();
  });
});

describe("storefront subsections", () => {
  it.each([
    ["Масло моторное синтетическое 5W-40 4л", "sinteticheskie-motornye-masla"],
    ["Масло моторное полусинтетическое 10W-40 4 л", "polusinteticheskie-motornye-masla"],
    ["Масло моторное минеральное 15W-40", "mineralnye-motornye-masla"],
    ["Масло моторное для мотоциклов 4Т 10W-40", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["Масло моторное 5W-30 4 л", "motornye-masla"],
    ["Фильтр масляный MANN W914/2", "maslyanye-filtry"],
    ["Фильтр воздушный MANN C25114", "vozdushnye-filtry"],
    ["Фильтр салонный угольный", "salonnye-filtry"],
    ["Фильтр топливный тонкой очистки", "toplivnye-filtry"],
    ["Колодки тормозные передние TRW GDB1550", "tormoznye-kolodki"],
    ["Колодки тормозные дисковые передние", "tormoznye-kolodki"],
    ["Диск тормозной вентилируемый", "tormoznye-diski"],
    ["Барабан тормозной задний", "tormoznye-barabany"],
    ["Жидкость тормозная DOT-4 0,5 л", "tormoznaya-zhidkost"],
    ["Ремкомплект суппорта тормозного", "supporty-i-remkomplekty"],
    ["Аккумулятор Тюмень 62Ач", "akkumulyatory-legkovye"],
    ["Аккумулятор грузовой 190Ач", "akkumulyatory-gruzovye"],
    ["Аккумулятор мото 12V 9Ah", "akkumulyatory-moto"],
    ["Зарядное устройство для аккумулятора 12 В", "zaryadnye-ustroystva"],
    ["Клеммы аккумуляторные латунные", "provoda-i-klemmy"],
    ["Провода прикуривания 400А", "provoda-i-klemmy"],
    ["Масло трансмиссионное 75W-90 GL-5", "masla-dlya-mkpp"],
    ["Масло трансмиссионное для АКПП ATF Dexron III", "masla-dlya-akpp"],
    ["Масло трансмиссионное для вариатора CVT", "masla-dlya-variatora"],
    ["Антифриз G12 красный готовый -40 5 кг", "antifriz-gotovyy"],
    ["Антифриз концентрат G12+ 1,5 л", "antifriz-kontsentrat"],
    ["Вода дистиллированная 5 л", "distillirovannaya-voda"],
    ["Лампа H7 12V 55W", "galogennye-lampy"],
    ["Лампа ксеноновая D2S 85V", "ksenonovye-lampy"],
    ["Лампа светодиодная H7 LED", "svetodiodnye-lampy"],
    ["Лампа W5W 12V габаритная", "signalnye-lampy"],
    ["Щётка стеклоочистителя каркасная 500 мм", "shchetki-karkasnye"],
    ["Щетка стеклоочистителя бескаркасная 600 мм", "shchetki-beskarkasnye"],
    ["Щётка стеклоочистителя гибридная 650 мм", "shchetki-gibridnye"],
    ["Щётка стеклоочистителя задняя 300 мм", "shchetki-zadnie"],
    ["Жидкость гидравлическая для ГУР PSF", "zhidkosti-gur"],
    ["Масло гидравлическое HLP 32", "gidravlicheskie-masla"],
    ["Автохимия: полироль для кузова", "dlya-kuzova-i-stekol"],
    ["Автохимия: очиститель пластика салона", "dlya-salona"],
    ["Автохимия: шампунь для бесконтактной мойки", "dlya-moyki"],
    ["Автохимия: чернитель шин", "dlya-shin-i-diskov"],
    ["Жидкость омывателя незамерзающая -20", "zhidkost-omyvatelya"],
    ["Присадка в топливо", "prisadki"],
    ["Смазка Литол-24 100 г", "smazki"],
    ["Герметик прокладок силиконовый", "dlya-remonta"],
    ["Ключ свечной 16 мм", "klyuchi-i-golovki"],
    ["Набор инструментов 94 предмета", "nabory-instrumentov"],
    ["Домкрат подкатной 2 т", "domkraty"],
    ["Съёмник масляного фильтра", "semniki"],
    ["Тестер аккумуляторов", "diagnostika"],
    ["Аптечка автомобильная", "aptechki"],
    ["Огнетушитель ОП-2", "ognetushiteli"],
    ["Знак аварийной остановки", "znaki-avariynoy-ostanovki"],
    ["Трос буксировочный 3 т", "zhilety-i-buksirnye-trosy"],
  ])("%s → %s", (name, slug) => {
    expect(inferStorefrontCategory(name)).toBe(slug);
  });

  it("covers every subsection of the storefront tree with at least one name above", () => {
    const slugs = STOREFRONT_TAXONOMY.flatMap((section) => section.children.map((child) => child.slug));
    expect(slugs.every((slug) => STOREFRONT_CATEGORY_SLUGS.includes(slug))).toBe(true);
  });

  it("keeps the parent section when no subsection or two subsections tie on the same word", () => {
    expect(inferSubsection("filtry", "Фильтр Bosch")).toBeNull();
    expect(inferSubsection("nonexistent", "Фильтр воздушный")).toBeNull();
    expect(inferStorefrontCategory("Наклейка на бампер")).toBeNull();
    // "диск" alone outside the brake section is not enough to guess.
    expect(inferStorefrontCategory("Диск сцепления")).toBeNull();
  });
});

describe("decideStorefrontCategory (1С groups → storefront sections)", () => {
  it("lets a product name that names its part type beat a broad or mixed 1С group", () => {
    expect(decideStorefrontCategory({ groupNames: ["Масла и смазки"], productName: "Масло моторное Лукойл Люкс 5W-40 SN/CF полусинтетическое 4л" }))
      .toEqual({ slug: "polusinteticheskie-motornye-masla", source: "name" });
    expect(decideStorefrontCategory({ groupNames: ["Автохимия"], productName: "Антифриз Sintec Lux G12 красный готовый 5кг" }))
      .toEqual({ slug: "antifriz-gotovyy", source: "name" });
    expect(decideStorefrontCategory({ groupNames: ["Фильтры"], productName: "Ключ для масляного фильтра 65-110 мм" }))
      .toEqual({ slug: "klyuchi-i-golovki", source: "name" });
    expect(decideStorefrontCategory({ groupNames: ["Колодки", "Тормозная система"], productName: "Колодки тормозные передние TRW" }))
      .toEqual({ slug: "tormoznye-kolodki", source: "group" });
  });

  it("files a battery by its capacity when the name names no vehicle type", () => {
    expect(decideStorefrontCategory({ groupNames: ["АКБ"], productName: "Аккумулятор TYUMEN BATBEAR 60Ач обратная полярность" }).slug)
      .toBe("akkumulyatory-legkovye");
    expect(decideStorefrontCategory({ groupNames: [], productName: "Аккумулятор Титан 190 Ач" }).slug).toBe("akkumulyatory-gruzovye");
    expect(decideStorefrontCategory({ groupNames: [], productName: "Аккумулятор мото 9 Ач" }).slug).toBe("akkumulyatory-moto");
  });

  it("uses the staff mapping first and refines a section to a subsection by name", () => {
    expect(decideStorefrontCategory({ groupNames: ["Разное"], manualSlug: "filtry", productName: "Фильтр воздушный" }))
      .toEqual({ slug: "vozdushnye-filtry", source: "manual" });
    expect(decideStorefrontCategory({ groupNames: [], manualSlug: "salonnye-filtry", productName: "Фильтр воздушный" }))
      .toEqual({ slug: "salonnye-filtry", source: "manual" });
  });

  it("then the 1С group name, walking up to parent groups", () => {
    expect(decideStorefrontCategory({ groupNames: ["Колодки", "Тормозная система"], productName: "GDB1550 TRW" }))
      .toEqual({ slug: "tormoznye-kolodki", source: "group" });
    expect(decideStorefrontCategory({ groupNames: ["Масла моторные"], productName: "Лукойл Люкс 5W-40 синтетическое" }))
      .toEqual({ slug: "sinteticheskie-motornye-masla", source: "group" });
    expect(decideStorefrontCategory({ groupNames: ["Огнетушители"], productName: "ОП-2" }))
      .toEqual({ slug: "ognetushiteli", source: "group" });
  });

  it("then the product name; catch-all groups are ignored", () => {
    expect(decideStorefrontCategory({ groupNames: ["Товары"], productName: "Фильтр воздушный MANN C25114" }))
      .toEqual({ slug: "vozdushnye-filtry", source: "name" });
  });

  it("files the rest under «Без категории»", () => {
    expect(decideStorefrontCategory({ groupNames: ["Прочее"], productName: "Сувенир АН-30" }))
      .toEqual({ slug: "bez-kategorii", source: "none" });
  });

  it("sorts a base without groups by the noun the name leads with", () => {
    const place = (productName: string, groupNames: string[] = []) => decideStorefrontCategory({ groupNames, productName });
    expect(place("Свеча зажигания NGK BKR6E")).toEqual({ slug: "svechi-zazhiganiya", source: "name" });
    expect(place("Амортизатор передний KYB 334305")).toEqual({ slug: "amortizatory", source: "name" });
    // The leading noun, not a section word further in the name.
    expect(place("Прокладка масляного фильтра")).toEqual({ slug: "prokladki-i-salniki", source: "name" });
    expect(place("Щётки генератора к-т")).toEqual({ slug: "generatory-i-startery", source: "name" });
    expect(place("Датчик давления масла")).toEqual({ slug: "datchiki", source: "name" });
    expect(place("Насос омывателя")).toEqual({ slug: "omyvateli-i-stekloochistiteli", source: "name" });
    // The first twelve sections keep working as before.
    expect(place("Фильтр масляный MANN W914/2").slug).toBe("maslyanye-filtry");
    expect(place("Масло моторное синтетическое 5W-40 4 л").slug).toBe("sinteticheskie-motornye-masla");
    expect(place("Щётка стеклоочистителя бескаркасная 500 мм").slug).toBe("shchetki-beskarkasnye");
    expect(place("Диск тормозной передний").slug).toBe("tormoznye-diski");
    expect(place("Ключ свечной 16 мм").slug).toMatch(/^(instrumenty|klyuchi-i-golovki)$/u);
  });

  it("reads a parts section from the 1С group and the subsection from the name", () => {
    expect(decideStorefrontCategory({ groupNames: ["Ходовая часть"], productName: "Втулка 48815-12345" })).toEqual({ slug: "podveska", source: "group" });
    expect(decideStorefrontCategory({ groupNames: ["Ходовая часть"], productName: "Рычаг передний нижний" })).toEqual({ slug: "rychagi", source: "group" });
    // A mixed group loses to a name that leads with its part type.
    expect(decideStorefrontCategory({ groupNames: ["Фильтры"], productName: "Свеча зажигания Denso" })).toEqual({ slug: "svechi-zazhiganiya", source: "name" });
  });

  it("puts a staff rule above everything automatic", () => {
    const rules = [
      { brandKey: "GATES", headStem: "ремен", nameStems: [], skuPrefix: null, slug: "grm" },
      { brandKey: null, headStem: "сувенир", nameStems: [], skuPrefix: null, slug: "aksessuary" },
      { brandKey: null, headStem: null, nameStems: [], skuPrefix: "9091", slug: "maslyanye-filtry" },
    ];
    const rule = (name: string, brandKey = "", skuNormalized = "") => matchPlacementRule(rules, { brandKey, name, skuNormalized });
    expect(rule("Ремень Gates 5469XS", "GATES")).toBe("grm");
    expect(rule("Ремень поликлиновой", "DAYCO")).toBeNull();
    expect(rule("Сувенир АН-30")).toBe("aksessuary");
    expect(rule("Элемент фильтрующий", "TOYOTA", "9091510001")).toBe("maslyanye-filtry");
    expect(decideStorefrontCategory({ groupNames: ["Фильтры"], productName: "Сувенир АН-30", ruleSlug: "aksessuary" })).toEqual({ slug: "aksessuary", source: "rule" });
    expect(decideStorefrontCategory({ groupNames: [], productName: "Сувенир", ruleSlug: "no-such-section" })).toEqual({ slug: "bez-kategorii", source: "none" });
  });
});

describe("1С «категории номенклатуры» sent as groups", () => {
  // The owner's exchange node exports the hierarchy by nomenclature category. The base has five of them, and an
  // ordinary part carries the default one, «услуга». Such a name must say nothing about the section.
  const place = (groupName: string, productName: string) => decideStorefrontCategory({ groupNames: [groupName], productName });

  it.each(["услуга", "Продукты", "Продукция растеневодства"])("«%s» is not a section: the product's own name decides", (groupName) => {
    expect(place(groupName, "Сайлентблок рычага подвески | зад прав/лев | LYNXauto (Febest HAB-152)"))
      .toEqual({ slug: "saylentbloki", source: "name" });
  });

  it.each(["услуга", "Продукты", "Продукция растеневодства"])("«%s» with a name the site cannot read goes to the queue, not to a guess", (groupName) => {
    expect(place(groupName, "Сувенир с логотипом магазина")).toEqual({ slug: "bez-kategorii", source: "none" });
  });

  it("the two tyre categories do name a section", () => {
    expect(storefrontParentSlug(place("Автошины легковые", "215/55R17 Three A").slug)).toBe("shiny-i-diski");
    expect(place("Автошины грузовые", "13.00R22.5 ANNAITE")).toEqual({ slug: "shiny-gruzovye", source: "group" });
  });
});

describe("the hidden shelf: things the base holds that the shop does not sell online", () => {
  // Services, the workshop's price list, grain and fixed assets live in the same 1С list as parts.
  // Staff point their 1С group (or a sorting rule) at the hidden shelf; nothing is hidden by guessing.

  it("puts a product on the hidden shelf when staff mapped its 1С group there", () => {
    expect(decideStorefrontCategory({ groupNames: ["СТО"], manualSlug: HIDDEN_CATEGORY_SLUG, productName: "Замена топл фильтра" }))
      .toEqual({ slug: HIDDEN_CATEGORY_SLUG, source: "manual" });
  });

  it("keeps it there even when the name reads like a part", () => {
    expect(decideStorefrontCategory({ groupNames: ["Основные фонды"], manualSlug: HIDDEN_CATEGORY_SLUG, productName: "Компрессор гаражный 500 л" }))
      .toEqual({ slug: HIDDEN_CATEGORY_SLUG, source: "manual" });
  });

  it("puts a product on the hidden shelf when a staff rule says so", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "Услуги автокрана КАМАЗ (25 тонн)", ruleSlug: HIDDEN_CATEGORY_SLUG }))
      .toEqual({ slug: HIDDEN_CATEGORY_SLUG, source: "rule" });
  });

  it("never hides a product on its own: a service-like name without a staff decision goes to the queue", () => {
    expect(decideStorefrontCategory({ groupNames: ["СТО"], productName: "Услуга отогрев автомобиля" }))
      .toEqual({ slug: "bez-kategorii", source: "none" });
  });

  it("is one of the slugs a product may be placed in", () => {
    expect(STOREFRONT_CATEGORY_SLUGS).toContain(HIDDEN_CATEGORY_SLUG);
  });
});

describe("a Latin look-alike letter inside a Russian word", () => {
  // «Mасло моторное» typed with a Latin M, «AкБ» with a Latin A: 167 such names in the owner's base.
  const section = (productName: string) => storefrontParentSlug(decideStorefrontCategory({ groupNames: [], productName }).slug)
    ?? decideStorefrontCategory({ groupNames: [], productName }).slug;

  it("reads the oil the same as when it is typed in Russian letters", () => {
    expect(section("Mасло моторное Totachi Grand Touring SN 5w-40 синт. 1л.")).toBe("motornye-masla");
  });

  it("reads the battery the same", () => {
    expect(section("AкБ мото PRESIDENT 12V 7а/ч 6FM-7 IGEL (113*70*131мм) кнопочный")).toBe("akkumulyatory");
  });

  it("reads the filter the same", () => {
    expect(section("(LO-124) Фильтр мaсляный PBF-030")).toBe("filtry");
  });
});

describe("an original number in the name or the article, when the name itself does not decide", () => {
  it("places a bush known only by its Toyota number among the stabilizer bushes", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "Втулка TG-48815-60121 * Ti·GUAR TSB-797" }))
      .toEqual({ slug: "stabilizator", source: "number" });
  });

  it("reads the number from the article as well", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "Втулка Ti·GUAR", sku: "TG-48818-06100" }))
      .toEqual({ slug: "stabilizator", source: "number" });
  });

  it("lets a name that says what the part is win over the number", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "Сайлентблок рычага подвески 48815-60121" }).slug).toBe("saylentbloki");
  });

  it("lets the staff's own 1С group win over the number", () => {
    expect(decideStorefrontCategory({ groupNames: ["САЙЛЕНТБЛОК 2022"], productName: "Втулка TG-48815-60121 * Ti·GUAR" }))
      .toMatchObject({ slug: "saylentbloki", source: "group" });
  });

  it("leaves a bush without a number in the queue", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "Втулка желтая ИПСУМ" }))
      .toEqual({ slug: "bez-kategorii", source: "none" });
  });
});

describe("1С shorthand in the words that pick a subsection", () => {
  // The owner's base writes «фильтр масл.С-931», «п/синт.», «синт.», «мин.»: 2,484 placed items had no subsection.
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it.each([
    ["LC-940 фильтр масл.С-931 RB", "maslyanye-filtry"],
    ["фильтр возд.А-472 TOP", "vozdushnye-filtry"],
    ["Фильтр топл. тонкой очистки HINO S234011682", "toplivnye-filtry"],
    ["Фильтр сал. угольный SAT", "salonnye-filtry"],
    ["Моторное масло п/синт. Gazpromneft Super 10W-40 SG/CD кан. 1л.", "polusinteticheskie-motornye-masla"],
    ["масло моторное OILRIGHT Ойлрайт 10/40 SG/CD п/синтетика 1л. 1*8", "polusinteticheskie-motornye-masla"],
    ["Масло моторное LUXE Люкс LUX 1л. 10/40 SJ/CF п/синт. 1*12", "polusinteticheskie-motornye-masla"],
    ["Моторное масло синт. Shell Helix High Mileage 5W-40 1 л", "sinteticheskie-motornye-masla"],
    ["В РОЗЛИВ Масло моторное Kixx G1 SN Plus 5W30 20л синтетика", "sinteticheskie-motornye-masla"],
    ["Масло моторное Kixx Ultra 5w40 SN 1л синт.", "sinteticheskie-motornye-masla"],
    ["Масло моторное ЛУКОЙЛ Стандарт 15W-40 мин. 4л", "mineralnye-motornye-masla"],
    // «п-синт» with a dash is still «semi-synthetic», not «synthetic».
    ["Масло моторное п-синт.MANNOL TS-5 UHPD 10W-40 20л.", "polusinteticheskie-motornye-masla"],
  ])("%s → %s", (name, slug) => {
    expect(place(name)).toBe(slug);
  });
});

describe("the kind of a motor oil, as the owner's base writes it", () => {
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it.each([
    // «син» and «п/син» as words of their own.
    ["Castrol Magnatec 5w30 AP син масло моторное (208л.)", "sinteticheskie-motornye-masla"],
    ["В РОЗЛИВ Eneos Diesel 10w40 CG-4 диз (п/син) масло моторное (200л.)", "polusinteticheskie-motornye-masla"],
    ["1916 10W-40 SL/CF SUPER LEICHTLAUF 4л (HC-синт.мотор.масло) Liqui Moly", "sinteticheskie-motornye-masla"],
    ["Роснефть Optimum 10w40 SG/CD (1л) (масло минер.)", "mineralnye-motornye-masla"],
    // GOST grades of mineral diesel oils.
    ["масло моторное М10ДМ 5 л. 1*4 Новоуфимский НПЗ МасАвто", "mineralnye-motornye-masla"],
    ["Масло моторное М10Г2К 5 л. 1*4 Новоуфимский НПЗ МасАвто", "mineralnye-motornye-masla"],
    ["АВТОЛ Моторное масло Gazpromneft М-8В, 4литр Автол", "mineralnye-motornye-masla"],
    // Two- and four-stroke oils, written with Latin or Russian «T».
    ["Масло моторное Kixx Ultra 2T F/M2 FB/TC 1л", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["Масло моторное Kixx Ultra 4T Scooter 5w40 SN/MB 1л синт.", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["масло моторное High Way 4Т п/с 10w-40 SJ/CF JASO MA-2 1л (ПРАДА)", "masla-dlya-moto-i-sadovoy-tekhniki"],
  ])("%s → %s", (name, slug) => {
    expect(place(name)).toBe(slug);
  });

  it("does not guess the kind from the viscosity alone", () => {
    expect(place("Масло моторное Shell Helix НХ7 5W-30 (API SN/CF; ACEA A3/B3Б A3/B4) 4л.")).toBe("motornye-masla");
    expect(place("Масло моторное РОСНЕФТЬ Maximum 10W-40 4л")).toBe("motornye-masla");
  });

  it("does not take a colour for the kind: «син» in a lamp's name is blue", () => {
    expect(place("Лампа диодная  24V- 1,2 (син)")).not.toBe("sinteticheskie-motornye-masla");
  });
});

describe("a section named by the product's noun is narrowed to a subsection by the rest of the name", () => {
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it.each([
    // «Жидкость для АКПП»: the noun says «transmission fluids», the words after it say which.
    ["Жидкость для АКПП ENEOS Premium AT Fluid 4л (1/6)", "masla-dlya-akpp"],
    ["TOYOTA АTF TYPE T-IV жидкость для АКПП 4л (1/6)", "masla-dlya-akpp"],
    ["(34) В РОЗЛИВ Жидкость для АКПП ENEOS DEXRON II 200л", "masla-dlya-akpp"],
    ["Жидкость для вариатора NISSAN CVT NS-3 4л", "masla-dlya-variatora"],
  ])("%s → %s", (name, slug) => {
    expect(place(name)).toBe(slug);
  });
});

describe("oils the owner's base names without the usual words", () => {
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it.each([
    // The viscosity written with a slash, and no «моторное».
    ["МАСЛО LUXE SL 10/40 П/С 5Л АКЦИЯ шт.", "polusinteticheskie-motornye-masla"],
    ["МАСЛО LUXE МОЛИБДЕН 10/40 П/С 4Л шт.", "polusinteticheskie-motornye-masla"],
    // A GOST grade alone says «motor oil».
    ["Масло Gazpromneft М-8В (1л.) 2389901393", "mineralnye-motornye-masla"],
    ["Масло ЛУКОЙЛ ДИЗЕЛЬ М-8Г2К", "mineralnye-motornye-masla"],
    ["(4) В РОЗЛИВ М10ДМ Масло ЛУКОЙЛ ДИЗЕЛЬ М10ДМ Lukoil 216,5 л", "mineralnye-motornye-masla"],
    ["Масло дизельное М8ДМ 20W мин.18л бидон ЛУКОЙЛ 193664", "mineralnye-motornye-masla"],
    // Two-stroke oil without «моторное».
    ["3ton/Country ST-508 Масло 2T мин. API ТВ 1л дозаторная", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["32309 Масло двухткатное Motul 510 2T полусинт. 1л 106606", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["Масло для пилы Stihl 1000 мл (11899)", "masla-dlya-moto-i-sadovoy-tekhniki"],
    // Transmission: the gearbox named in full, a reducer, a variator.
    ["Масло для автоматических коробок передач Vitex Dexron III 4л", "masla-dlya-akpp"],
    ["Масло трансм для вариатора HONDA HMMF 4л (1/6)", "masla-dlya-variatora"],
    ["Масло транс.синт.CVT Fluid 1304 A-LINE 4л V272085341", "masla-dlya-variatora"],
    ["KAMA OIL Масло трансм. ТМ-5-18 (ТАД-17) GL-5 5л", "masla-dlya-mkpp"],
    ["Масло редукторное MOBILGEAR 600 XP 320 (20л / Финляндия)", "transmissionnye-masla"],
    // Power steering.
    ["(Ш) Масло High Way для гидроусилителя руля 1 л", "zhidkosti-gur"],
    ["3ton ТМ-104 масло для гидроусилителя руля 1л", "zhidkosti-gur"],
    // Flushing oil.
    ["Промывочное масло Лукойл 4л", "promyvochnye-masla"],
    // The viscosity typed without a space after «масло».
    ["(44) Моторное масло15W-40 Gazpromneft Turbo Universal 15w40 (мин) (205л)", "mineralnye-motornye-masla"],
    // An additive «к маслу» is an additive.
    ["Комплекс присадок к маслу, для новых двигателей HG2252", "prisadki"],
    ["V0006 STOP SMOKE Антидымная присадка к моторному маслу 300 мл", "prisadki"],
  ])("%s → %s", (name, slug) => {
    expect(place(name)).toBe(slug);
  });

  it.each([
    // Not an oil for sale by kind: an oil line, an oil separator's kit, an oil with nothing said about it.
    "Маслопровод компрессора 240-3509150 L-352 МТЗ (3075)", "р/к масловлагоотделителя с РДВ Евро 14наим.19де кт.", "Масло ACDelco 104-017",
    // An oil line of the power steering is a part: «масл…» inside another word is not the word «масло».
    "маслопровод 70-3407140-Б (А) ГУР шт.", "Маслоохладитель АКПП Toyota",
  ])("does not file «%s» among the oils", (name) => {
    expect(["motornye-masla", "transmissionnye-masla", "gidravlicheskaya-zhidkost"]).not.toContain(storefrontParentSlug(place(name)) ?? place(name));
  });
});

describe("a battery's capacity, as the owner's base writes it", () => {
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it.each([
    ["АКБ Аккумулятор 6СТ-90 (1) АПЗ \"NOMAD Premium\" П.П. Ca/Ca 90 А/Ч 810 A (EN) 353*175*190", "akkumulyatory-legkovye"],
    ["АКБ UNIKUM - 60а/ч п.п. (п.ток 500 A(EN), 13,8 кг)", "akkumulyatory-legkovye"],
    ["Аккумулятор ZUBR JIS Premium B24R 50A/h 450A 237*127*225 ( плюс слева)", "akkumulyatory-legkovye"],
    ["АКБ ЗВЕРЬ ASIA 6СТ-110LУ /110-3-R 110Ah L(обр) ССА 930А 306-175-225,необслуж.", "akkumulyatory-legkovye"],
    ["АКБ Аляска MF 45 а/ч 55B24L", "akkumulyatory-legkovye"],
    ["АКБ DOCK 132 A/ч L О.П.", "akkumulyatory-gruzovye"],
    ["АКБ Аккумулятор 6СТ-190 (3) АПЗ \"EXCLUSIVE\" О.П. 190 А/Ч 1200 A (EN) 513*223*223", "akkumulyatory-gruzovye"],
    ["АКБ Аккумуляторная батарея TOTACHI CMF 9 а/ч YTX9-BS R", "akkumulyatory-moto"],
    // The GOST name alone: «6СТ-75» is a 75 A·h battery.
    ["АКБ 6СТ-75 АПЗ ВОЖАК", "akkumulyatory-legkovye"],
    ["АКБ 6СТ-225 Тюмень", "akkumulyatory-gruzovye"],
  ])("%s → %s", (name, slug) => {
    expect(place(name)).toBe(slug);
  });

  it("does not take the starting current for the capacity", () => {
    // «500 A (EN)» is amperes; with nothing else said the battery stays in the section.
    expect(place("АКБ BARS Silver п.п. (п.ток 500 A(EN))")).toBe("akkumulyatory");
  });

  it("leaves a 120 A·h battery in the section: it fits a large car and a small truck alike", () => {
    expect(place("АКБ Тюмень 120 А/ч")).toBe("akkumulyatory");
  });
});

describe("a tyre without the words «легковая» or «грузовая» is filed by its size", () => {
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it("files a car size among the car tyres", () => {
    expect(place("А/шина 205/70R15 КАМА VIATTI-526 (зима)")).toBe("shiny-legkovye");
  });

  it("files a «,5» rim among the truck tyres", () => {
    expect(place("А/шина 315/70R22,5 KAPSEN HS202 20PR (ведущая)")).toBe("shiny-gruzovye");
  });

  it("does not take «без камеры» in a tyre's name for an inner tube", () => {
    expect(place("А/шина 205/55R16 Бел-317 без камеры (зима)")).toBe("shiny-legkovye");
  });

  it("keeps a tyre with no size in the section", () => {
    expect(place("А/шина б/у Европа ПЛЮС")).toBe("shiny-i-diski");
  });

  it("lets the word win over the size", () => {
    expect(place("А/шина грузовая 215/75R16C")).toBe("shiny-gruzovye");
  });
});

describe("a filter element named by its adjective", () => {
  it("stays among the filters, even when the name mentions the oil it filters", () => {
    const { slug } = decideStorefrontCategory({ groupNames: [], productName: "STELLOX 81-00031-SX фильтрующий элемент масла!АКПП D68,7 d33 H104" });
    expect(storefrontParentSlug(slug) ?? slug).toBe("filtry");
  });
});

describe("a name that describes work is not placed by any automatic rule", () => {
  // The base keeps the workshop's price list among the parts: «… снятие/установка», «… замена …».
  it.each([
    "Болт колеса (шпилька) грузового снятие/устанорвка (дисковые тормоза)",
    "Осушитель воздуха снятие/установка MAN",
    "Генератор 24V ремонт замена подшипника",
    "МКПП/АКПП замена диска сцепления снятие/установка",
  ])("«%s» goes to the queue", (productName) => {
    expect(decideStorefrontCategory({ groupNames: [], productName })).toEqual({ slug: "bez-kategorii", source: "none" });
  });

  it("is still placed where staff put its 1С group", () => {
    expect(decideStorefrontCategory({ groupNames: ["СТО"], manualSlug: HIDDEN_CATEGORY_SLUG, productName: "Стартер снятие/установка" }))
      .toEqual({ slug: HIDDEN_CATEGORY_SLUG, source: "manual" });
  });

  it.each([
    // A note that the product replaces another number is not work, whatever words it is written with.
    ["LAC-503 Фильтр салона (2шт) Замена снятому LAC-511 LYNXauto", "salonnye-filtry"],
    ["ДИСК ТОРМОЗНОЙ 9019 БЕЗ КРЕПЕЖА ЗАМЕНА ДЛЯ 42101 E5320032", "tormoznye-diski"],
    ["Фильтр топливный УАЗ Хантер дв.514 (дизель) аналог 4105 (замена для 0 457 434 106) Цитрон", "toplivnye-filtry"],
  ])("places the product «%s» in %s", (productName, slug) => {
    expect(decideStorefrontCategory({ groupNames: [], productName }).slug).toBe(slug);
  });

  it.each([
    "Замена топл фильтра", "Колодки тормозные задние - замена ГАЗЕЛЬ",
    // Warming a frozen car up is work, though the name starts with the tool it is done with.
    "Тепловая пушка, отогрев/запуск легкового автотранспорта (не более 2-х часов)", "Тепловая пушка, отогрев (ДТ) один час",
  ])("keeps the work «%s» in the queue", (productName) => {
    expect(decideStorefrontCategory({ groupNames: [], productName }).slug).toBe("bez-kategorii");
  });

  it("does not take a note about a replacement number for work", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "DG11322 ЗАМЕНА НА DG11322-01 Амортизатор передний левый (TOYOTA)" }).slug)
      .toBe("amortizatory");
  });
});

describe("the rest of the third sample: oils", () => {
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it.each([
    // «п.синт.» with a dot is «semi-synthetic» as well.
    ["масло моторное Eneos SL 5w-30 п.синт. 4л.", "polusinteticheskie-motornye-masla"],
    // A two- or four-stroke oil is filed by what it is for, whatever its base.
    ["Масло моторное минеральное Castrol Outboard 4T 10W-30 1л 4566530060", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["Масло моторное 10W-40 полусинтетическое для четырёхтактных двигателей, для техники Huter, 1л.", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["LUXE Масло моторное Стандарт (STANDART) SAE 10w-40 четырехтактное п/с 1л Прада", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["МАСЛО LUXE М12ТП ДВУХТАКТНОЕ МИНЕРАЛЬНОЕ 1Л ДОЗАТОР шт.", "masla-dlya-moto-i-sadovoy-tekhniki"],
    // An oil named without the word «масло»: the grade and the pack say what it is.
    ["SHELL HELIX ULTRA ECT C3 5W-30 4Л", "motornye-masla"],
    ["+++ ALPHA'S 5W30 SN/GF-5 (бензин, синтетика) 1л (1/20)", "sinteticheskie-motornye-masla"],
    ["RN Magnum Maxtec 10w40 SL/CF (180кг)", "motornye-masla"],
    ["Gazpromneft М-10Г2 205л.", "mineralnye-motornye-masla"],
    ["Totachi ATF Dexron III (200л.)", "masla-dlya-akpp"],
  ])("%s → %s", (name, slug) => {
    expect(place(name)).toBe(slug);
  });

  it.each([
    // A size or a bare number is not an oil.
    "13x925 MMC 4D56 PajeroV## 91-, Delica 87- (AC), 6G73 Pajero V## 91- (AC), NS LD20#", "O-609 RB-EXIDE", "23250-16150",
  ])("leaves «%s» in the queue", (name) => {
    expect(place(name)).toBe("bez-kategorii");
  });
});

describe("the kit of a disc brake", () => {
  // «диск.» before «тормоза» is the adjective «дискового»: the name is a brake's repair kit, not a brake disc
  // (the third sample found it among the discs).
  it("is filed with the calipers and repair kits", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "р/к диcк.тормоза !(м)вал в сборе механизма выбора зазора (шестигран)\\SB6/SB7/SN6/SN7/SK7" }).slug)
      .toBe("supporty-i-remkomplekty");
  });
});

describe("the fourth sample: subsections", () => {
  const place = (productName: string) => decideStorefrontCategory({ groupNames: [], productName }).slug;

  it.each([
    // A lamp is filed by its marking when its name has no word for the kind (catalog-lamp-type.ts).
    ["Лампа 12V 21/5W двухконтактная (Брест) Волж.рег.", "signalnye-lampy"],
    ["Лампа Н13 12v 60/55w Auto-GUR", "galogennye-lampy"],
    ["Лампа D2R 12V 35W P32d-3, 4300K LYNXauto", "ksenonovye-lampy"],
    ["Лампа безцокольная 4 диода (белый) 24 V", "svetodiodnye-lampy"],
    // Every way the base writes «полусинтетика»: «п\синт», «псинт.», «п/синте» (found by comparing the shelves of
    // the whole base after «синт» without a dot began to mean «синтетика»).
    ["В РОЗЛИВ Масло моторное ENEOS Super Diesel CG-4 п\\синт 5W30 20л", "polusinteticheskie-motornye-masla"],
    ["Масло моторное Лукойл Супер псинт. 10W-40 4л", "polusinteticheskie-motornye-masla"],
    // «синт» as a word of its own; a GOST grade typed with a space.
    ["в розлив Моторное синт масло CF/SN ILSAC GF-5 РОСНЕФТЬ Magnum Coldtec 5W-30 60Л", "sinteticheskie-motornye-masla"],
    ["АВТОЛ Масло моторное М8 В 4л. 1*4 Новоуфимский НПЗ (АВТОЛ)", "mineralnye-motornye-masla"],
    // A filter element says what it filters.
    ["фильтрующий элемент масла·MAN TG-A D2066LF 8100021SX", "maslyanye-filtry"],
    ["STELLOX 81-00031-SX фильтрующий элемент масла!АКПП D68,7 d33 H104", "filtry-akpp-i-gidravliki"],
  ])("%s → %s", (name, slug) => {
    expect(place(name)).toBe(slug);
  });
});

describe("the names of the owner's 1С groups", () => {
  // Real group names of the base (321 groups, five levels), leaf first, then its parents.
  const byGroups = (...groupNames: string[]) => decideStorefrontCategory({ groupNames, productName: "" }).slug;

  it.each([
    // «Ф/» is «фильтр»; the number in front and the notes behind are not part of the name.
    [["01.04 Ф/маслянный"], "maslyanye-filtry"],
    [["01.04 Ф/маслянный 2023"], "maslyanye-filtry"],
    [["01.05 Ф/воздушный ОТОШЛО"], "vozdushnye-filtry"],
    [["01.06 Ф/салонный"], "salonnye-filtry"],
    [["01.03 Ф/ТопЛИвНЫЙ"], "toplivnye-filtry"],
    [["01.03 Ф/топливный (Ш)"], "toplivnye-filtry"],
    [["02.14 Фильтр воздуш"], "vozdushnye-filtry"],
    [["01.15 Линька"], "stabilizator"],
    [["02.01 Амортиз кабин"], "amortizatory"],
    [["02.38 Рул наконечники"], "rulevye-nakonechniki"],
    [["02.37 Мет/рукав (гофра)"], "gofry-i-krepleniya"],
    [["СТЕКЛО"], "stekla-i-uplotniteli"],
    [["Автоэмаль"], "kraski-i-gruntovki"],
    [["01.18 Ремкомоплект рулевой рейки"], "rulevye-reyki-i-gur"],
    [["01.12 Рулев наконеч"], "rulevye-nakonechniki"],
    [["01.13 Рулев тяга"], "rulevye-tyagi"],
    [["02.04 Тормоз накладка"], "tormoznye-kolodki"],
    [["02.32.02 Подш выжим", "02.32 Сцепление", "02. Грузовики"], "stseplenie"],
    [["Автотракторная шина", "05. А/шина легковая"], "shiny-gruzovye"],
    [["САЙЛЕНТБЛОК 2022"], "saylentbloki"],
    // A group is named like a product: the part dictionary reads it first.
    [["Катушки зажигания"], "katushki-zazhiganiya"],
    [["Подушки ДВС"], "opory-dvigatelya"],
    [["Шпильки колесные"], "kolesnyy-krepezh"],
    [["Щетки генератора", "Щетки"], "generatory-i-startery"],
    [["02.32 Сцепление"], "stseplenie"],
    [["Свечи зажигания"], "svechi-zazhiganiya"],
    // Tyre repair and tyres.
    [["11. Шинка"], "shinomontazh"],
    [["11.03 Гриб", "11. Шинка"], "shinomontazh"],
    [["11.06 Вентель", "11. Шинка"], "shinomontazh"],
    [["05. А/шина легковая"], "shiny-legkovye"],
    [["05.01 R13", "05. А/шина легковая"], "shiny-legkovye"],
    // The leaf is read together with its parents' words…
    [["05.08 Диски", "05. А/шина легковая"], "kolesnye-diski"],
    [["02.32.01 Диск", "02.32 Сцепление", "02. Грузовики"], "stseplenie"],
    [["02.32.03 Корзина", "02.32 Сцепление", "02. Грузовики"], "stseplenie"],
    // …and a leaf that names a kind narrows its parent instead of replacing it.
    [["06.06 Мото", "06. АКБ"], "akkumulyatory-moto"],
    // The groups of the shelves added with migration 0049.
    [["15. + Фитинг"], "shlangi-i-fitingi"],
    [["15.01 Фитинг ПВХ", "15. + Фитинг"], "fitingi-pvh"],
    [["15.1.1 Прямой", "15.01 Фитинг ПВХ", "15. + Фитинг"], "fitingi-pvh"],
    [["15.02 Фитинг мет", "15. + Фитинг"], "fitingi-metallicheskie"],
    [["15.04 Штуцер мет", "15. + Фитинг"], "fitingi-metallicheskie"],
    [["18. + Шланг"], "trubki-i-shlangi-na-metrazh"],
    [["16. Трубка ПВХ"], "trubki-i-shlangi-na-metrazh"],
    [["Пресс (РВД)"], "rvd"],
    [["Муфта", "Пресс (РВД)"], "rvd"],
    [["Banjo", "ФИТИНГ", "Пресс (РВД)"], "rvd"],
    [["14. Автономка"], "avtonomnye-otopiteli"],
    [["14.04 Webasto", "14. Автономка"], "avtonomnye-otopiteli"],
    // A leaf that names only the section, or only a universal part, is read together with its parents.
    [["15.1.4 Фитинг Т", "15.01 Фитинг ПВХ", "15. + Фитинг"], "fitingi-pvh"],
    [[".З Фитинг Г", "15.01 Фитинг ПВХ", "15. + Фитинг"], "fitingi-pvh"],
    [["Рукав", "Пресс (РВД)"], "rvd"],
  ])("%j → %s", (groupNames, slug) => {
    expect(byGroups(...groupNames)).toBe(slug);
  });

  it.each([
    // The workshop's price list gives no section, and neither does anything inside it.
    [["Шиномонтажа"]], [["Легковой", "Шиномонтажа"]], [["Рем колеса", "Шиномонтажа"]], [["Ремонт грузовой", "СТО"]], [["ГСМ", "СТО"]], [["Услуги доставки"]],
    [["Изготовление РВД", "СТО"]],
    // Groups by vehicle, by supplier, and mixed ones say nothing about the part.
    [["01. Легковая", "...2022"]], [["Росcко", "...2022"]], [["07. Масло", "...2022"]], [["02.33 MA3", "02. Грузовики", "...2022"]],
  ])("%j gives no section", (groupNames) => {
    expect(byGroups(...groupNames)).toBe("bez-kategorii");
  });

  it("still lets the product's own name narrow the group's section", () => {
    expect(decideStorefrontCategory({ groupNames: ["07.03 Mobil", "07. Масло"], productName: "Масло моторное Mobil Super 3000 5W-40 синт. 4л" }).slug)
      .toBe("sinteticheskie-motornye-masla");
  });

  it("does not take a group of repair kits for the workshop", () => {
    expect(byGroups("Ремонтные комплекты суппорта")).toBe("supporty-i-remkomplekty");
  });
});

describe("a product's name against its 1С group (pairs made of the base's real names and groups)", () => {
  const place = (productName: string, ...groupNames: string[]) => decideStorefrontCategory({ groupNames, productName });

  it("files a universal part with nothing in its name where its group puts it", () => {
    // A bare seal or bearing serves whatever unit the owner filed it under.
    expect(place("Сальник 35x50x8 NOK", "02.21.02 Ступица сальник", "02.21 Ступица", "02. Грузовики"))
      .toEqual({ slug: "stupitsy-i-podshipniki", source: "group" });
    expect(place("(FAG 32310A) Подшипник роликовый 50x110x42 BPW/MAN 84-40202-SX", "02.21.01 Ступица подшип", "02.21 Ступица", "02. Грузовики"))
      .toEqual({ slug: "stupitsy-i-podshipniki", source: "group" });
  });

  it("reads a group named only «Подшипник» together with the groups above it", () => {
    expect(place("Подшипник 6205 2RS", "01.09 Подшипник", "02.32.02 Подш выжим", "02.32 Сцепление").slug).toBe("stseplenie");
  });

  it("lets a name whose own words pick the shelf win inside the group's section as well", () => {
    expect(place("Пыльник амортизатора TOYOTA COROLLA 48157-12080", "Амортизаторы", "01. Легковая"))
      .toEqual({ slug: "opory-i-pylniki", source: "name" });
  });

  it("still lets a seal that names its unit win over a general seal group", () => {
    expect(place("AH2847-M0 NOK Сальник FR привода TOYOTA", "01.08 Сальник", "01. Легковая").slug).toBe("shrusy-i-privody");
  });

  it("files a bare fitting or hose where the owner filed it", () => {
    expect(place("ШТУЦЕР 16-22", "ФИТИНГ", "Пресс (РВД)")).toEqual({ slug: "rvd", source: "group" });
    expect(place("РУКАВ", "Рукав", "Пресс (РВД)")).toEqual({ slug: "rvd", source: "group" });
  });

  it("keeps a fitting that names its own kind on that shelf, whatever the group", () => {
    expect(place("Фитинг угловой трубки ПВХ 14 мм PUL14 DA-NP200", "15.02 Фитинг мет", "15. + Фитинг"))
      .toEqual({ slug: "fitingi-pvh", source: "name" });
  });

  it("keeps a tyre where the owner filed it, whatever its size suggests", () => {
    expect(place("А/шина 205/70R15 КАМА VIATTI-526 (зима)", "03.02 Грузовая б/у Евро", "03. А/шина грузовая"))
      .toEqual({ slug: "shiny-gruzovye", source: "group" });
  });
});

describe("a part number typed without a space before the name", () => {
  // «LAC-201Фильтр салона», «C-307Фильтр масл»: ten filters of the owner's base sat in the queue because the section
  // rules read «201фильтр» as one word.
  it.each([
    ["LAC-201Фильтр салона Miles AFW1239 (K1255, CU1936, LAC-201) LAC201", "salonnye-filtry"],
    ["C-307Фильтр масл VIC", "maslyanye-filtry"],
    ["FF-105фильтр топливный CUM FF105", "toplivnye-filtry"],
    ["LA-1127Фильтр воздушный A3002 Sakura BMW Serie 5 88-95", "vozdushnye-filtry"],
  ])("%s → %s", (productName, slug) => {
    expect(decideStorefrontCategory({ groupNames: [], productName }).slug).toBe(slug);
  });
});

describe("a bush named only by a Honda original number", () => {
  it("is filed by the number", () => {
    expect(decideStorefrontCategory({ groupNames: [], productName: "HSB-051 Втулка TG-51306-S47-003 * Ti·GUAR" }))
      .toEqual({ slug: "stabilizator", source: "number" });
  });
});

describe("a battery whose name gives its cranking current", () => {
  // «пусковой ток 550 А» is a property of the battery; only jump leads are «пусковые» (fifth sample).
  it.each([
    ["АКБ Аккумулятор FB SUPER NOVA 55D23L 60 Ah, пусковой ток 550 А, 230x169x225", "akkumulyatory-legkovye"],
    // No capacity in the name («220-3» is the model): the section, without a subsection.
    ["АКБ AKTEX AT 220-3-п.п (пусковой ток 1550 A (EN) 58 кг) конус", "akkumulyatory"],
    ['Провода пусковые "Autoprofi", 100% ССА, 43мм2, 750A (SAE: 2,5V drop), 200A, 2,2м', "provoda-i-klemmy"],
    ["Зажимы-крокодилы для пусковых проводов, 50 А, 98 мм, набор 2 шт. 3120404", "provoda-i-klemmy"],
  ])("%s → %s", (productName, slug) => {
    expect(decideStorefrontCategory({ groupNames: [], productName }).slug).toBe(slug);
  });

  it("does not take a tractor's starting engine for a battery lead", () => {
    const { slug } = decideStorefrontCategory({ groupNames: [], productName: "ПДМ (пусковой двигатель модифиц) без стартера (10812)" });
    expect(slug).not.toBe("provoda-i-klemmy");
  });
});
