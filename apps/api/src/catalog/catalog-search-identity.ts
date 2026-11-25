import { foldHomoglyphs, normalizeArticleNumber } from "./catalog-search-normalize.js";

// Curated spelling aliases for search only. These do not create supplier
// links or confirm compatibility between two different parts. `keys` are
// app.normalize_brand() forms of the brand names 1C may use; `spellings`
// are what customers type (Latin, Cyrillic, common misspellings). A
// spelling is also matched as text against the product name/brand, so
// keep spellings specific enough not to occur inside unrelated words.
const BRANDS = [
  { spellings: ["mann-filter", "mann filter", "mannfilter", "mann", "манн фильтр", "манн-фильтр", "манн"], keys: ["MANN", "MANNFILTER"], token: "mann" },
  { spellings: ["bosch", "бош", "босх", "бошь"], keys: ["BOSCH"], token: "bosch" },
  { spellings: ["ngk", "нжк", "нгк"], keys: ["NGK"], token: "ngk" },
  { spellings: ["denso", "денсо"], keys: ["DENSO"], token: "denso" },
  { spellings: ["mahle", "махле"], keys: ["MAHLE", "MAHLEORIGINAL"], token: "mahle" },
  { spellings: ["stellox", "стеллокс", "стелокс"], keys: ["STELLOX"], token: "stellox" },
  { spellings: ["lynxauto", "lynx auto", "линксавто", "линкс авто", "lynx", "линкс"], keys: ["LYNXAUTO", "LYNX"], token: "lynxauto" },
  { spellings: ["sachs", "сакс", "закс"], keys: ["SACHS"], token: "sachs" },
  { spellings: ["brembo", "брембо"], keys: ["BREMBO"], token: "brembo" },
  { spellings: ["kyb", "kayaba", "каяба", "кайба"], keys: ["KYB", "KAYABA"], token: "kyb" },
  { spellings: ["febest", "фебест"], keys: ["FEBEST"], token: "febest" },
  { spellings: ["febi bilstein", "febi", "феби"], keys: ["FEBI", "FEBIBILSTEIN"], token: "febi" },
  { spellings: ["trw", "трв"], keys: ["TRW"], token: "trw" },
  { spellings: ["lemförder", "lemforder", "лемфордер", "лемфёрдер"], keys: ["LEMFÖRDER", "LEMFORDER"], token: "lemforder" },
  { spellings: ["лукойл", "lukoil", "лукоил"], keys: ["ЛУКОЙЛ", "LUKOIL"], token: "lukoil" },
  { spellings: ["castrol", "кастрол", "кастролл"], keys: ["CASTROL"], token: "castrol" },
  { spellings: ["mobil", "мобил", "мобиль"], keys: ["MOBIL", "MOBIL1"], token: "mobil" },
  { spellings: ["shell", "шелл"], keys: ["SHELL"], token: "shell" },
  { spellings: ["liqui moly", "liquimoly", "liqui-moly", "ликви моли", "ликвимоли", "ликви-моли"], keys: ["LIQUIMOLY"], token: "liquimoly" },
  { spellings: ["total", "тотал"], keys: ["TOTAL", "TOTALENERGIES"], token: "total" },
  { spellings: ["motul", "мотюль", "мотул"], keys: ["MOTUL"], token: "motul" },
  { spellings: ["varta", "варта"], keys: ["VARTA"], token: "varta" },
  { spellings: ["philips", "филипс"], keys: ["PHILIPS"], token: "philips" },
  { spellings: ["osram", "осрам"], keys: ["OSRAM"], token: "osram" },
  { spellings: ["valeo", "валео"], keys: ["VALEO"], token: "valeo" },
  { spellings: ["champion", "чемпион"], keys: ["CHAMPION"], token: "champion" },
  { spellings: ["felix", "феликс"], keys: ["FELIX"], token: "felix" },
  { spellings: ["sintec", "синтек"], keys: ["SINTEC"], token: "sintec" },
  { spellings: ["contitech", "континтех", "контитек", "контитех"], keys: ["CONTITECH"], token: "contitech" },
  { spellings: ["gates", "гейтс"], keys: ["GATES"], token: "gates" },
  { spellings: ["hella", "хелла"], keys: ["HELLA"], token: "hella" },
  { spellings: ["meyle", "мейле"], keys: ["MEYLE"], token: "meyle" },
  { spellings: ["elring", "эльринг"], keys: ["ELRING"], token: "elring" },
  // Car makes: OEM parts arrive from 1С under the maker's name ("Toyota").
  { spellings: ["toyota", "тойота", "тойоты", "тоета", "тоёта"], keys: ["TOYOTA"], token: "toyota" },
  { spellings: ["lada", "лада", "лады", "ваз"], keys: ["LADA", "ЛАДА", "ВАЗ", "АВТОВАЗ"], token: "lada" },
  { spellings: ["hyundai", "хендай", "хундай", "хёндай", "хендэ"], keys: ["HYUNDAI"], token: "hyundai" },
  { spellings: ["nissan", "ниссан", "нисан"], keys: ["NISSAN"], token: "nissan" },
  { spellings: ["volkswagen", "фольксваген", "фольцваген", "vag", "vw", "ваг"], keys: ["VOLKSWAGEN", "VW", "VAG"], token: "volkswagen" },
  { spellings: ["renault", "рено"], keys: ["RENAULT"], token: "renault" },
  { spellings: ["skoda", "шкода"], keys: ["SKODA"], token: "skoda" },
  { spellings: ["mitsubishi", "митсубиси", "мицубиси", "митсубиши"], keys: ["MITSUBISHI"], token: "mitsubishi" },
  { spellings: ["honda", "хонда"], keys: ["HONDA"], token: "honda" },
  { spellings: ["mazda", "мазда"], keys: ["MAZDA"], token: "mazda" },
  { spellings: ["subaru", "субару"], keys: ["SUBARU"], token: "subaru" },
  { spellings: ["chevrolet", "шевроле", "шевролет"], keys: ["CHEVROLET", "GM"], token: "chevrolet" },
  { spellings: ["haval", "хавал", "хавейл"], keys: ["HAVAL"], token: "haval" },
  { spellings: ["chery", "чери"], keys: ["CHERY"], token: "chery" },
  { spellings: ["geely", "джили"], keys: ["GEELY"], token: "geely" },
] as const;

const BRAND_BY_SPELLING = new Map<string, (typeof BRANDS)[number]>(
  BRANDS.flatMap((brand) => brand.spellings.map((spelling) => [spelling, brand] as const)),
);

/** Multi-word brand spellings, longest first, for joining them into one search word. */
export const MULTI_WORD_BRAND_SPELLINGS: ReadonlyArray<readonly [string, string]> = BRANDS
  .flatMap((brand) => brand.spellings.filter((spelling) => /[\s-]/u.test(spelling)).map((spelling) => [spelling, brand.token] as const))
  .sort((left, right) => right[0].length - left[0].length);

function brandFor(token: string) {
  return BRAND_BY_SPELLING.get(token.toLocaleLowerCase("ru").replace(/ё/gu, "е"))
    ?? BRAND_BY_SPELLING.get(token.toLocaleLowerCase("ru"));
}

export function searchBrandToken(token: string): string {
  return brandFor(token)?.token ?? token;
}

/** Every known spelling of the brand a search word names, or null when it names none. */
export function searchBrandSpellings(token: string): string[] | null {
  const brand = brandFor(token);
  return brand ? [...brand.spellings] : null;
}

const BRAKE_FLUID_GRADE = /^(?:dot|дот)\s*-?\s*(?:3|4|5(?:[.,]1)?)$/iu;

function articleShaped(value: string) {
  if (BRAKE_FLUID_GRADE.test(value)) return false;
  const normalized = normalizeArticleNumber(value);
  if (normalized.length < 4 || normalized.length > 64 || !/\d/u.test(normalized)
    || !/^[A-Z0-9]+$/u.test(normalized) || !/^[\p{L}\p{N} .\-/]+$/u.test(value)) return false;
  // Viscosity ("5W-40", "5в40") and measurements ("4 л", "60Ач") are
  // attributes, not a manufacturer's part ID, even next to another word.
  if (value.split(/\s+/u).some((word) => /^\d{1,2}[wвц]-?\d{2}$/iu.test(word)) || /^\d{1,2}\s*[wвц]\s*-?\s*\d{2}$/iu.test(value.trim())) return false;
  if (/(^|\s)\d+([.,]\d+)?\s*(л|l|мл|ml|кг|kg|мм|mm|ач|ah|в|v|вт|w|а|a)$/iu.test(value.trim())) return false;
  if (!/\s/u.test(value)) return true;
  return /^[\p{L}]{0,5}[ .\-/]*\d[\p{L}\p{N} .\-/]*$/u.test(value);
}

/** A word mixing Cyrillic and Latin letters ("МАNN", "НU7008") is a look-alike slip: read it as Latin. */
export function foldMixedScriptWord(word: string): string {
  return /[a-z]/iu.test(word) && /[а-яё]/iu.test(word) ? foldHomoglyphs(word.toUpperCase()).toLowerCase() : word;
}

export function catalogSearchIdentity(query: string | undefined): { article: string; brandKeys: string[]; articleOnly: boolean } {
  const raw = (query?.trim().replace(/\s+/gu, " ") ?? "").split(" ").map((word) => (
    /\d/u.test(word) ? word : foldMixedScriptWord(word)
  )).join(" ");
  const lower = raw.toLocaleLowerCase("ru");
  for (const brand of BRANDS) for (const spelling of brand.spellings) {
    let article: string | null = null;
    if (lower.startsWith(`${spelling} `)) article = raw.slice(spelling.length).trim();
    else if (lower.endsWith(` ${spelling}`)) article = raw.slice(0,raw.length-spelling.length).trim();
    if (article && articleShaped(article)) return { article: normalizeArticleNumber(article), brandKeys: [...brand.keys], articleOnly: true };
  }
  if (BRAKE_FLUID_GRADE.test(raw)) return { article: "", brandKeys: [], articleOnly: false };
  const article = normalizeArticleNumber(raw);
  return { article: /^[\p{L}\p{N}]+$/u.test(article) ? article : "", brandKeys: [], articleOnly: articleShaped(raw) };
}
