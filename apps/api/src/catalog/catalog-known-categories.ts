// Where a product from 1С goes in the storefront tree. The one entry point is decideStorefrontCategory (at the end
// of this file); the 1С exchange, the re-sorting service and the audit before an exchange all call it through
// placeProduct (catalog-recategorize.service.ts). This file is pure: no database, no network.
//
// A name is read by two readers, in this order:
//
//   1. The part dictionary (catalog-part-dictionary.ts): the noun a name leads with picks the shelf — «Амортизатор»,
//      «Прокладка масляного фильтра», «Фитинг». It decides about four names in five of the owner's base.
//   2. The section rules below, for goods that are named by a kind word and an adjective or a marking rather than
//      by a part's noun — oils, filters, lamps, batteries, wiper blades, antifreeze, car chemistry: the section
//      by its words (inferCategoryFromProductName), then the subsection by the stems written next to each
//      subsection in the tree (packages/contracts storefront-taxonomy.ts) or by a size or a marking
//      (SUBSECTION_BY_SIGNS).
//
// The two are not merged on purpose: the second reads adjectives anywhere in a name («Фильтр … масляный»), the
// first reads the leading noun and ignores the rest; one table would have to do both.
//
// The rule both follow: a wrong shelf is worse than an honest «Без категории» the staff can see and fix. Nothing
// here guesses; an ambiguous or unknown name goes to UNCATEGORIZED_CATEGORY_SLUG.

import { STOREFRONT_TAXONOMY } from "@an30/contracts";

import { cleanGroupName, isServiceGroupName } from "./catalog-group-names.js";
import { lampKind } from "./catalog-lamp-type.js";
import { shelfByOriginalNumber } from "./catalog-original-numbers.js";
import { tyreKindBySize } from "./catalog-tyre-size.js";
import { normalizeSearchQuery } from "./catalog-search-normalize.js";
import {
  describesWork, expandAbbreviations, partDictionaryAnswer, partHeadNoun, partSectionFromGroupName, type PartAnswer,
} from "./catalog-part-dictionary.js";

/**
 * Word-stem prefixes that name a whole section: a token of a product's name counts for the section when it *starts
 * with* one of them (Russian case endings are suffixes on a stable stem: «моторное», «моторного», «моторных»).
 * Each is the section's own distinctive word, not a shared noun («масло» alone would match both motor and
 * transmission oil). Sections without stems here are reached through inferByContext or the part dictionary.
 */
const ROOT_STEMS: Readonly<Record<string, readonly string[]>> = {
  filtry: ["фильтр"],
  "tormoznaya-sistema": ["тормоз"],
  akkumulyatory: ["аккумул", "акб"],
  // «трансмиссионное», not «трансмиссия»: the latter is the parts section.
  "transmissionnye-masla": ["трансмиссион"],
  antifriz: ["антифриз"],
  avtolampy: ["ламп", "автоламп"],
  shchetki: ["щетк", "щеток", "дворник"],
  "gidravlicheskaya-zhidkost": ["гидравл"],
  avtohimiya: ["автохим"],
  instrumenty: ["инструм"],
  tehosmotr: ["техосмотр"],
};

/**
 * A small, explicit exception list for common 1С-style abbreviations that a
 * forward stem-prefix match cannot catch (the *word* is shorter than the
 * category's root stem, not longer -- "мот." for "моторное", a real form
 * seen in 1С-exported names such as "Масло мот. 5W-40"). Kept separate from
 * ROOT_STEMS (which only ever match a token that is at least as long as the
 * stem) and deliberately tiny: a generic
 * "does-the-shorter-string-prefix-the-longer-one" rule in either direction
 * would also match unrelated words that merely start the same way (e.g. a
 * literal token "авто" would then prefix-match "автохим" and misfile an
 * unrelated product) -- see inferCategoryFromProductName's ambiguity
 * handling for why that matters.
 */
const NAME_ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ["мот", "motornye-masla"],
]);

/** Slug + label for the explicit "could not determine a category" bucket -- seeded by migration 0024, never guessed into silently. */
export const UNCATEGORIZED_CATEGORY_SLUG = "bez-kategorii";
export const UNCATEGORIZED_CATEGORY_LABEL = "Без категории";

/**
 * The hidden shelf: a section that is never public (its app.categories row is
 * inactive, migration 0048). The base holds things the shop does not sell
 * online — services, the workshop's price list, grain, fixed assets; staff
 * point their 1С group, a sorting rule or a single product at this slug, and
 * the storefront's ordinary rule «a product is visible only in a visible
 * section» hides them. Nothing is put here by guessing.
 */
export const HIDDEN_CATEGORY_SLUG = "ne-pokazyvat";
export const HIDDEN_CATEGORY_LABEL = "Не показывать на сайте";

/** Slugs staff may choose that are not sections of the storefront tree. */
const STAFF_ONLY_SLUGS: ReadonlySet<string> = new Set([UNCATEGORIZED_CATEGORY_SLUG, HIDDEN_CATEGORY_SLUG]);

/**
 * Generic 1С catalog-root/catch-all group names seen across real "Обмен с
 * сайтом" exports -- a product filed under one of these carries exactly as
 * little category information as a product with no group at all, so it is
 * treated the same way (fall through to name-based inference) instead of
 * being filed under a meaningless bucket:
 *
 *   - "Номенклатура" -- 1С's own word for "the item catalog" itself; many
 *     exporters emit this as the literal root group name when the source
 *     database's classifier was never given real top-level categories.
 *   - "Товары" -- a bare "goods" catch-all some 1С configurations use as a
 *     default group for anything not otherwise sorted (this task's own
 *     measured case: "Аккумулятор Тюмень 62Ач" arrived filed under exactly
 *     this).
 *   - "Прочее" -- "miscellaneous", the standard 1С default for an item left
 *     unclassified.
 *   - "Основная группа" -- "root/default group", a literal placeholder label
 *     some 1С configurations leave unrenamed.
 *
 * Matched case-insensitively (and ё/е-folded) against the *group's own*
 * name -- see foldForMatching -- never against the product name.
 */
export const JUNK_CATEGORY_GROUP_NAMES: ReadonlySet<string> = new Set([
  "номенклатура",
  "товары",
  "прочее",
  "основная группа",
]);

/** Case-fold, ё/е-fold and whitespace-collapse: the shared normalisation both isJunkCategoryGroupName and inferCategoryFromProductName's tokenizer run on. */
function foldForMatching(value: string): string {
  // The same reading as the part dictionary's: «Mасло» typed with a Latin M is the Russian word, and 1С shorthand
  // is spelled out («фильтр масл.», «п/синт.», «мин.»), so the words that pick a subsection are found.
  return expandAbbreviations(normalizeSearchQuery(value));
}

/** True when a 1С group's own name is one of the generic catch-alls in JUNK_CATEGORY_GROUP_NAMES -- see that constant for why each one is listed. */
export function isJunkCategoryGroupName(name: string): boolean {
  return JUNK_CATEGORY_GROUP_NAMES.has(foldForMatching(name));
}

/** Splits a folded product name into letter/digit tokens -- punctuation, slashes and dashes are word boundaries, matching how 1С names like "Масло мот. 5W-40" are actually built out of distinct words. */
function tokenize(name: string): string[] {
  return foldForMatching(name).split(/[^a-zа-я0-9]+/u).filter((token) => token.length > 0);
}

/**
 * Infers a section from the words of a name (the second reader of this
 * file's module doc). Context rules first (inferByContext), then two
 * matching rules, checked per token:
 *
 *   1. An explicit NAME_ABBREVIATIONS hit ("мот" -> motornye-masla).
 *   2. A token of at least 3 letters/digits that *starts with* one of a
 *      section's ROOT_STEMS (declension-safe).
 *
 * Returns the matched slug only when every hit across the whole name agrees
 * on exactly one category. Zero hits (nothing recognisable) or hits on more
 * than one distinct category (an ambiguous name -- e.g. a product that
 * mentions two different known sections) both return null: per the task's
 * correctness bar, a wrong category is worse than an honest "uncategorised",
 * so ambiguity is never resolved by picking one guess over another.
 */
const TOOL_STEMS = ["ключ", "съемник", "отвертк", "домкрат", "пассатиж", "плоскогубц", "тестер", "ареометр", "щуп", "набор инструм"];
const ACCESSORY_STEMS = ["клемм", "зарядн", "прикурив"];
/** «Пусковые провода», «пусковое устройство» are battery accessories; «пусковой ток 550 А» is a battery's own property. */
const STARTING_AID_STEMS = ["провод", "кабел", "устройств", "зажим"];
const ELECTRIC_MOTOR_HINTS = ["стеклоочист", "отопител", "вентилятор", "печк", "моторчик", "электромотор"];
const VISCOSITY_PATTERN = /\b\d{1,2}w-?\d{2}\b/u;
/** The word «масло» itself, in the cases a product name uses; a viscosity may be glued to it («масло15W-40»). */
const OIL_WORD = /^(?:масло|масла|маслом|масле|масел)(?:\d[a-z0-9]*)?$/u;
/** «10/40», «5/30»: the viscosity as some 1С names write it. */
const SLASH_VISCOSITY = /(?<![\d/.,])(?:0|5|10|15|20|25)\/(?:20|30|40|50|60)(?![\d/.,])/u;
/** GOST grades of mineral motor oils: «М10Г2К», «М-8В», «М10ДМ». */
const GOST_OIL_GRADE = /(?<![a-zа-я0-9])м-?\d{1,2}[бвгде]\d?[а-я]{0,2}(?![a-zа-я0-9])/u;
/** The same grade typed with a space («М8 В»). Read only in a name already known to be a motor oil: «М8 в сборе» is a bolt. */
const GOST_OIL_GRADE_SPACED = /(?<![a-zа-я0-9])м-?\d{1,2}\s[бвгде]\d?[а-я]{0,2}(?![a-zа-я0-9])/u;
/** «2T», «4T», with a Latin or a Russian T. */
const TWO_OR_FOUR_STROKE = /(?<![a-zа-я0-9])[24][tт](?![a-zа-я0-9])/u;
/** «4л», «(200л.)», «180кг»: how oils are packed. */
const PACK_SIZE = /(?<![a-zа-я0-9])\d+(?:[.,]\d+)?\s*(?:л|l|кг)(?![a-zа-я0-9])/u;
/** «Масло для пилы», «для бензопил», «цепное». */
const SAW_WORDS = ["пилы", "пил ", "бензопил", "цепн"];

/**
 * Context rules that a plain "first matching stem" pass gets wrong. Returns
 * a slug, null for "deliberately no section" (better «Без категории» than a
 * wrong one), or undefined when no rule applies.
 */
function inferByContext(folded: string, tokens: readonly string[]): string | null | undefined {
  const has = (stem: string) => stem.includes(" ") ? folded.includes(stem) : tokens.some((token) => token.startsWith(stem));
  // A tool for a filter or a wheel is a tool, not a filter.
  if (TOOL_STEMS.some(has)) return "instrumenty";
  // Clamps, chargers and jump leads are not batteries, but the storefront
  // files them in the battery section's own subsections.
  if (ACCESSORY_STEMS.some(has) || (has("пусков") && STARTING_AID_STEMS.some(has))) return "akkumulyatory";
  // An electric motor (wiper, heater fan) is a part, not motor oil.
  if (has("мотор") && ELECTRIC_MOTOR_HINTS.some(has)) return null;
  // Russian part names lead with the part type: "Фильтр масляный ...".
  if (tokens[0]?.startsWith("фильтр")) return "filtry";
  if (has("антифриз") || has("тосол") || folded.includes("охлаждающ")) return "antifriz";
  const oilAbbreviation = tokens.includes("мот");
  // The word «масло» itself: «маслопровод ГУР», «насос масляный АКПП» are parts, not oils.
  if (oilAbbreviation || tokens.some((token) => OIL_WORD.test(token))) {
    if (has("трансмисс") || has("кпп") || has("акпп") || /\batf\b/u.test(folded) || /\b(75|80|85)w/u.test(folded)) return "transmissionnye-masla";
    if (has("вариатор") || /\bcvt\b/u.test(folded) || has("dexron") || has("редуктор") || (has("автоматич") && has("короб"))) return "transmissionnye-masla";
    if (has("гидравл") || has("гур") || has("гидроусил")) return "gidravlicheskaya-zhidkost";
    if (has("мотор") || oilAbbreviation || has("двигат") || VISCOSITY_PATTERN.test(folded)) return "motornye-masla";
    if (SLASH_VISCOSITY.test(folded) || GOST_OIL_GRADE.test(folded) || TWO_OR_FOUR_STROKE.test(folded) || SAW_WORDS.some(has) || has("промывочн")) return "motornye-masla";
  }
  // An oil named without the word «масло» («SHELL HELIX ULTRA ECT C3 5W-30 4Л», «ZIC ATF DEXRON II (200л.)»): the
  // grade together with the pack size says what it is.
  if (PACK_SIZE.test(folded)) {
    if (/\batf\b/u.test(folded) || /\b(75|80|85)w/u.test(folded)) return "transmissionnye-masla";
    if (VISCOSITY_PATTERN.test(folded) || GOST_OIL_GRADE.test(folded)) return "motornye-masla";
  }
  return undefined;
}

export function inferCategoryFromProductName(name: string): string | null {
  const folded = foldForMatching(name);
  const contextual = inferByContext(folded, tokenize(name));
  if (contextual !== undefined) return contextual;
  const matched = new Set<string>();
  for (const token of tokenize(name)) {
    const abbreviation = NAME_ABBREVIATIONS.get(token);
    if (abbreviation) {
      matched.add(abbreviation);
      continue;
    }
    if (token.length < 3) continue;
    const section = Object.entries(ROOT_STEMS).find(([, stems]) => stems.some((stem) => token.startsWith(stem)));
    if (section) matched.add(section[0]);
  }
  return matched.size === 1 ? [...matched][0]! : null;
}

// ---------------------------------------------------------------------------
// Subsections and 1С groups
// ---------------------------------------------------------------------------

/**
 * Words that name the section itself ("Масло моторное", "Фильтр", "Лампа").
 * They never pick a subsection: "моторное" must not match the "мото" stem of
 * «Для мото- и садовой техники».
 */
const SECTION_WORD_STEMS: Readonly<Record<string, readonly string[]>> = {
  "motornye-masla": ["мотор", "масл", "масел"],
  "transmissionnye-masla": ["трансмисс", "масл", "масел"],
  filtry: ["фильтр"],
  "tormoznaya-sistema": ["тормоз"],
  akkumulyatory: ["аккумул", "акб"],
  antifriz: ["антифриз", "тосол", "охлажд"],
  avtolampy: ["ламп", "автоламп"],
  shchetki: ["щетк", "щеток", "стеклоочист", "дворник"],
  "gidravlicheskaya-zhidkost": ["гидравл", "жидкост"],
  avtohimiya: ["автохим"],
  instrumenty: ["инструм"],
  tehosmotr: ["техосмотр"],
};

// Generic words that name a kind of product in several subsections
// ("очиститель стёкол", "очиститель салона"): they pick a subsection only
// when nothing more specific in the name does.
const WEAK_STEMS: ReadonlySet<string> = new Set(["очистител", "жидкост"]);

/**
 * Subsections distinctive enough to be recognised from a name that names no
 * section at all ("Огнетушитель ОП-2", "Литол-24"). Others ("Диск", "Набор")
 * mean different things in different sections and are only used once the
 * section is known.
 */
const SELF_IDENTIFYING_SUBSECTIONS: ReadonlySet<string> = new Set([
  "aptechki", "ognetushiteli", "znaki-avariynoy-ostanovki", "zhilety-i-buksirnye-trosy",
  "zhidkost-omyvatelya", "smazki", "prisadki", "dlya-remonta", "distillirovannaya-voda",
  "zaryadnye-ustroystva", "domkraty", "semniki",
]);

const TAXONOMY_PARENT: ReadonlyMap<string, string> = new Map(
  STOREFRONT_TAXONOMY.flatMap((section) => section.children.map((child) => [child.slug, section.slug] as const)),
);
const TOP_LEVEL_SLUGS: ReadonlySet<string> = new Set(STOREFRONT_TAXONOMY.map((section) => section.slug));

/** Every storefront section slug (top level and subsections) plus «Без категории». */
export const STOREFRONT_CATEGORY_SLUGS: readonly string[] = [
  ...STOREFRONT_TAXONOMY.flatMap((section) => [section.slug, ...section.children.map((child) => child.slug)]),
  UNCATEGORIZED_CATEGORY_SLUG,
  HIDDEN_CATEGORY_SLUG,
];

/** The top-level section of a storefront slug (itself for a top-level one); undefined for anything else. */
export function storefrontParentSlug(slug: string): string | undefined {
  return TOP_LEVEL_SLUGS.has(slug) ? slug : TAXONOMY_PARENT.get(slug);
}

function foldStem(stem: string): string {
  return stem.toLowerCase().replace(/ё/gu, "е");
}

/** Index of the first token a stem matches: a plain stem is a token prefix, one with punctuation ("gl-4", "wd-40") a substring of the name. */
function stemPosition(stem: string, folded: string, tokens: readonly string[], skipped: ReadonlySet<number>): number {
  const value = foldStem(stem);
  if (/[^a-zа-я0-9]/u.test(value)) {
    const at = folded.indexOf(value);
    return at === -1 ? -1 : folded.slice(0, at).split(/[^a-zа-я0-9]+/u).filter(Boolean).length;
  }
  return tokens.findIndex((token, index) => !skipped.has(index) && token.startsWith(value));
}

/** Subsections whose stems match the name, each with the position of its earliest matching word. */
function matchSubsections(name: string, candidates: ReadonlyArray<{ slug: string; stems: readonly string[] }>, sectionSlug?: string) {
  const folded = foldForMatching(name);
  const tokens = tokenize(name);
  const sectionWords = sectionSlug ? SECTION_WORD_STEMS[sectionSlug] ?? [] : [];
  const skipped = new Set(tokens.flatMap((token, index) => sectionWords.some((stem) => token.startsWith(stem)) ? [index] : []));
  const hits: Array<{ position: number; slug: string; weak: boolean }> = [];
  for (const candidate of candidates) {
    const matched = candidate.stems
      .map((stem) => ({ at: stemPosition(stem, folded, tokens, skipped), weak: WEAK_STEMS.has(foldStem(stem)) }))
      .filter((match) => match.at >= 0);
    if (matched.length === 0) continue;
    const strong = matched.filter((match) => !match.weak);
    const best = strong.length > 0 ? strong : matched;
    hits.push({ position: Math.min(...best.map((match) => match.at)), slug: candidate.slug, weak: strong.length === 0 });
  }
  // A weak-only match never competes with a specific one.
  return hits.some((hit) => !hit.weak) ? hits.filter((hit) => !hit.weak) : hits;
}

/**
 * Picks a subsection of `sectionSlug` from a name: the one subsection whose
 * stems match. When several match, the one named first wins if no other
 * shares that word -- Russian part names lead with the part type
 * ("Колодки тормозные дисковые" are pads, not discs). Otherwise null: the
 * product stays in the section itself.
 */
export function inferSubsection(sectionSlug: string, name: string): string | null {
  const section = STOREFRONT_TAXONOMY.find((item) => item.slug === sectionSlug);
  if (!section) return null;
  const hits = matchSubsections(name, section.children, sectionSlug);
  if (hits.length === 1) return hits[0]!.slug;
  if (hits.length === 0) return SUBSECTION_BY_SIGNS[sectionSlug]?.(name) ?? null;
  const dominant = DOMINANT_SUBSECTIONS[sectionSlug]?.find((slug) => hits.some((hit) => hit.slug === slug));
  if (dominant) return dominant;
  const first = Math.min(...hits.map((hit) => hit.position));
  const leading = hits.filter((hit) => hit.position === first);
  return leading.length === 1 ? leading[0]!.slug : null;
}

/** «60Ач», «190 А·ч», «75 А/Ч», «50A/h», «110Ah», in Russian or Latin letters; never «500 A (EN)», which is amperes. */
const BATTERY_CAPACITY = /(\d{1,3})\s*[аa]\s*[·./]?\s*[чh](?![a-zа-я])/u;
/** The GOST name of a starter battery carries its capacity: «6СТ-75». */
const GOST_BATTERY_NAME = /6\s*ст\s*-?\s*(\d{2,3})(?!\d)/u;

/** A starter battery's capacity says what it is for when the name does not. */
function batteryByCapacity(name: string): string | null {
  const folded = foldForMatching(name);
  const capacity = Number((BATTERY_CAPACITY.exec(folded) ?? GOST_BATTERY_NAME.exec(folded))?.[1] ?? Number.NaN);
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  if (capacity <= 25) return "akkumulyatory-moto";
  if (capacity <= 110) return "akkumulyatory-legkovye";
  return capacity >= 130 ? "akkumulyatory-gruzovye" : null;
}

/**
 * What the stems cannot say about a motor oil: «син» and «мин» as words of their own (in a lamp's name «син» is a
 * colour, in a flush's name «мин» is minutes, so neither is a stem), and the GOST grades of mineral oils («М10Г2К»,
 * «М-8В», «М10ДМ»). The viscosity is never taken for the kind: a 5W-40 may be either.
 */
function motorOilKind(name: string): string | null {
  const tokens = tokenize(name);
  const folded = foldForMatching(name);
  if (tokens.includes("син")) return "sinteticheskie-motornye-masla";
  // «(мин)» without its dot: in an oil's name it is «mineral», elsewhere it is minutes.
  if (tokens.includes("мин") || GOST_OIL_GRADE.test(folded) || GOST_OIL_GRADE_SPACED.test(folded)) return "mineralnye-motornye-masla";
  if (SAW_WORDS.some((word) => word.includes(" ") ? folded.includes(word) : tokens.some((token) => token.startsWith(word)))) return "masla-dlya-moto-i-sadovoy-tekhniki";
  return null;
}

/**
 * Subsections that win whenever they match, wherever their word stands: a two- or four-stroke oil is filed by what
 * it is for, whatever its base («Масло моторное минеральное Castrol Outboard 4T»).
 */
const DOMINANT_SUBSECTIONS: Readonly<Record<string, readonly string[]>> = {
  // «Фильтрующий элемент масла АКПП» is a gearbox filter, not an engine oil filter.
  filtry: ["filtry-akpp-i-gidravliki"],
  "motornye-masla": ["masla-dlya-moto-i-sadovoy-tekhniki", "promyvochnye-masla"],
};

/** Sections whose subsection can be read from signs other than words, asked when no stem matched. */
const SUBSECTION_BY_SIGNS: Readonly<Record<string, (name: string) => string | null>> = {
  akkumulyatory: batteryByCapacity,
  avtolampy: lampKind,
  "motornye-masla": motorOilKind,
  "shiny-i-diski": tyreKindBySize,
};

/** The most specific storefront section a name points to: subsection, else section, else null. */
export function inferStorefrontCategory(name: string): string | null {
  const section = inferCategoryFromProductName(name);
  if (section) return inferSubsection(section, name) ?? section;
  const candidates = STOREFRONT_TAXONOMY.flatMap((item) => item.children)
    .filter((child) => SELF_IDENTIFYING_SUBSECTIONS.has(child.slug));
  const hits = matchSubsections(name, candidates);
  return hits.length === 1 ? hits[0]!.slug : null;
}

/** True when the name's first word names the part type of `slug` ("Фильтр масляный…", "Масло моторное…"). */
function leadsWithPartType(name: string, slug: string): boolean {
  const first = tokenize(name)[0];
  const parent = storefrontParentSlug(slug);
  if (!first || !parent) return false;
  const child = STOREFRONT_TAXONOMY.find((item) => item.slug === parent)?.children.find((item) => item.slug === slug);
  const stems = [...(SECTION_WORD_STEMS[parent] ?? []), ...(ROOT_STEMS[parent] ?? []), ...(child?.stems ?? [])].map(foldStem);
  return stems.some((stem) => /^[a-zа-я0-9]+$/u.test(stem) && first.startsWith(stem));
}

/** What decided a product's shelf; "number" is the original part number in its name or article (catalog-original-numbers.ts). */
export type CategoryDecisionSource = "group" | "manual" | "name" | "none" | "number" | "rule";

/** A staff rule from app.catalog_placement_rules (catalog-recategorize.service.ts loads them). */
export interface PlacementRule {
  /** app.normalize_brand form, or null for any brand. */
  brandKey: string | null;
  /** The word the name leads with, as a word start; null for any. */
  headStem: string | null;
  /** Word starts that must all be present in the name. */
  nameStems: readonly string[];
  /** Normalised article prefix, or null for any. */
  skuPrefix: string | null;
  slug: string;
}

/** The most specific staff rule a product satisfies, or null. `rules` are ordered most specific first. */
export function matchPlacementRule(rules: readonly PlacementRule[], product: { brandKey: string; name: string; skuNormalized: string }): string | null {
  if (rules.length === 0) return null;
  const tokens = tokenize(product.name);
  const head = partHeadNoun(product.name);
  for (const rule of rules) {
    if (rule.headStem && !(head?.startsWith(rule.headStem) ?? false)) continue;
    if (rule.brandKey && rule.brandKey !== product.brandKey) continue;
    if (rule.skuPrefix && !product.skuNormalized.startsWith(rule.skuPrefix)) continue;
    if (!rule.nameStems.every((stem) => tokens.some((token) => token.startsWith(stem)))) continue;
    return rule.slug;
  }
  return null;
}

export interface CategoryDecision {
  /** A STOREFRONT_CATEGORY_SLUGS entry; «Без категории» when source is "none". */
  slug: string;
  source: CategoryDecisionSource;
}

/**
 * The section a chain of 1С groups points at — the product's own group first, then its parents — or null.
 *
 * A group is named like a product («Катушки зажигания», «Щетки генератора»), so the part dictionary reads it
 * first. A short leaf is read together with its parents' words: «Диски» inside «А/шина легковая» are wheels,
 * «Диск» inside «Сцепление» is a clutch disc. A leaf that only names a kind narrows its parent: «Мото» inside
 * «АКБ» are motorcycle batteries. Only then come the section words of the leaf, and last the parents' answer.
 */
function readGroupChain(names: readonly string[]): PartAnswer | null {
  const [leaf, ...parents] = names;
  if (leaf === undefined) return null;
  const own = partDictionaryAnswer(leaf);
  // A short leaf, one that names only a universal part («Подшипник» inside «Сцепление») or only a whole section
  // («Фитинг Т» inside «Фитинг ПВХ») is read together with its parents' words.
  const vague = !own || own.general || TOP_LEVEL_SLUGS.has(own.slug);
  const withParents = vague && parents.length > 0 ? partDictionaryAnswer(`${leaf} ${parents.join(" ")}`) : null;
  const named = withParents && !withParents.general && !TOP_LEVEL_SLUGS.has(withParents.slug) ? withParents : own ?? withParents;
  if (named) return { general: named.general, slug: TOP_LEVEL_SLUGS.has(named.slug) ? inferSubsection(named.slug, leaf) ?? named.slug : named.slug };
  const above = readGroupChain(parents);
  if (above && TOP_LEVEL_SLUGS.has(above.slug)) {
    const narrowed = inferSubsection(above.slug, leaf);
    if (narrowed) return { general: false, slug: narrowed };
  }
  const section = inferCategoryFromProductName(leaf) ?? partSectionFromGroupName(leaf);
  const slug = section ? inferSubsection(section, leaf) ?? section : inferStorefrontCategory(leaf);
  return slug ? { general: false, slug } : above;
}

/**
 * Where a 1С product goes in the storefront tree, in this order:
 *   1. the staff mapping of its 1С group (a section is refined to a
 *      subsection by the group and product names);
 *   2. its 1С group's name, then its parent groups' names;
 *   3. the product's own name;
 *   4. the original part number in its name or article, when it is a
 *      reliable witness («Втулка TG-48815-60121» → stabilizer bushes);
 *   5. «Без категории».
 * `groupNames` runs from the product's own group up to the root; catch-all
 * names ("Товары", "Номенклатура") are ignored.
 */
export function decideStorefrontCategory(input: {
  groupNames: readonly string[];
  manualSlug?: string | null;
  productName: string;
  /** A staff rule the product satisfies (matchPlacementRule); it outranks everything automatic. */
  ruleSlug?: string | null;
  /** The product's article: an original number may stand there and not in the name. */
  sku?: string | null;
}): CategoryDecision {
  if (input.ruleSlug && (storefrontParentSlug(input.ruleSlug) || STAFF_ONLY_SLUGS.has(input.ruleSlug))) {
    return { slug: input.ruleSlug, source: "rule" };
  }
  // The owner's numbering and stock notes are not part of a group's name; a name left without a letter says nothing.
  const groups = input.groupNames.map(cleanGroupName).filter((name) => /[a-zа-яё]/iu.test(name) && !isJunkCategoryGroupName(name));
  // The noun the name leads with («Амортизатор …», «Прокладка масляного фильтра»). When it names only a section
  // («Жидкость для АКПП» → transmission fluids), the rest of the name narrows it to a subsection.
  const answer = partDictionaryAnswer(input.productName);
  const named = answer?.slug ?? null;
  const dictionary = named && TOP_LEVEL_SLUGS.has(named) ? inferSubsection(named, input.productName) ?? named : named;
  // The name's own words picked the shelf: it is neither a universal part's general shelf nor a section narrowed
  // by a size or a marking.
  const confident = answer !== null && !answer.general && !TOP_LEVEL_SLUGS.has(answer.slug);
  const refine = (section: string): string => {
    if (dictionary && storefrontParentSlug(dictionary) === section) return dictionary;
    for (const name of groups) {
      const sub = inferSubsection(section, name);
      if (sub) return sub;
    }
    return inferSubsection(section, input.productName) ?? section;
  };
  if (input.manualSlug && storefrontParentSlug(input.manualSlug)) {
    return { slug: TOP_LEVEL_SLUGS.has(input.manualSlug) ? refine(input.manualSlug) : input.manualSlug, source: "manual" };
  }
  if (input.manualSlug && STAFF_ONLY_SLUGS.has(input.manualSlug)) return { slug: input.manualSlug, source: "manual" };
  // Work is not a product: no automatic rule places it; staff send its 1С group to the hidden shelf.
  if (describesWork(input.productName)) return { slug: UNCATEGORIZED_CATEGORY_SLUG, source: "none" };
  // The workshop's price list («Шиномонтажа», «СТО») and everything under it gives no section.
  const fromGroups = groups.some(isServiceGroupName) ? null : readGroupChain(groups);
  const byGroup = fromGroups ? (TOP_LEVEL_SLUGS.has(fromGroups.slug) ? refine(fromGroups.slug) : fromGroups.slug) : null;
  // «Прокладка масляного фильтра» is a gasket, «Щётки генератора» are not wiper blades:
  // the leading noun is asked before the section words found anywhere in the name.
  const byName = dictionary ?? inferStorefrontCategory(input.productName);
  if (fromGroups && byGroup && byName) {
    if (byGroup === byName) return { slug: byGroup, source: "group" };
    const groupNamesShelf = !TOP_LEVEL_SLUGS.has(byGroup);
    // A bare «Сальник 35x50x8» or «Подшипник 6205» serves whatever unit the owner filed it under.
    if (answer?.general && groupNamesShelf && !fromGroups.general) return { slug: byGroup, source: "group" };
    // Real 1С groups are often mixed ("Масла и смазки", "Автохимия"): a name
    // that leads with its part type ("Масло моторное", "Антифриз") is the
    // better witness when the two disagree on the section. Within one section
    // the more specific answer wins; of two shelves, the name's — when its own
    // words picked it («Пыльник амортизатора» in the group «Амортизаторы») —
    // and the group's otherwise.
    const sameSection = storefrontParentSlug(byGroup) === storefrontParentSlug(byName);
    const nameWins = sameSection
      ? !TOP_LEVEL_SLUGS.has(byName) && (!groupNamesShelf || confident)
      : dictionary !== null || leadsWithPartType(input.productName, byName);
    return nameWins ? { slug: byName, source: "name" } : { slug: byGroup, source: "group" };
  }
  if (byGroup) return { slug: byGroup, source: "group" };
  if (byName) return { slug: byName, source: "name" };
  const byNumber = shelfByOriginalNumber(`${input.productName} ${input.sku ?? ""}`);
  if (byNumber) return { slug: byNumber, source: "number" };
  return { slug: UNCATEGORIZED_CATEGORY_SLUG, source: "none" };
}
