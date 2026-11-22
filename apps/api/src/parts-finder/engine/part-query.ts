/**
 * Local reading of a parts query before any catalogue lookup: typos,
 * transliteration, wrong keyboard layout and Cyrillic look-alikes.
 * Port of part_query.py from the owner's module (docs/PARTS_FINDER.md).
 *
 * Python's `\w` and `\b` are Unicode-aware; JavaScript's `\b` is not, so word
 * boundaries are spelled out with look-arounds over letters, digits and `_`.
 */

export type CategoryRule = readonly string[];
export type Category = readonly [name: string, rules: readonly CategoryRule[]];

const W = "[\\p{L}\\p{N}_]";
const START = `(?<!${W})`;
const END = `(?!${W})`;

const EN_KEYS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const RU_KEYS = "ёйцукенгшщзхъфывапролджэячсмитьбю";

function translator(from: string, to: string): (value: string) => string {
  const map = new Map<string, string>();
  [...from].forEach((char, index) => map.set(char, [...to][index]!));
  return (value) => [...value].map((char) => map.get(char) ?? char).join("");
}

export const toRussianLayout = translator(EN_KEYS, RU_KEYS);
export const toLatinLayout = translator(RU_KEYS, EN_KEYS);
const lookalike = translator("авекмнорстух", "abekmhopctyx");

const PHONETIC: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Car names typed by ear in Cyrillic ("веста", "камри") as Latin spellings to match model names. */
export function phoneticLatin(value: string): string[] {
  const latin = [...value.toLowerCase()].map((char) => PHONETIC[char] ?? char).join("");
  return latin.includes("k") ? [latin, latin.replaceAll("k", "c")] : [latin];
}

const LAYOUT_WORD = /[\p{L}\p{N}]+(?:[.,;'[\]`]+[\p{L}\p{N}]+)*/gu;
export const YEAR = new RegExp(`${START}(?:19|20)[0-9]{2}${END}`, "gu");
const ENGINE_BODY = "(?:[0-9][a-z]{1,3}|[a-z][0-9][a-z0-9]{0,3}|[a-z]{2,3}[0-9]{1,3})-[a-z0-9]{2,4}";
export const ENGINE = new RegExp(`${START}${ENGINE_BODY}${END}`, "u");
const ENGINE_GLOBAL = new RegExp(ENGINE.source, "gu");
const ENGINE_FULL = new RegExp(`^${ENGINE_BODY}$`, "u");
const CHASSIS_BODY = "(?:ncp|nsp|nhp|nlp)[0-9]{2,3}[vg]?";
const CHASSIS_FULL = new RegExp(`^${CHASSIS_BODY}$`, "u");
export const CAPACITY = new RegExp(`${START}([0-9][.,][0-9])(?:\\s*(?:л|l)${END}|(?=\\s|$))`, "u");
const CAPACITY_GLOBAL = new RegExp(CAPACITY.source, "gu");
const ENGINE_FRAGMENT = new RegExp(`${START}[\\p{L}\\p{N}]{2,5}-[\\p{L}\\p{N}]{2,4}${END}`, "gu");

export const MODEL_MAKES: Readonly<Record<string, string>> = {
  probox: "toyota", camry: "toyota", corolla: "toyota", rav4: "toyota", yaris: "toyota",
  civic: "honda", accord: "honda", fit: "honda", qashqai: "nissan", tiida: "nissan",
  polo: "vw", golf: "vw", tiguan: "vw", solaris: "hyundai",
  vesta: "lada", granta: "lada", largus: "lada", logan: "renault", duster: "renault",
  focus: "ford", octavia: "skoda", rapid: "skoda", cruiser: "toyota", prado: "toyota",
};

export const ALIASES: Readonly<Record<string, string>> = {
  "тойота": "toyota", "тойоты": "toyota", "тоёта": "toyota", "тоета": "toyota",
  "пробокс": "probox", "пробокса": "probox", "пробоксу": "probox", "прабокс": "probox",
  "プロボックス": "probox", proboks: "probox", praboks: "probox",
  "камри": "camry", "королла": "corolla", "короллу": "corolla", "короллы": "corolla",
  "рав4": "rav4", "ярис": "yaris", "хонда": "honda", "сивик": "civic", "аккорд": "accord", "фит": "fit",
  "ниссан": "nissan", "кашкай": "qashqai", "ноут": "note", "тиида": "tiida",
  "фольксваген": "vw", volkswagen: "vw", "поло": "polo", "гольф": "golf", "тигуан": "tiguan",
  "киа": "kia", "рио": "rio", "хендай": "hyundai", "хундай": "hyundai", "солярис": "solaris",
  "лада": "lada", "ваз": "lada", "веста": "vesta", "весту": "vesta", "гранта": "granta", "ларгус": "largus",
  "рено": "renault", "логан": "logan", "дастер": "duster", "форд": "ford", "фокус": "focus",
  "шкода": "skoda", "октавия": "octavia", "рапид": "rapid", "мазда": "mazda", "митсубиси": "mitsubishi",
  "субару": "subaru", "сузуки": "suzuki", "мерседес": "mercedes", "бмв": "bmw", "ауди": "audi",
  "чери": "chery", "джили": "geely", "хавал": "haval", "чанган": "changan", "джак": "jac",
  "джолион": "jolion", "тигго": "tiggo", "монжаро": "monjaro", "кулрей": "coolray", "атлас": "atlas",
  demio: "demio", "демио": "demio", "аксела": "axela", "атенза": "atenza",
  // Names said the English way, which no letter-by-letter reading recovers.
  "чайзер": "chaser", "чазер": "chaser", "краун": "crown", "хайс": "hiace", "хайлюкс": "hilux", "хайлакс": "hilux",
  "саксид": "succeed", "раш": "rush", "санни": "sunny", "скайлайн": "skyline", "блюберд": "bluebird", "куб": "cube",
  "пресаж": "presage", "стрим": "stream", "фрид": "freed", "инспаер": "inspire",
  "трибьют": "tribute", "мираж": "mirage", "аутлендер": "outlander", "аутбек": "outback", "мув": "move", "цивик": "civic",
  "крузер": "cruiser", "ленд": "land", "лэнд": "land", "крузак": "land cruiser", "прадо": "land cruiser prado",
  "прадик": "land cruiser prado", "марк": "mark", "сурф": "hilux surf", "орхия": "orthia", "шариот": "chariot",
  stepwgn: "stepwagon", "степвагон": "stepwagon", "туарег": "touareg", "спортейдж": "sportage", "спортаж": "sportage", "инсайт": "insight", "эскейп": "escape",
  "филтр": "фильтр", "фильр": "фильтр", "филтер": "фильтр", filtr: "фильтр", maslyany: "масляный",
  maslyanyi: "масляный", maslyaniy: "масляный", maslyanyy: "масляный", "маслофильтр": "маслофильтр",
};

export const MAKES: ReadonlySet<string> = new Set([
  ...Object.values(MODEL_MAKES),
  "audi", "bmw", "changan", "chery", "chevrolet", "citroen", "datsun", "fiat", "geely", "haval", "jac",
  "kia", "lexus", "mazda", "mercedes", "mitsubishi", "opel", "peugeot", "subaru", "suzuki", "volvo",
]);

const VEHICLE_WORDS: ReadonlySet<string> = new Set([
  ...MAKES, ...Object.keys(MODEL_MAKES), ...Object.values(ALIASES), "rio", "note",
]);

export const FILLER: ReadonlySet<string> = new Set([
  "на", "для", "к", "в", "и", "двигатель", "двигателя", "мотор", "год", "года", "г", "for", "the", "л", "l",
  "bosch", "бош", "mann", "манн", "denso", "денсо", "ridex", "brembo", "брембо", "ate", "trw", "mahle", "ngk",
  "filtron", "фильтрон", "sachs", "front", "rear", "передние", "передний", "задние", "задний",
]);

const TYPO_TARGETS = [...new Set([...VEHICLE_WORDS, ...Object.keys(ALIASES)])].filter((token) => [...token].length >= 5);

const CYRILLIC_SOUNDS: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i",
  ь: "", э: "e", ю: "u", я: "ia",
};

/**
 * One spelling for how a car name sounds, whichever alphabet it was typed
 * in: «гайя» and "Gaia", «вокси» and "Voxy", «королла» and "Corolla" give
 * the same key. Not a transliteration to show anyone — only to compare.
 */
export function phoneticKey(word: string): string {
  let text = word.normalize("NFKC").toLowerCase().replace(/ё/gu, "е");
  if (/[а-я]/u.test(text)) {
    text = text.replace(/дж/gu, "j").replace(/ц(?=[еиы])/gu, "s");
    text = [...text].map((char) => CYRILLIC_SOUNDS[char] ?? char).join("");
  } else {
    text = text.replace(/ph/gu, "f").replace(/th/gu, "t").replace(/ck/gu, "k").replace(/tz/gu, "ts").replace(/qu/gu, "kv")
      .replace(/c(?=[eiy])/gu, "s").replace(/c(?!h)/gu, "k").replace(/q/gu, "k").replace(/x/gu, "ks").replace(/w/gu, "v").replace(/y/gu, "i");
  }
  return text.replace(/[^a-z0-9]/gu, "").replace(/(.)\1+/gu, "$1");
}

/** Car names the query reader knows beyond its built-in list: built from the vehicle catalog. */
export interface VehicleVocabulary {
  /** Make spelled in either alphabet -> its Latin words ("дайхатсу" -> "daihatsu"). */
  readonly makes: ReadonlyMap<string, string>;
  /** Latin model word -> the make's words; "" when several makes share the word. */
  readonly models: ReadonlyMap<string, string>;
  /** phoneticKey -> the one model word it names. */
  readonly phonetic: ReadonlyMap<string, string>;
}

export const EMPTY_VOCABULARY: VehicleVocabulary = { makes: new Map(), models: new Map(), phonetic: new Map() };

// Model names that are everyday words, units or fasteners: never read as a car.
const NOT_A_MODEL: ReadonlySet<string> = new Set([
  "air", "master", "model", "grand", "land", "town", "urban", "pick", "pickup", "crew", "mega", "eco", "super", "dream",
  "life", "city", "today", "wave", "vision", "elite", "icon", "future", "sonic", "beat", "blade", "click", "pop", "lead",
  "navi", "van", "truck", "bus", "sport", "space", "express", "origin", "quick", "tank", "titan", "one", "max", "pro",
  "new", "old", "set", "bolt", "volt", "sakura", "patron", "ultra", "standard", "original", "premium", "classic",
]);

/**
 * `models` are catalog names ("Gaia (_M1_)", "Noah/Voxy (_R6_)"): the words
 * before the body code name the model. `exclude` are words that must stay
 * what they are — brands of parts the shop sells ("Sakura", "Titan").
 */
export function buildVehicleVocabulary(input: {
  exclude?: Iterable<string>;
  makes: ReadonlyArray<{ name: string; nameRu?: string | null }>;
  models: ReadonlyArray<{ make: string; name: string }>;
}): VehicleVocabulary {
  const excluded = new Set([...(input.exclude ?? [])].flatMap((value) => words(value)));
  const makes = new Map<string, string>();
  for (const make of input.makes) {
    const latin = words(make.name).map((token) => ALIASES[token] ?? token).join(" ");
    if (!latin) continue;
    for (const spelling of [make.name, make.nameRu ?? ""]) {
      const key = words(spelling);
      if (key.length === 1) makes.set(key[0]!, latin);
    }
  }
  const models = new Map<string, string>();
  for (const model of input.models) {
    const make = words(model.make).map((token) => ALIASES[token] ?? token).join(" ");
    for (const part of model.name.split("(", 1)[0]!.split("/")) {
      const word = words(part)[0];
      if (!word || word.length < 3 || !/^[a-z]+$/u.test(word) || NOT_A_MODEL.has(word) || excluded.has(word) || makes.has(word)) continue;
      models.set(word, models.has(word) && models.get(word) !== make ? "" : make);
    }
  }
  const phonetic = new Map<string, string>();
  const clashes = new Set<string>();
  for (const word of models.keys()) {
    const full = phoneticKey(word);
    // A final Latin "e" is usually silent: «меган» is Megane, «жук» is Juke.
    const keys = full.length >= 4 && full.endsWith("e") ? [full, full.slice(0, -1)] : [full];
    for (const key of keys) {
      if (phonetic.has(key) && phonetic.get(key) !== word) clashes.add(key);
      phonetic.set(key, word);
    }
  }
  for (const key of clashes) phonetic.delete(key);
  return { makes, models, phonetic };
}

function fold(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

/** Lower-case Unicode words with ё folded to е (Python: casefold + `[^\W_]+`). */
export function words(value: string): string[] {
  return fold(value).replace(/ё/gu, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function isNumeric(token: string): boolean {
  return /^\p{N}+$/u.test(token);
}

function isAlpha(token: string): boolean {
  return /^\p{L}+$/u.test(token);
}

export function isChassisCode(token: string): boolean {
  return CHASSIS_FULL.test(token);
}

export function isEngineCode(value: string): boolean {
  return ENGINE_FULL.test(value);
}

export function categoryMatches(tokens: readonly string[], rules: readonly CategoryRule[]): boolean {
  return rules.some((rule) => rule.every((stem) => tokens.some((token) => token.startsWith(stem))));
}

export function oneTypo(word: string, target: string): boolean {
  const a = [...word];
  const b = [...target];
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const mismatches = a.flatMap((char, index) => (char === b[index] ? [] : [index]));
    if (mismatches.length === 1) return true;
    const [first, second] = mismatches;
    return mismatches.length === 2 && second === first! + 1 && a[first!] === b[second] && a[second] === b[first!];
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.some((_, index) => [...long.slice(0, index), ...long.slice(index + 1)].join("") === short.join(""));
}

function categoryStems(categories: readonly Category[]): Set<string> {
  return new Set(categories.flatMap(([, rules]) => rules.flat()));
}

/** Returns the corrected text and its tokens; a model alone adds its make ("пробокс" → toyota). */
export function normalizeQuery(
  query: string, categories: readonly Category[], vocabulary: VehicleVocabulary = EMPTY_VOCABULARY,
): { corrected: string; tokens: string[] } {
  const stems = categoryStems(categories);
  const recognized = (token: string) => VEHICLE_WORDS.has(token) || FILLER.has(token) || isChassisCode(token)
    || vocabulary.models.has(token) || [...stems].some((stem) => token.startsWith(stem));

  // «гайя» -> gaia, «на короллу» -> corolla, «дайхатсу» -> daihatsu: a car
  // named by ear, read through the catalog. Exact sound only: a close
  // spelling would turn «гайка» into Gaia and «патрон» into Patrol.
  const fromCatalog = (fragment: string): string | null => {
    const word = words(fragment)[0];
    if (!word || words(fragment).length !== 1 || !isAlpha(fragment)) return null;
    const make = vocabulary.makes.get(word);
    if (make) return make;
    if (!/^[а-я]{3,}$/u.test(word)) return null;
    const stem = word.slice(0, -1);
    // The name itself, then its case forms: «короллу», «короллы» -> «королла»; «ноаха» -> «ноах».
    const forms = /[уюыиеой]$/u.test(word) ? [word, `${stem}а`, `${stem}я`] : /а$/u.test(word) ? [word, stem] : [word];
    for (const form of forms) {
      const model = vocabulary.phonetic.get(phoneticKey(form));
      if (model) return model;
    }
    return null;
  };

  const fix = (fragment: string) => {
    for (const candidate of [fragment, lookalike(fragment), toRussianLayout(fragment), toLatinLayout(fragment)]) {
      const tokens = words(candidate);
      if (tokens.length === 1) {
        const token = ALIASES[tokens[0]!] ?? tokens[0]!;
        if (recognized(token)) return token;
      }
    }
    const known = fromCatalog(fragment);
    if (known) return known;
    // Correct short edits only in known words and only when the result is unambiguous.
    if ([...fragment].length >= 5 && isAlpha(fragment)) {
      const matches = new Set(TYPO_TARGETS.filter((token) => oneTypo(fragment, token)).map((token) => ALIASES[token] ?? token));
      if (matches.size === 1) return [...matches][0]!;
    }
    return fragment;
  };

  const fixEngine = (fragment: string) => {
    for (const spelling of [fragment, lookalike(fragment), toLatinLayout(fragment)]) {
      if (isEngineCode(spelling)) return spelling;
    }
    return fragment;
  };

  const text = fold(query).replace(ENGINE_FRAGMENT, fixEngine);
  const corrected = text.replace(LAYOUT_WORD, fix);
  const tokens = words(corrected);
  const makeWords = new Set([...vocabulary.makes.values()].flatMap((make) => make.split(" ")));
  const explicitMakes = tokens.filter((token) => MAKES.has(token) || makeWords.has(token));
  const inferred = new Set(tokens.flatMap((token) => {
    if (Object.hasOwn(MODEL_MAKES, token)) return [MODEL_MAKES[token]!];
    const make = vocabulary.models.get(token);
    return make ? [make] : [];
  }));
  if (explicitMakes.length === 0 && inferred.size === 1) tokens.unshift(...[...inferred][0]!.split(" "));
  return { corrected, tokens };
}

/** Words that may name the vehicle: no filler, no long numbers, no part words. */
export function vehicleHint(tokens: readonly string[], categories: readonly Category[]): string[] {
  const stems = categoryStems(categories);
  return tokens.filter((token) => !FILLER.has(token) && (!isNumeric(token) || token.length <= 3)
    && ![...stems].some((stem) => token.startsWith(stem)));
}

/** The query itself when it looks like a part number rather than words, else null. */
export function articleCandidate(query: string): string | null {
  const text = query.normalize("NFKC").trim();
  if (!/^[\p{L}\p{N}_ ./-]{1,64}$/u.test(text) || !/[0-9]/u.test(text)) return null;
  const lower = text.toLowerCase();
  if (isEngineCode(lower) || isChassisCode(lower)
    || /^(?:[A-HJ-NPR-Z0-9]{17}|[A-Za-z]{2,5}\d{2,4}[A-Za-z]?-\d{5,})$/iu.test(text)) return null;
  const chunks = words(text);
  if (chunks.filter(isAlpha).length > 1 || chunks.filter((chunk) => !isNumeric(chunk)).length > 2) return null;
  return text;
}

export function findYears(text: string): string[] {
  return [...text.matchAll(YEAR)].map((match) => match[0]);
}

export function findEngine(text: string): string | null {
  return ENGINE.exec(text)?.[0] ?? null;
}

export function findCapacity(text: string): string | null {
  return CAPACITY.exec(text)?.[1] ?? null;
}

export function stripEngineAndCapacity(text: string): string {
  return text.replace(CAPACITY_GLOBAL, " ").replace(ENGINE_GLOBAL, " ");
}

/** Python str.title(): upper-case a letter that follows a non-letter. */
export function titleCase(value: string): string {
  return value.replace(/\p{L}+/gu, (run) => run[0]!.toUpperCase() + run.slice(1).toLowerCase());
}
