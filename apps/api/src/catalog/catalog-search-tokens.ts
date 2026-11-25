// Word-by-word search plan for a free-text catalog query.
//
// A query is split into words; a product matches when EVERY word matches
// its document (article + name + brand) through AT LEAST ONE of that
// word's alternatives. Alternatives only ever add ways for the same word
// to match -- the literal word is always one of them:
//
//   - the literal word, as a substring (a word still being typed) or, from
//     4 letters, as a close spelling (a typo, `fuzzy`);
//   - a light Russian stem ("колодок" -> "колодк", "фильтров" -> "фильтр"),
//     as a substring: PostgreSQL's Snowball stemmer misses fleeting vowels;
//   - the word typed with the wrong keyboard layout ("vfckj" -> "масло",
//     "ищыср" -> "bosch") and its phonetic transliteration ("filtr");
//   - Cyrillic look-alike letters read as Latin when a word mixes digits
//     or scripts ("Н7" -> "h7", "МАNN" -> "mann");
//   - every known spelling of a brand ("бош" -> bosch, "lukoil" -> лукойл);
//   - a regular expression for a measurement, so "5w40", "5W 40", "5в-40"
//     all find "5W-40" (and not "15W-40"), "4л" finds "4 л"/"4 литра" (and
//     not "14 л" or "0,4 л"), and a short number matches whole numbers only.
//
// The plan is computed once per request in TypeScript and sent as parallel
// arrays (see CatalogPublicService), so this stays one SQL statement.

import { foldHomoglyphs, foldYo, normalizeSearchQuery, swapKeyboardLayoutToCyrillic, swapKeyboardLayoutToLatin, transliterateLatinToCyrillic } from "./catalog-search-normalize.js";
import { MULTI_WORD_BRAND_SPELLINGS, searchBrandSpellings } from "./catalog-search-identity.js";

export interface SearchTokenAlternative {
  /** 1-based word number the alternative belongs to. */
  word: number;
  /** Lower-case text matched as a substring; null for a pattern alternative. */
  text: string | null;
  /** PostgreSQL regular expression matched against the lower-case document. */
  pattern: string | null;
  /** Also accept a close spelling (pg_trgm word_similarity). */
  fuzzy: boolean;
  /**
   * Canonical measurement key for a pattern alternative ("visc:5w40",
   * "4л", "0.5л", "600мм", "num:60"): what an external search engine stores
   * per product (apps/worker/src/search-index/product-documents.ts builds
   * the same keys from product names).
   */
  measure?: string;
}

export interface SearchTokenPlan {
  words: string[];
  alternatives: SearchTokenAlternative[];
  /** Lower-case stems a product name may start with: the product type the customer named. */
  leads: string[];
}

const MAX_WORDS = 8;
/** Prepositions and conjunctions of an everyday query. */
const LITTLE_WORDS = new Set(["на", "для", "от", "по", "под", "из", "за", "до", "при", "или", "ко", "во", "со", "об"]);
const MAX_ALTERNATIVES_PER_WORD = 8;

// Measurement units: customer spellings -> canonical unit and the regex
// alternation matching how 1C names write it. Longest spellings first.
const UNITS: ReadonlyArray<{ unit: string; spellings: string[]; pattern: string }> = [
  { unit: "мл", spellings: ["мл", "ml"], pattern: "(мл|ml)" },
  { unit: "л", spellings: ["литров", "литра", "литр", "ltr", "lt", "л", "l"], pattern: "(л|l|lt|ltr|литр[а-я]*)" },
  { unit: "кг", spellings: ["кг", "kg"], pattern: "(кг|kg)" },
  { unit: "мм", spellings: ["мм", "mm"], pattern: "(мм|mm)" },
  { unit: "ач", spellings: ["а/ч", "a/h", "ач", "ah"], pattern: "(ач|ah|а/ч|a/h)" },
  { unit: "вт", spellings: ["ватт", "вт", "w"], pattern: "(вт|w|ватт[а-я]*)" },
  { unit: "в", spellings: ["вольт", "в", "v"], pattern: "(в|v|вольт[а-я]*)" },
  { unit: "а", spellings: ["ампер", "а", "a"], pattern: "(а|a|ампер[а-я]*)" },
];
const UNIT_BY_SPELLING = new Map(UNITS.flatMap((unit) => unit.spellings.map((spelling) => [spelling, unit] as const)));
const UNIT_SPELLINGS = [...UNIT_BY_SPELLING.keys()].sort((left, right) => right.length - left.length)
  .map((spelling) => spelling.replace(/[/]/gu, "\\/")).join("|");
const NUMBER_WITH_UNIT = new RegExp(`(^|[^0-9a-zа-я.,])(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_SPELLINGS})(?![0-9a-zа-я]|-\\d)`, "gu");
const UNIT_WORD = new RegExp(`^(\\d+(?:[.,]\\d+)?)(${UNITS.map((unit) => unit.unit).join("|")})$`, "u");
// "5w40", "5W-40", "5w 40", "5в40", "5ц40" (w on the Russian layout).
const VISCOSITY = /(^|[^0-9a-zа-я])(\d{1,2})\s*[wвц]\s*-?\s*(\d{2})(?![0-9])/gu;

// «DOT-4», «dot4», «ДОТ 4». The spec is one token and must match the label on the product.
const DOT_GRADE = /(^|[^a-zа-я0-9])(?:dot|дот)\s*-?\s*(3|4|5(?:[.,]1)?)(?![a-zа-я0-9]|[.,][0-9])/gu;

// Common Russian noun/adjective endings, longest first.
const ENDINGS = [
  "ями", "ами", "ыми", "ими", "ого", "его", "ому", "ему", "ых", "их", "ый", "ий", "ой", "ая", "яя",
  "ое", "ее", "ые", "ие", "ую", "юю", "ов", "ев", "ей", "ам", "ям", "ах", "ях", "ом", "ем",
  "а", "я", "о", "е", "ы", "и", "у", "ю", "ь",
];

/** Light suffix stripping for search recall; null when nothing safe can be stripped. */
export function lightRussianStem(word: string): string | null {
  if (!/^[а-я]{5,}$/u.test(word)) return null;
  // Genitive plural with a fleeting vowel: колодок -> колодк, щеток -> щетк.
  const fleeting = /^([а-я]{3,})[оеё]к$/u.exec(word);
  if (fleeting) return `${fleeting[1]}к`;
  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 4) return word.slice(0, -ending.length);
  }
  return null;
}

// Everyday names customers type for what 1С calls by its catalogue name.
// Each word adds these substrings as extra alternatives (never replaces the
// literal word); `lead` is the product type it names, for ranking.
const WORD_SYNONYMS: ReadonlyArray<{ words: readonly string[]; texts: readonly string[]; lead: string }> = [
  { words: ["акб", "аккумы", "аккум"], texts: ["аккумулятор", "акб"], lead: "аккумулятор" },
  { words: ["дворник", "дворники", "дворников", "щетки", "щеток", "щётки"], texts: ["щетк", "стеклоочист", "дворник"], lead: "щетк" },
  { words: ["незамерзайка", "незамерзайки", "незамерзайку", "незамерзайкой", "омывайка", "омывайки", "омывайку", "омывалка"], texts: ["омыват", "незамерза"], lead: "жидкост" },
  { words: ["тормозуха", "тормозухи", "тормозуху", "тормозушка"], texts: ["тормозная жидкость", "жидкость тормозная", "dot"], lead: "жидкост" },
  { words: ["лампочка", "лампочки", "лампочку", "лампочек"], texts: ["ламп"], lead: "ламп" },
  { words: ["масленка", "масленный", "масленый", "масленая", "масленые"], texts: ["маслян"], lead: "фильтр" },
  { words: ["свечка", "свечки", "свечку", "свечей"], texts: ["свеч"], lead: "свеч" },
  { words: ["тосол", "тосола", "охлаждайка", "охлаждающая"], texts: ["антифриз", "тосол", "охлажд"], lead: "антифриз" },
  { words: ["гидрач", "гурка", "гур"], texts: ["гур", "гидроусил", "psf"], lead: "жидкост" },
  // Parts. Measured on the owner's assortment (22.11.2026): each of these words found nothing or the wrong goods,
  // because the names in 1С call the part by another word. Words that already found the right goods («линки»,
  // «сайлент», «стойки», «помпа») are left to the names themselves.
  // «глушак» and «опорник» used to be found as typos of «глушитель» and «опорный»; they are other words, said so here.
  { words: ["глушак", "глушака", "глушаки", "глушаков"], texts: ["глушител"], lead: "глушител" },
  {
    words: ["опорник", "опорника", "опорники", "опорников"],
    // Seven: with the word itself that is all one word may have (MAX_ALTERNATIVES_PER_WORD).
    texts: [
      "опора стойки", "опора передней стойки", "опора задней стойки", "опора амортизатора", "опора переднего амортизатора",
      "подшипник опор", "опорный подшипник",
    ],
    lead: "опор",
  },
  { words: ["граната", "гранаты", "гранату", "гранатой", "гранат", "гранаток"], texts: ["шрус", "гранат"], lead: "шрус" },
  { words: ["косточка", "косточки", "косточку", "косточек"], texts: ["стойка стабилизатора", "стойки стабилизатора", "тяга стабилизатора", "линк"], lead: "стойк" },
  // The base spells it «сайлентблок» 1 393 times and «сайленблок» six times; customers also drop the «й».
  { words: ["саленблок", "саленблоки", "саленблока", "сайленблок", "сайленблоки", "сайленблока", "салентблок", "салентблоки"], texts: ["сайлентблок", "сайленблок"], lead: "сайлен" },
  { words: ["бронепровод", "бронепровода", "бронепроводы", "бронепроводов"], texts: ["высоковольт", "бронепровод"], lead: "провод" },
  // The filter by its everyday name. A phrase, not the bare adjective: «воздушн» alone also finds air hoses.
  { words: ["воздушник", "воздушника", "воздушники"], texts: ["фильтр возд", "воздушный фильтр"], lead: "фильтр" },
  { words: ["салонник", "салонника", "салонники"], texts: ["фильтр салон", "салонный фильтр"], lead: "фильтр" },
  { words: ["топливник", "топливника", "топливники"], texts: ["фильтр топл", "топливный фильтр"], lead: "фильтр" },
  { words: ["вд40", "вд-40", "вд", "вэдэшка", "вэдэшку", "вэдэшки", "ведешка"], texts: ["wd-40", "wd40", "wd 40"], lead: "wd" },
  // The base writes «Велопокрышка», «Велокамера», «Камера велосипедная»; the customer types «покрышка велосипед».
  { words: ["велосипед", "велосипеда", "велосипеду", "велосипедов", "велосипедная", "велосипедный", "велосипедные", "велосипедной", "велосипедную", "велик", "велика", "велики", "велос"], texts: ["вело"], lead: "вело" },
  { words: ["секретка", "секретки", "секретку", "секреток"], texts: ["секрет"], lead: "секрет" },
  { words: ["вонючка", "вонючки", "вонючку", "пахучка", "пахучки", "пахучку"], texts: ["ароматизатор", "освежител"], lead: "ароматизатор" },
  // «Ключ балонный» is typed with one «л» in 49 names of the base and with two in 26.
  // «Масло в коробку»: the base names gearbox oils «трансмиссионное», «для АКПП», «для МКПП», never «коробка».
  // The nominative «коробка» is left alone: «коробка 9» in a name is the shelf box the staff look up.
  { words: ["коробку", "коробки", "коробке"], texts: ["коробк", "кпп", "трансмисс"], lead: "коробк" },
  { words: ["балонник", "балонника", "баллонник", "баллонника", "балонный", "баллонный", "балонного", "баллонного"], texts: ["баллонн", "балонн"], lead: "ключ" },
];
const SYNONYMS_BY_WORD = new Map(WORD_SYNONYMS.flatMap((entry) => entry.words.map((word) => [foldYo(word), entry] as const)));

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** "хеликс" -> ["heliks", "helix"], "гдб3332" -> ["gdb3332"]: Latin names and codes typed by ear in Cyrillic. */
export function transliterateCyrillicToLatin(word: string): string[] {
  const latin = [...foldYo(word)].map((char) => CYRILLIC_TO_LATIN[char] ?? char).join("");
  return latin.includes("ks") ? [latin, latin.replaceAll("ks", "x")] : [latin];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function numberPattern(value: string): string {
  return value.split(/[.,]/u).map(escapeRegex).join("[.,]");
}

/** Join the parts of a measurement the customer separated with spaces or hyphens. */
export function joinMeasurements(query: string): string {
  return query
    .replace(DOT_GRADE, (_match, before: string, grade: string) => `${before}dot${grade.replace(",", ".")}`)
    .replace(VISCOSITY, (_match, before: string, winter: string, summer: string) => `${before}${winter}w-${summer}`)
    .replace(NUMBER_WITH_UNIT, (_match, before: string, amount: string, unit: string) => (
      `${before}${amount.replace(",", ".")}${UNIT_BY_SPELLING.get(unit)!.unit}`
    ));
}

function joinBrandPhrases(query: string): string {
  let result = ` ${query} `;
  for (const [spelling, token] of MULTI_WORD_BRAND_SPELLINGS) {
    result = result.split(` ${spelling} `).join(` ${token} `);
  }
  return result.trim();
}

function wordAlternatives(word: string): { alternatives: Array<Omit<SearchTokenAlternative, "word">>; lead: string | null } {
  const dot = /^dot(3|4|5(?:\.1)?)$/u.exec(word);
  if (dot) {
    const grade = dot[1]!;
    return {
      alternatives: [{
        text: null, fuzzy: false, measure: `dot:${grade}`,
        pattern: `(^|[^[:alnum:]])(dot|дот)[[:space:]-]*${numberPattern(grade)}(?![[:alnum:]]|[.,][0-9])`,
      }],
      lead: "жидкост",
    };
  }
  const viscosity = /^(\d{1,2})w-(\d{2})$/u.exec(word);
  if (viscosity) {
    return { alternatives: [{ text: null, fuzzy: false, measure: `visc:${Number(viscosity[1])}w${viscosity[2]}`, pattern: `(^|[^0-9])${viscosity[1]} ?[wв] ?-? ?${viscosity[2]}([^0-9]|$)` }], lead: null };
  }
  const measurement = UNIT_WORD.exec(word);
  if (measurement) {
    const unit = UNITS.find((candidate) => candidate.unit === measurement[2])!;
    return { alternatives: [{ text: null, fuzzy: false, measure: `${measurement[1]!.replace(",", ".")}${unit.unit}`, pattern: `(^|[^0-9.,])${numberPattern(measurement[1]!)}(/[0-9.,]+)* ?${unit.pattern}([^a-zа-я]|$)` }], lead: null };
  }
  if (/^\d{1,3}$/u.test(word)) {
    // A short bare number is a size, capacity or count: whole numbers only.
    return { alternatives: [{ text: null, fuzzy: false, measure: `num:${Number(word)}`, pattern: `(^|[^0-9])${word}([^0-9]|$)` }], lead: null };
  }

  const alternatives: Array<Omit<SearchTokenAlternative, "word">> = [];
  const add = (text: string, fuzzy: boolean) => {
    const value = foldYo(text.toLowerCase());
    if (value.length < 2 || alternatives.some((existing) => existing.text === value)) return;
    alternatives.push({ text: value, fuzzy: fuzzy && value.length >= 4 && !/\d/u.test(value), pattern: null });
  };
  const addBrand = (candidate: string) => {
    const spellings = searchBrandSpellings(candidate);
    for (const spelling of spellings ?? []) add(spelling, false);
    return spellings !== null;
  };
  const addCyrillicWord = (candidate: string, fuzzy: boolean) => {
    add(candidate, fuzzy);
    const stem = lightRussianStem(candidate);
    if (stem) add(stem, false);
  };

  const isBrand = searchBrandSpellings(word) !== null;
  const synonym = SYNONYMS_BY_WORD.get(word);
  add(word, !isBrand && !synonym);
  for (const text of synonym?.texts ?? []) add(text, false);
  addBrand(word);
  const hasDigit = /\d/u.test(word);
  const latinLetters = /^[a-z`;',.[\]]+$/u.test(word) && /[a-z]{3}/u.test(word);
  const cyrillicLetters = /^[а-яё]+$/u.test(word);

  if (hasDigit || (/[a-z]/u.test(word) && /[а-яё]/u.test(word))) {
    // "Н7", "МАNN", "НU7008Z": Cyrillic look-alikes in a Latin code or word.
    const latin = foldHomoglyphs(word.toUpperCase()).toLowerCase();
    add(latin, false);
    addBrand(latin);
    // "гдб3332": a Latin code typed by ear in Cyrillic.
    if (hasDigit && /[а-яё]{2}/u.test(word)) for (const spelled of transliterateCyrillicToLatin(word)) add(spelled, false);
  }
  let lead: string | null = synonym?.lead ?? null;
  if (cyrillicLetters) {
    addCyrillicWord(word, !isBrand && !synonym);
    if (!isBrand && !synonym && word.length >= 3) {
      // "хеликс" -> helix, "весту" -> vest(a): Latin names typed in Cyrillic.
      for (const spelled of transliterateCyrillicToLatin(lightRussianStem(word) ?? word)) add(spelled, false);
    }
    // A Latin brand typed on the Russian layout ("ищыср" -> bosch).
    const swappedBrand = !isBrand && addBrand(swapKeyboardLayoutToLatin(word));
    if (!isBrand && !swappedBrand && !synonym) lead = lightRussianStem(word) ?? word;
  } else if (latinLetters && !isBrand) {
    const swapped = swapKeyboardLayoutToCyrillic(word);
    if (/^[а-яё]+$/u.test(swapped) && !addBrand(swapped)) {
      addCyrillicWord(swapped, true);
      lead = lightRussianStem(foldYo(swapped)) ?? foldYo(swapped);
    }
    if (/^[a-z]+$/u.test(word) && word.length >= 4) addCyrillicWord(transliterateLatinToCyrillic(word), true);
  }
  return { alternatives: alternatives.slice(0, MAX_ALTERNATIVES_PER_WORD), lead };
}

/** Split a free-text query into words with every way each word may match. */
export function searchTokenPlan(raw: string): SearchTokenPlan {
  const prepared = joinBrandPhrases(joinMeasurements(foldYo(normalizeSearchQuery(raw).toLowerCase())));
  const typed = [...new Set(prepared
    .split(/[\s,;:!?()«»"]+/u)
    .map((word) => word.replace(/^[.\-/]+|[.\-/]+$/gu, ""))
    .filter((word) => word.length >= 2))];
  // «покрышка на велик», «масло для тойоты»: the little words say nothing about the product, and required as words
  // they made the whole query find nothing. They stay only when the query has nothing else.
  const meaningful = typed.filter((word) => !LITTLE_WORDS.has(word));
  const words = (meaningful.length > 0 ? meaningful : typed).slice(0, MAX_WORDS);
  const alternatives: SearchTokenAlternative[] = [];
  const leads: string[] = [];
  words.forEach((word, index) => {
    const plan = wordAlternatives(word);
    for (const alternative of plan.alternatives) alternatives.push({ ...alternative, word: index + 1 });
    if (plan.lead) leads.push(plan.lead);
  });
  return { words, alternatives, leads };
}
