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
import { bracketedNumbers, normalizeArticleNumber, normalizeBrand, STOREFRONT_TAXONOMY } from "@an30/contracts";

import { expandAbbreviations, partDictionaryMatch } from "../catalog/catalog-part-dictionary.js";

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
  // The catalogue writes «JTEKT (Koyo)», «A.B.S.»: brackets and dots are not part of the name (KOYO missed, 24.11.2026).
  const key = normalizeBrand(name).replace(/[^\p{L}\p{N}]+/gu, "");
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
  if (/^\d{2}-\d{2}(?!\d)/u.test(token) || /[*×]/u.test(token) || /^\d+[XХ]\d/iu.test(token) || /^[MМ]\d/iu.test(token)) return false;
  // Engine and chassis codes of the car the part is for, not the part: «1KZ-TE», «3RZ-FE», «NZE120», «KZJ95», «MH34S».
  if (/^\d[A-Z]{1,3}-?[A-Z]{0,3}$/iu.test(token) || /^[A-Z]{3}\d{2,3}[A-Z]?$/iu.test(bare) || /^[A-Z]{2}\d{2}[A-Z]$/iu.test(bare)) return false;
  // A list of models or engines run together with «/»: «3RZ/2TR/1GR/5VZ», «SURF/4RUNNER».
  if (token.includes("/") && token.split("/").every((part) => part.length <= 4 || !/\d.*\d/u.test(part))) return false;
  if ((bare.match(/\d/gu) ?? []).length < 2) return false;
  return /[A-Z]/iu.test(bare) || bare.length >= 7;
}

/**
 * A number of six digits the name puts alone in brackets or first: «(334243) Амортизатор 4407211-GS Ti•GUAR»,
 * «333455 Стойка … Double Force» — the maker's number the shop sells it as (KYB here). Digits alone elsewhere in a
 * name are sizes or model codes and stay out.
 */
function leadingNumbers(name: string): string[] {
  const found: string[] = [];
  for (const [, inside] of name.matchAll(/\(\s*(\d{6})\s*\)/gu)) found.push(inside!);
  const first = /^\s*(\d{6})(?=\s)/u.exec(name)?.[1];
  if (first) found.push(first);
  return found;
}

/** The part numbers a name carries, in their order, without our own number. */
export function nameNumbers(name: string, sku: string): string[] {
  const own = normalizeArticleNumber(sku);
  const found: string[] = leadingNumbers(name).filter((number) => number !== own);
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
    // «ST-23300-31090»: SAT's copy of the original Toyota part 23300-31090 — the original number names the part. 1С
    // also keeps it without the dash («ST0411164345» = 04111-64345); then only a long run of digits counts, so
    // that an article that merely starts with «ST» («STD24», a wiper) is never cut.
    const sku = product.sku.trim();
    const original = /^ST-(.+)$/iu.exec(sku)?.[1] ?? /^ST(\d{8,}[A-Z]?)$/iu.exec(normalizeArticleNumber(sku))?.[1]
      // NOK and SAT seals and gaskets: «K» before a Japanese original number of five and five characters
      // («K90311-35030» = TOYOTA 90311-35030, «K91212PR4A01» = HONDA 91212-PR4-A01; measured 24.11.2026).
      ?? /^K(\d{5}[0-9A-Z]{5})$/iu.exec(normalizeArticleNumber(sku))?.[1];
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

/**
 * The number as the catalogues are asked: our normalised number without the «_» 1С sometimes writes («8500986_SX» =
 * STELLOX 85-00986-SX). The shop's own normalisation is not changed: search and the 1С exchange rely on it.
 */
export function catalogueNumber(value: string): string {
  return normalizeArticleNumber(value).replace(/_/gu, "");
}

const TITLE_STOP = new Set(["для", "или", "комплект", "передний", "задний", "левый", "правый", "система"]);

// Latin letters 1С names mix into Russian words («Hакладки»): read as the Cyrillic ones they look like.
const LOOKALIKE: Readonly<Record<string, string>> = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };

function stemsOf(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/gu, "е").match(/\p{L}{4,}/gu) ?? [];
  return words.map((word) => (/[а-я]/u.test(word) ? [...word].map((char) => LOOKALIKE[char] ?? char).join("") : word))
    .filter((word) => !TITLE_STOP.has(word)).map((word) => word.slice(0, 5));
}

/**
 * Whether a catalogue part of another maker than ours can be this product: the kind of part it is («Датчик
 * импульсов») shares a word with the product's name («Накладки тормозные … AS5061» does not — 24.11.2026, a sensor's
 * photo and description stood on brake linings). A name without Russian words of four letters says nothing: kept.
 */
export function kindAgrees(name: string, title: string | null, section: string | null = null): boolean {
  if (!title) return true;
  const own = stemsOf(name).filter((stem) => /[а-я]/u.test(stem));
  if (own.length === 0) return true;
  const theirs = stemsOf(title);
  // «торм.» in a short name and «тормозных» in the catalogue are one word.
  if (theirs.some((stem) => own.some((word) => word.startsWith(stem) || stem.startsWith(word)))) return true;
  // The shop and the catalogue name one part differently («Сайлентблок» / «Подвеска, рычаг», «Фильтр АКПП» /
  // «Гидрофильтр»): the shop's part dictionary puts both on its shelves. Another section only is another part.
  // «Без категории» and other shelves outside the storefront tree say nothing.
  const known = section && STOREFRONT_TAXONOMY.some((item) => item.slug === section) ? section : null;
  const ours = known ?? sectionOfName(name);
  const theirSection = sectionOfName(title);
  return !ours || !theirSection || ours === theirSection;
}

/** Parts every unit of a car has (seals, gaskets, bearings, hoses, fasteners): their shelf says nothing of the unit. */
const ANY_UNIT: ReadonlySet<string> = new Set([
  "prokladki-i-salniki", "stupitsy-i-podshipniki", "krestoviny-i-podshipniki", "patrubki-i-shlangi", "tormoznye-shlangi",
  "trubki-i-shlangi-na-metrazh", "homuty", "bolty-i-gayki", "klipsy", "fitingi-metallicheskie", "soediniteli-shlangov", "rvd",
]);

/** The storefront section the shop's part dictionary puts a name in («Датчик импульсов» → «elektrika»), or null. */
function sectionOfName(name: string): string | null {
  const slug = partDictionaryMatch(expandAbbreviations(name.replace(/[a-z](?=[а-я])/giu, (char) => LOOKALIKE[char.toLowerCase()] ?? char)));
  if (!slug || ANY_UNIT.has(slug)) return null;
  for (const section of STOREFRONT_TAXONOMY) {
    if (section.slug === slug || section.children.some((child) => child.slug === slug)) return section.slug;
  }
  return null;
}

/**
 * Several makers keep one number («334243»: KYB's shock absorber, MCS's mirror cover, IMASAF's catalyst): the one
 * whose kind of part the product's name names («Амортизатор …»). One maker's regional copies («KYB», «KYB-AU»)
 * count as that maker; null when none or more than one maker fits.
 */
export function makerByPartKind(name: string, rows: ReadonlyArray<{ brand: string; title: string | null }>): string | null {
  const words = new Set(stemsOf(name));
  const fitting = rows.filter((row) => row.title && stemsOf(row.title).some((stem) => words.has(stem)));
  // «KYB-AU», «KYB-MEA»: one maker's regional catalogues — the first word names the maker.
  const family = (a: string, b: string) => sameMaker(a, b) || (a.split(/[\s-]/u)[0]!.length >= 3 && a.split(/[\s-]/u)[0]!.toUpperCase() === b.split(/[\s-]/u)[0]!.toUpperCase());
  const makers: string[] = [];
  for (const row of fitting) {
    const same = makers.findIndex((maker) => family(maker, row.brand));
    if (same === -1) makers.push(row.brand);
    else if (row.brand.length < makers[same]!.length) makers[same] = row.brand;
  }
  return makers.length === 1 ? makers[0]! : null;
}
