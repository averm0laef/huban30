/**
 * Which catalogue part a product of ours is (docs/UMAPI_INTEGRATION.md, part 4).
 * Pure rules; the service asks UMAPI with what they give.
 *
 * Our own brand and number come first. The numbers the name carries («… AFW1272 (FILTRON K1288, MANN CU3569)»,
 * «AVX13X1385 Ремень клиновой Contitech», «(LX1734) Фильтр воздушный …») are tried after it: they may be the
 * product's own number written in full, or its analogues — the latter stand in for it only as «по номерам из
 * названия», and only when they agree.
 *
 * Measured on 80 random products of the owner's base (24.11.2026): our own number alone identified 10 of 67; the
 * rest were original numbers behind a «ST-» prefix, makers named otherwise in UMAPI, numbers written only in the
 * name, and 1С's own codes («00-00022450»), which are never a part number.
 */
import { bracketedNumbers, normalizeArticleNumber, normalizeBrand } from "@an30/contracts";

export interface PartCandidate {
  article: string;
  /** null: a number without a maker — UMAPI is asked whose it is. */
  brand: string | null;
  /** «own»: the product's own number (the article, or the article without the «ST-» prefix); «name»: a number named in the product's name. */
  via: "own" | "name";
}

// The owner's 1С names makers shorter or otherwise than the catalogue does.
const MAKER_ALIASES: Readonly<Record<string, string>> = {
  MANN: "MANNFILTER",
  HENGST: "HENGSTFILTER",
  KNECHT: "KNECHTMAHLE",
  MAHLE: "MAHLEORIGINAL",
  CONTITECH: "CONTINENTALCTAM",
  CONTINENTAL: "CONTINENTALCTAM",
  OSRAM: "AMSOSRAM",
  ASAKASHI: "JSASAKASHI",
  JS: "JSASAKASHI",
  KOYO: "JTEKTKOYO",
  LYNX: "LYNXAUTO",
};

/** A maker's name as compared: «MANN-FILTER», «Mann filter» and «MANN» are one maker. */
export function makerKey(name: string): string {
  const key = normalizeBrand(name);
  return MAKER_ALIASES[key] ?? key;
}

/**
 * True when two spellings name one maker: equal keys, one is the other plus a word («MANN» / «MANN-FILTER»), or the
 * catalogue adds a word in front («OSRAM» / «ams-OSRAM», «ASAKASHI» / «JS ASAKASHI») — only for names of five
 * letters or more, so that short ones («SAT», «NOK») never match by accident.
 */
export function sameMaker(a: string, b: string): boolean {
  const left = makerKey(a);
  const right = makerKey(b);
  if (!left || !right) return false;
  if (left === right || (left.length >= 3 && right.startsWith(left)) || (right.length >= 3 && left.startsWith(right))) return true;
  return (left.length >= 5 && right.endsWith(left)) || (right.length >= 5 && left.endsWith(right));
}

/** 1С's own codes («00-00022450»): a record number of the base, never a part number. */
export function isOwnCode(sku: string): boolean {
  return /^\d{2}-\d{6,}$/u.test(sku.trim());
}

/** A number written in a product name looks like a part number: letters and digits, or a long run of digits. */
function looksLikePartNumber(token: string): boolean {
  const bare = normalizeArticleNumber(token);
  if (bare.length < 5 || bare.length > 18 || !/\d/u.test(bare)) return false;
  // Sizes, voltages, years and the like: «185/75R16C», «60/55W», «12V», «02-09», «D=430», «19X0.075», «M22*1.5».
  if (/^\d{2,3}\/\d{2}R\d{2}/iu.test(token) || /^\d+(?:[.,]\d+)?(?:MM|ММ|W|V|A|А|Л|L|КГ|KG|СМ|CM|Г|G)$/iu.test(token)) return false;
  if (/^\d{2}-\d{2}/u.test(token) || /[*×]/u.test(token) || /^\d+[XХ]\d/iu.test(token) || /^[MМ]\d/iu.test(token)) return false;
  // Engine and chassis codes of the car the part is for, not the part: «1KZ-TE», «3RZ-FE», «NZE120», «KZJ95», «MH34S».
  if (/^\d[A-Z]{1,3}-?[A-Z]{0,3}$/iu.test(token) || /^[A-Z]{3}\d{2,3}[A-Z]?$/iu.test(bare) || /^[A-Z]{2}\d{2}[A-Z]$/iu.test(bare)) return false;
  // A list of models or engines run together with «/»: «3RZ/2TR/1GR/5VZ», «SURF/4RUNNER».
  if (token.includes("/") && token.split("/").every((part) => part.length <= 4 || !/\d.*\d/u.test(part))) return false;
  if ((bare.match(/\d/gu) ?? []).length < 2) return false;
  return /[A-Z]/iu.test(bare) || bare.length >= 7;
}

/** The part numbers a name carries, in their order, without our own number. */
export function nameNumbers(name: string, sku: string): string[] {
  const own = normalizeArticleNumber(sku);
  const found: string[] = [];
  for (const [token] of name.matchAll(/[A-Za-z0-9][A-Za-z0-9\-/.]{3,24}[A-Za-z0-9]/gu)) {
    const bare = normalizeArticleNumber(token);
    if (!looksLikePartNumber(token) || bare === own || found.some((known) => normalizeArticleNumber(known) === bare)) continue;
    found.push(token);
  }
  return found;
}

/** What to look up, in order: our own number (and the original number behind «ST-»), then numbers of the name. */
export function partCandidates(product: { brand: string | null; name: string; sku: string }): PartCandidate[] {
  const own: PartCandidate[] = [];
  if (!isOwnCode(product.sku)) {
    own.push({ article: product.sku, brand: product.brand, via: "own" });
    // «ST-23300-31090»: SAT's copy of the original Toyota part 23300-31090 — the original number names the part.
    const original = /^ST-(.+)$/iu.exec(product.sku.trim())?.[1];
    if (original && normalizeArticleNumber(original).length >= 6) own.push({ article: original, brand: null, via: "own" });
  }
  const labelled = bracketedNumbers(product.name)
    .filter((item) => normalizeArticleNumber(item.article) !== normalizeArticleNumber(product.sku))
    .map((item): PartCandidate => ({ ...item, via: "name" }));
  const known = new Set([...own, ...labelled].map((candidate) => normalizeArticleNumber(candidate.article)));
  const plain = nameNumbers(product.name, product.sku)
    .filter((token) => !known.has(normalizeArticleNumber(token)))
    .map((article): PartCandidate => ({ article, brand: null, via: "name" }));
  return [...own, ...labelled, ...plain].slice(0, own.length + 3);
}

/** The maker of several that the product's name mentions («… Фильтр воздушный MAHLE LX1734»), if exactly one. */
export function makerNamedIn(name: string, makers: readonly string[]): string | null {
  const words = normalizeBrand(name);
  const named = makers.filter((maker) => {
    const key = normalizeBrand(maker);
    return key.length >= 3 && words.includes(key);
  });
  return named.length === 1 ? named[0]! : null;
}
