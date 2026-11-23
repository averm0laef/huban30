// Real-world customer queries the catalog search must answer, checked
// against the fixture catalog in catalog-search-fixtures.ts by
// catalog-search-regression.test.ts. Keys refer to FixtureProduct.key.

import { fixtureSku } from "./catalog-search-fixtures.js";

export interface SearchCase {
  q: string;
  group: string;
  params?: Record<string, string>;
  expect: {
    /** This product must be the first result. */
    first?: string;
    /** These products must appear within the first `topN` (default 10) results. */
    top?: string[];
    topN?: number;
    /** These products must never be returned. */
    excludes?: string[];
    minTotal?: number;
    empty?: boolean;
    /** Among rows with the same name, none out of stock ranks above one in stock. */
    inStockFirst?: boolean;
    /** Must find exactly as many products as this other spelling of the query. */
    sameTotalAs?: string;
    /** Rows whose name starts with this come before every other row. */
    leadingNames?: string;
    /** Every returned name matches this regular expression (case-insensitive). */
    pageNames?: string;
  };
}

const HIDDEN = ["hidden-inactive", "hidden-deleted", "hidden-category", "hidden-brand"];

export const SEARCH_REGRESSION_CASES: SearchCase[] = [
  // Article in any spelling.
  // The shop's own code written in the name («(КС171) Фильтр топливный…»), typed in either alphabet. A query shaped
  // like a part number used to be looked up among articles and crosses only, and found nothing.
  { group: "code-in-name", q: "КС171", expect: { first: "kc171-cyrillic", excludes: ["kc117-latin"] } },
  { group: "code-in-name", q: "KC171", expect: { first: "kc171-cyrillic", excludes: ["kc117-latin"] } },
  { group: "code-in-name", q: "кс171", expect: { first: "kc171-cyrillic" } },
  { group: "code-in-name", q: "КС 171", expect: { first: "kc171-cyrillic" } },
  { group: "code-in-name", q: "KC117", expect: { first: "kc117-latin", excludes: ["kc171-cyrillic"] } },
  { group: "code-in-name", q: "КС117", expect: { first: "kc117-latin" } },
  // The article of another maker written at the end of the name, with its dashes or without.
  { group: "code-in-name", q: "8220434SX", expect: { first: "kc117-latin" } },
  { group: "code-in-name", q: "82-00414-SX", expect: { first: "kc171-cyrillic" } },
  // «Велопокрышка» is what the base calls it; the customer types two words.
  { group: "everyday", q: "покрышка велосипед", expect: { first: "velo-tyre" } },
  { group: "everyday", q: "покрышка на велик", expect: { first: "velo-tyre" } },
  { group: "everyday", q: "велосипедная покрышка", expect: { first: "velo-tyre" } },
  { group: "everyday", q: "камера велосипед", expect: { first: "velo-tube" } },
  { group: "article", q: "W914/2", expect: { first: "mann-w914-2", top: ["unigom-w9142"], topN: 2 } },
  { group: "article", q: "w 914/2", expect: { first: "mann-w914-2" } },
  { group: "article", q: "W9142", expect: { top: ["mann-w914-2", "unigom-w9142"], topN: 2 } },
  { group: "article", q: "w914-2", expect: { first: "mann-w914-2" } },
  { group: "article", q: "W 914 / 2", expect: { first: "mann-w914-2" } },
  { group: "article", q: "w.914.2", expect: { first: "mann-w914-2" } },
  { group: "article", q: "  W914/2  ", expect: { first: "mann-w914-2" } },
  { group: "article", q: "mann w914/2", expect: { first: "mann-w914-2", excludes: ["unigom-w9142"] } },
  { group: "article", q: "W914/2 манн", expect: { first: "mann-w914-2", excludes: ["unigom-w9142"] } },
  { group: "article", q: "0 986 494 104", expect: { first: "bosch-0986494104" } },
  { group: "article", q: "0986494104", expect: { first: "bosch-0986494104" } },
  { group: "article", q: "0-986-494-104", expect: { first: "bosch-0986494104" } },
  { group: "article", q: "бош 0986494104", expect: { first: "bosch-0986494104" } },
  { group: "article", q: "0986494104 колодки", expect: { first: "bosch-0986494104" } },
  { group: "article", q: "HU7008Z", expect: { first: "mann-hu7008z" } },
  { group: "article", q: "hu 7008 z", expect: { first: "mann-hu7008z" } },
  { group: "article", q: "BKR6E", expect: { first: "ngk-bkr6e", top: ["ngk-bkr6e-11"], topN: 2 } },
  { group: "article", q: "bkr6e11", expect: { first: "ngk-bkr6e-11" } },
  { group: "article", q: "DF4294", expect: { first: "trw-df4294", top: ["trw-df4294s"], topN: 2 } },
  { group: "article", q: "09A72711", expect: { first: "brembo-09a72711" } },
  { group: "article", q: "09.a727.11", expect: { first: "brembo-09a72711" } },
  { group: "article", q: "3456701", expect: { first: "lemforder-3456701" } },
  { group: "article", q: "207465", expect: { first: "lukoil-lux-5w40-4" } },
  { group: "article", q: "914/2", expect: { top: ["mann-w914-2"], topN: 3 } },
  { group: "article", q: "0092S40050", expect: { first: "bosch-s4005" } },
  // Cyrillic look-alike letters typed instead of Latin (and 1C storing Cyrillic).
  { group: "homoglyph", q: "С30005", expect: { first: "mann-c30005" } },
  { group: "homoglyph", q: "C30005", expect: { first: "mann-c30005" } },
  { group: "homoglyph", q: "c 30 005", expect: { first: "mann-c30005" } },
  { group: "homoglyph", q: "ОС90", expect: { first: "mahle-oc90" } },
  { group: "homoglyph", q: "ос 90", expect: { first: "mahle-oc90" } },
  { group: "homoglyph", q: "НU7008Z", expect: { first: "mann-hu7008z" } },
  { group: "homoglyph", q: "ВКR6Е", expect: { first: "ngk-bkr6e" } },
  { group: "homoglyph", q: "РFВ401", expect: { first: "trw-pfb401" } },
  { group: "homoglyph", q: "КХ70D", expect: { first: "mahle-kx70d" } },
  { group: "homoglyph", q: "СТ1028", expect: { first: "contitech-ct1028" } },
  { group: "homoglyph", q: "МАNN W914/2", expect: { first: "mann-w914-2" } },
  { group: "homoglyph", q: "Н7", expect: { top: ["philips-h7", "osram-h7"], topN: 4 } },
  // Wrong keyboard layout.
  { group: "layout", q: "vfckj", expect: { sameTotalAs: "масло", minTotal: 20 } },
  { group: "layout", q: "ajkmnh", expect: { minTotal: 20, pageNames: "^Фильтр" } },
  { group: "layout", q: "rjkjlrb", expect: { sameTotalAs: "колодки", minTotal: 10 } },
  { group: "layout", q: "ajkmnh vfckzysq", expect: { top: ["mann-w914-2"], topN: 24 } },
  { group: "layout", q: "vfckj 5w40", expect: { top: ["lukoil-lux-5w40-4", "shell-hx8-5w40-4"], topN: 12 } },
  { group: "layout", q: "ищыср", expect: { sameTotalAs: "bosch", minTotal: 30 } },
  { group: "layout", q: "ьфтт", expect: { sameTotalAs: "mann", minTotal: 15 } },
  { group: "layout", q: "o`nrf", expect: { top: ["bosch-3397007297"], topN: 24 } },
  // ё / е.
  { group: "yo", q: "щетка стеклоочистителя", expect: { top: ["bosch-3397007297", "champion-winter"], topN: 24 } },
  { group: "yo", q: "щётка", expect: { top: ["bosch-3397007297"], topN: 24 } },
  { group: "yo", q: "герметик черный", expect: { first: "liqui-sealant" } },
  { group: "yo", q: "антифриз зеленый", expect: { minTotal: 1 } },
  // Word forms.
  { group: "forms", q: "колодки", expect: { minTotal: 40, inStockFirst: true, excludes: ["trw-df4294"] } },
  { group: "forms", q: "колодок", expect: { sameTotalAs: "колодки" } },
  { group: "forms", q: "колодка", expect: { top: ["brembo-p85020"], topN: 24, sameTotalAs: "колодки" } },
  { group: "forms", q: "тормозных колодок", expect: { sameTotalAs: "колодки тормозные" } },
  { group: "forms", q: "фильтры", expect: { top: ["mann-w914-2"], topN: 24, minTotal: 20 } },
  { group: "forms", q: "фильтров масляных", expect: { minTotal: 10 } },
  { group: "forms", q: "масла", expect: { minTotal: 20 } },
  { group: "forms", q: "свечи", expect: { top: ["ngk-bkr6e"], topN: 24, minTotal: 10 } },
  { group: "forms", q: "свечей зажигания", expect: { top: ["ngk-bkr6e"], topN: 24, minTotal: 10 } },
  { group: "forms", q: "щеток", expect: { sameTotalAs: "щетка" } },
  { group: "forms", q: "щётки", expect: { top: ["valeo-vf423"], topN: 24 } },
  { group: "forms", q: "дворники", expect: { minTotal: 10 } },
  { group: "forms", q: "лампы", expect: { minTotal: 10 } },
  { group: "forms", q: "аккумуляторы", expect: { minTotal: 5 } },
  { group: "forms", q: "диски тормозные", expect: { top: ["trw-df4294", "bosch-0986478868"], topN: 24, leadingNames: "Диск" } },
  { group: "forms", q: "амортизаторы", expect: { top: ["kyb-334834"] } },
  // Typos.
  { group: "typo", q: "фильр", expect: { minTotal: 20 } },
  { group: "typo", q: "фильтр маслянный", expect: { top: ["mann-w914-2"], topN: 24 } },
  { group: "typo", q: "маслянный фильтр", expect: { top: ["mann-w914-2"], topN: 24 } },
  { group: "typo", q: "калодки", expect: { minTotal: 10 } },
  { group: "typo", q: "амартизатор", expect: { top: ["kyb-334834"] } },
  { group: "typo", q: "аккамулятор", expect: { minTotal: 5 } },
  { group: "typo", q: "антифирз", expect: { top: ["felix-g12-5"] } },
  { group: "typo", q: "фольтр", expect: { minTotal: 20, pageNames: "фильтр" } },
  { group: "typo", q: "акумулятор", expect: { minTotal: 3, pageNames: "аккумулятор" } },
  { group: "typo", q: "mobli", expect: { top: ["mobil-1-0w40-4"], topN: 24, pageNames: "mobil" } },
  // A long word that only shares its ending with other words is not their typo: the shop has no generators
  // or resonators among the samples, and says so instead of showing shock absorbers, fixatives and radiators.
  // A word of the assortment finds its own goods, not the «очиститель» that shares its ending.
  { group: "typo", q: "глушитель", expect: { first: "muffler-2101", pageNames: "глушител" } },
  { group: "typo", q: "глушытель", expect: { first: "muffler-2101", pageNames: "глушител" } },
  { group: "synonym", q: "глушак", expect: { first: "muffler-2101", pageNames: "глушител" } },
  { group: "typo", q: "дмрв", expect: { first: "dmrv-cleaner", pageNames: "дмрв" } },
  { group: "typo", q: "генератор", expect: { empty: true } },
  { group: "typo", q: "резонатор", expect: { empty: true } },
  // Word order, partial words.
  { group: "order", q: "масляный фильтр", expect: { top: ["mann-w914-2", "mahle-oc90"], topN: 24 } },
  { group: "order", q: "тормозные колодки передние", expect: { top: ["bosch-0986494104", "trw-gdb1330"], topN: 24 } },
  { group: "order", q: "передние колодки", expect: { top: ["bosch-0986494104"], topN: 24 } },
  { group: "partial", q: "тормоз", expect: { minTotal: 80, inStockFirst: true } },
  { group: "partial", q: "фильт", expect: { minTotal: 20 } },
  { group: "partial", q: "аморт", expect: { top: ["kyb-334834"] } },
  { group: "partial", q: "стеклоочист", expect: { minTotal: 10 } },
  // Brand only, brand + type.
  { group: "brand", q: "bosch", expect: { minTotal: 30, excludes: HIDDEN } },
  { group: "brand", q: "бош", expect: { sameTotalAs: "bosch" } },
  { group: "brand", q: "Бош", expect: { minTotal: 30 } },
  { group: "brand", q: "манн", expect: { sameTotalAs: "mann" } },
  { group: "brand", q: "mann", expect: { minTotal: 15, excludes: HIDDEN } },
  { group: "brand", q: "mann-filter", expect: { sameTotalAs: "mann" } },
  { group: "brand", q: "манн фильтр", expect: { top: ["mann-w914-2"], topN: 24 } },
  { group: "brand", q: "кастрол", expect: { top: ["castrol-edge-5w30-4"], topN: 24 } },
  { group: "brand", q: "мобил", expect: { top: ["mobil-1-0w40-4"], topN: 24 } },
  { group: "brand", q: "шелл", expect: { top: ["shell-hx8-5w40-4"], topN: 24 } },
  { group: "brand", q: "lukoil", expect: { sameTotalAs: "лукойл", minTotal: 10 } },
  { group: "brand", q: "лукойл", expect: { top: ["lukoil-lux-5w40-4"], topN: 24 } },
  { group: "brand", q: "lemforder", expect: { top: ["lemforder-3456701"] } },
  { group: "brand", q: "лемфордер", expect: { top: ["lemforder-3456701"], sameTotalAs: "lemforder" } },
  { group: "brand", q: "febi", expect: { top: ["febi-27155"], topN: 24 } },
  { group: "brand", q: "феби", expect: { sameTotalAs: "febi", minTotal: 5 } },
  { group: "brand", q: "трв", expect: { sameTotalAs: "trw" } },
  { group: "brand", q: "нгк", expect: { top: ["ngk-bkr6e"], topN: 24 } },
  { group: "brand", q: "ликви моли", expect: { top: ["liqui-sealant"], topN: 24 } },
  { group: "brand", q: "варта", expect: { top: ["varta-e11"], topN: 24 } },
  { group: "brand+type", q: "mann масляный фильтр", expect: { top: ["mann-w914-2"], excludes: ["mahle-oc90", "febi-27155"], topN: 24 } },
  { group: "brand+type", q: "фильтр масляный манн", expect: { top: ["mann-w914-2"], excludes: ["mahle-oc90"], topN: 24 } },
  { group: "brand+type", q: "bosch колодки", expect: { top: ["bosch-0986494104"], excludes: ["trw-gdb1330"], topN: 24 } },
  { group: "brand+type", q: "колодки trw", expect: { top: ["trw-gdb1330"], excludes: ["bosch-0986494104"], topN: 24 } },
  { group: "brand+type", q: "свечи ngk", expect: { top: ["ngk-bkr6e"], excludes: ["bosch-0242235668"], topN: 24 } },
  { group: "brand+type", q: "щетки бош", expect: { top: ["bosch-3397007297"], excludes: ["valeo-vf423"], topN: 24 } },
  { group: "brand+type", q: "аккумулятор varta 60", expect: { first: "varta-d24" } },
  // Oil viscosity and volume.
  { group: "oil", q: "5w40", expect: { top: ["lukoil-lux-5w40-4", "shell-hx8-5w40-4", "sintec-platinum-5w40-4"], topN: 12, excludes: ["castrol-edge-5w30-4"] } },
  { group: "oil", q: "5w-40", expect: { top: ["lukoil-lux-5w40-4", "sintec-platinum-5w40-4"], topN: 12, excludes: ["castrol-edge-5w30-4"] } },
  { group: "oil", q: "5W 40", expect: { top: ["lukoil-lux-5w40-4", "sintec-platinum-5w40-4"], topN: 12, excludes: ["castrol-edge-5w30-4"] } },
  { group: "oil", q: "5в40", expect: { top: ["lukoil-lux-5w40-4"], topN: 12, excludes: ["castrol-edge-5w30-4"] } },
  { group: "oil", q: "масло 5w30", expect: { top: ["castrol-edge-5w30-4", "lukoil-genesis-5w30-4"], topN: 24, excludes: ["lukoil-lux-5w40-4"] } },
  { group: "oil", q: "масло 5w-40 4л", expect: { top: ["lukoil-lux-5w40-4", "shell-hx8-5w40-4", "sintec-platinum-5w40-4"], topN: 12, excludes: ["lukoil-lux-5w40-1"] } },
  { group: "oil", q: "масло 5w40 4 л", expect: { top: ["lukoil-lux-5w40-4", "shell-hx8-5w40-4"], topN: 12, excludes: ["lukoil-lux-5w40-1"] } },
  { group: "oil", q: "лукойл люкс 5w40 4л", expect: { first: "lukoil-lux-5w40-4" } },
  { group: "oil", q: "castrol 5w30", expect: { first: "castrol-edge-5w30-4" } },
  { group: "oil", q: "масло моторное 4 литра", expect: { top: ["lukoil-lux-5w40-4"], topN: 24, excludes: ["lukoil-lux-5w40-1"] } },
  { group: "oil", q: "75w90", expect: { first: "castrol-syntrans-75w90" } },
  { group: "oil", q: "жидкость тормозная dot4", expect: { top: ["trw-pfb401"] } },
  // Vehicle-free property queries.
  { group: "property", q: "h7", expect: { top: ["philips-h7", "osram-h7"], topN: 4, excludes: ["philips-h4"] } },
  { group: "property", q: "лампа h4", expect: { top: ["philips-h4", "osram-h4"], topN: 4 } },
  { group: "property", q: "щетка 600 мм", expect: { top: ["bosch-3397007297"], excludes: ["bosch-3397018802"] } },
  { group: "property", q: "аккумулятор 60ач", expect: { top: ["bosch-s4005", "varta-d24"], excludes: ["varta-e11"] } },
  { group: "property", q: "лампа h7 12v", expect: { top: ["philips-h7", "osram-h7"], topN: 2 } },
  { group: "property", q: "жидкость тормозная 0,5 л", expect: { first: "trw-pfb401" } },
  // Hidden rows never surface, a part that is not in stock lists last.
  { group: "hidden", q: "W914/3", expect: { empty: true } },
  { group: "hidden", q: "W914/4", expect: { empty: true } },
  { group: "hidden", q: "W920/21", expect: { empty: true } },
  { group: "hidden", q: "SB-100", expect: { empty: true } },
  { group: "hidden", q: "фильтр масляный", expect: { excludes: HIDDEN, minTotal: 10 } },
  { group: "hidden", q: "снятый бренд", expect: { empty: true } },
  { group: "ranking", q: "колодки тормозные дисковые передние", expect: { inStockFirst: true, top: ["bosch-0986494104"], topN: 24, pageNames: "^Колодки тормозные" } },
  { group: "ranking", q: "диск тормозной передний", expect: { inStockFirst: true, first: "trw-df4294", leadingNames: "Диск" } },
  // The name starts with its article: it still starts with the part the customer named.
  { group: "ranking", q: "диск тормозной задний", expect: { top: ["brembo-09a42511"], leadingNames: "Диск" } },
  { group: "ranking", q: "масло моторное", expect: { inStockFirst: true } },
  // Concrete part numbers never turn into a fuzzy neighbour.
  { group: "precision", q: "GDB1331", expect: { empty: true } },
  { group: "precision", q: "0986494106", expect: { empty: true } },
  // Filters still apply on top of the query.
  { group: "filters", q: "фильтр", params: { availability: "in_stock" }, expect: { excludes: ["mann-w712-75", "mann-cuk2939"], minTotal: 10 } },
  { group: "filters", q: "колодки", params: { category: "sf-tormoznaya-sistema", sort: "price_asc" }, expect: { minTotal: 10 } },
  // Everyday names and Latin names typed in Cyrillic.
  // Names typed in 1С with shorthand or with a Latin look-alike letter are found by the proper word: the exchange
  // adds the words such a name is read by to its search text (catalog-search-reading.ts).
  { group: "reading", q: "предохранитель", expect: { top: ["fuse-plain", "fuse-shorthand"] } },
  { group: "reading", q: "ароматизатор", expect: { top: ["scent-plain", "scent-shorthand"] } },
  { group: "reading", q: "высоковольтные провода", expect: { top: ["leads-plain", "leads-shorthand"] } },
  { group: "reading", q: "тяга", expect: { top: ["rod-latin-t"] } },
  { group: "synonym", q: "тормозуха", expect: { first: "trw-pfb401" } },
  // Everyday names of parts, measured on the owner's assortment on 22.11.2026: these found nothing, or the wrong
  // goods, because the catalogue calls the part by another word.
  { group: "synonym", q: "гранаты", expect: { top: ["cv-joint", "cv-boot"] } },
  { group: "synonym", q: "пыльник гранаты", expect: { first: "cv-boot" } },
  { group: "synonym", q: "косточки", expect: { top: ["link-front"], pageNames: "стабилизатор" } },
  { group: "synonym", q: "саленблок", expect: { top: ["bush-t", "bush-no-t"] } },
  { group: "synonym", q: "бронепровода", expect: { top: ["leads-plain", "leads-shorthand"], pageNames: "провод" } },
  { group: "synonym", q: "воздушник", expect: { top: ["mann-c30005"], topN: 24, pageNames: "фильтр" } },
  { group: "synonym", q: "салонник", expect: { top: ["mann-cu2939"], topN: 24, pageNames: "фильтр" } },
  { group: "synonym", q: "топливник", expect: { top: ["mann-wk820-1"], topN: 24, pageNames: "фильтр" } },
  { group: "synonym", q: "вд40", expect: { first: "wd40" } },
  { group: "synonym", q: "вэдэшка", expect: { first: "wd40" } },
  { group: "synonym", q: "секретки", expect: { first: "lock-nuts" } },
  { group: "synonym", q: "вонючка", expect: { top: ["scent-plain", "scent-shorthand"], pageNames: "аром" } },
  { group: "synonym", q: "пахучка", expect: { top: ["scent-plain", "scent-shorthand"], pageNames: "аром" } },
  { group: "synonym", q: "балонник", expect: { top: ["wheel-wrench-one-l", "wheel-wrench-two-l"], pageNames: "ключ" } },
  { group: "synonym", q: "баллонный ключ", expect: { top: ["wheel-wrench-one-l", "wheel-wrench-two-l"], pageNames: "ключ" } },
  // The gearbox is «коробка» to the customer and «трансмиссионное», «АКПП», «МКПП» in the names.
  { group: "synonym", q: "масло в коробку", expect: { top: ["castrol-syntrans-75w90", "zic-atf"], pageNames: "трансмисс|кпп" } },
  { group: "synonym", q: "масло для коробки", expect: { top: ["castrol-syntrans-75w90", "zic-atf"], pageNames: "трансмисс|кпп" } },
  // «коробка 9» is the shelf box written into a name: it stays a literal word.
  { group: "synonym", q: "коробка 9", expect: { first: "clip-noted" } },
  // …and the plain query next to an everyday one keeps its answer.
  { group: "synonym", q: "стойки стабилизатора", expect: { top: ["link-front"], pageNames: "стабилизатор" } },
  { group: "synonym", q: "незамерзайка", expect: { top: ["sintec-washer-4"], topN: 3 } },
  { group: "synonym", q: "дворники 600", expect: { top: ["bosch-3397007297"], topN: 3, pageNames: "щ[её]тк.*600" } },
  { group: "synonym", q: "акб 60", expect: { pageNames: "аккумулятор" } },
  { group: "translit", q: "шелл хеликс", expect: { top: ["shell-hx8-5w40-4", "shell-ultra-5w30-4"], topN: 24, pageNames: "shell helix" } },
  { group: "translit", q: "гдб1330", expect: { first: "trw-gdb1330" } },
];

export function searchCaseFailure(
  testCase: SearchCase,
  result: { items: Array<{ sku: string; name: string; availableQuantity: number }>; total: number },
  reference?: { total: number },
): string | null {
  const skus = result.items.map((item) => item.sku);
  const expected = testCase.expect;
  const show = (count: number) => skus.slice(0, count).join(" | ") || "nothing";
  if (expected.empty) return result.total === 0 ? null : `expected nothing, got ${show(5)}`;
  if (result.total === 0) return "nothing found";
  if (expected.first && skus[0] !== fixtureSku(expected.first)) {
    return `expected first ${fixtureSku(expected.first)}, got ${show(5)}`;
  }
  const within = expected.topN ?? 10;
  for (const key of expected.top ?? []) {
    if (!skus.slice(0, within).includes(fixtureSku(key))) return `expected ${fixtureSku(key)} in top ${within}, got ${show(within)}`;
  }
  for (const key of expected.excludes ?? []) {
    if (skus.includes(fixtureSku(key))) return `must not return ${fixtureSku(key)}`;
  }
  if (expected.minTotal !== undefined && result.total < expected.minTotal) {
    return `expected at least ${expected.minTotal} results, got ${result.total}`;
  }
  if (expected.sameTotalAs !== undefined && reference && reference.total !== result.total) {
    return `found ${result.total}, but "${expected.sameTotalAs}" finds ${reference.total}`;
  }
  if (expected.leadingNames !== undefined) {
    const leading = result.items.map((item) => item.name.startsWith(expected.leadingNames!));
    if (leading.indexOf(false) !== -1 && leading.lastIndexOf(true) > leading.indexOf(false)) {
      return `a row not starting with "${expected.leadingNames}" ranks above one that does`;
    }
  }
  if (expected.pageNames !== undefined) {
    const stray = result.items.find((item) => !new RegExp(expected.pageNames!, "iu").test(item.name));
    if (stray) return `"${stray.name}" does not match /${expected.pageNames}/`;
  }
  if (expected.inStockFirst) {
    const byName = new Map<string, boolean[]>();
    for (const item of result.items) byName.set(item.name, [...(byName.get(item.name) ?? []), item.availableQuantity > 0]);
    for (const [name, stock] of byName) {
      if (stock.indexOf(false) !== -1 && stock.lastIndexOf(true) > stock.indexOf(false)) {
        return `"${name}": an out-of-stock row ranks above an in-stock one`;
      }
    }
  }
  return null;
}
