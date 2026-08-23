// AN30-013 fix: category assignment for products imported from 1С must not
// depend on 1С's own grouping being present, resolvable and specific -- a
// real import against staging showed three of four representative products
// ending up with no usable category at all (see one-c-exchange.service.ts's
// module comment for the measured cases). This file is the pure, DB-free
// half of that fix: given a product's 1С group (if any) and its name, decide
// whether the group is usable, and if not, infer one of the shop's twelve
// known categories from the name -- or admit defeat and say so, rather than
// guess. one-c-exchange.service.ts is the only caller; it resolves the slugs
// this file returns to real app.categories ids (seeded once by migration
// 0024_one_c_exchange_category_fallback.sql, not created here).
//
// Design rule (the task's correctness bar): 1С's own grouping always wins
// when it names a real, specific category. Name-based inference only ever
// runs when 1С gave us nothing usable, and even then only commits to a
// category when exactly one of the twelve is a confident match -- anything
// ambiguous or unrecognised goes to UNCATEGORIZED_CATEGORY_SLUG instead of a
// plausible-looking guess, because a wrong category is worse than an honest
// "uncategorised" the owner can see and fix.

import { normalizeSearchQuery } from "./catalog-search-normalize.js";

export interface KnownCatalogCategory {
  /** The Russian label used both for the seeded app.categories row and (for the first 12) the home page's category tile. */
  readonly label: string;
  /**
   * Word-stem prefixes: a normalised product-name token counts as a match
   * for this category when it *starts with* one of these (covering Russian
   * declension -- "моторное"/"моторного"/"моторных" all start with "мотор"
   * -- since Russian case endings are suffixes appended to a stable stem,
   * never a prefix change). Deliberately the shop's own most distinctive
   * keyword per category, not the shared generic noun ("масло" alone would
   * match both motor and transmission oil), so a single token match is
   * already unambiguous within this list -- see inferCategoryFromProductName.
   */
  readonly rootStems: readonly string[];
  /** Matches categoryTiles' `key` in apps/web/app/(store)/_components/home-sections.tsx -- keep both in sync. */
  readonly slug: string;
}

/**
 * The shop's twelve known catalog sections, mirrored (slug + Russian label)
 * from `categoryTiles` in
 * apps/web/app/(store)/_components/home-sections.tsx verbatim -- apps/api
 * cannot import that file (it lives in the Next.js app), so this is a
 * deliberate, documented duplicate. If a tile is ever added, renamed or
 * removed there, this list (and migration 0024's seed data) must follow.
 *
 * `rootStems` is a lightweight, hand-picked substitute for a full Russian
 * morphological stemmer: a prefix long enough to be distinctive to this one
 * category (see the field doc above) and short enough that every common
 * declined form of the category's own name-words starts with it. This is
 * intentionally not a generic stemmer -- with only twelve fixed categories,
 * a curated, testable prefix list is safer than a general suffix-stripping
 * algorithm that could silently drift into false positives across an
 * unbounded vocabulary of real product names.
 */
export const KNOWN_CATALOG_CATEGORIES: readonly KnownCatalogCategory[] = [
  { label: "Моторные масла", rootStems: ["мотор"], slug: "motornye-masla" },
  { label: "Фильтры", rootStems: ["фильтр"], slug: "filtry" },
  { label: "Тормозная система", rootStems: ["тормоз"], slug: "tormoznaya-sistema" },
  { label: "Аккумуляторы", rootStems: ["аккумул"], slug: "akkumulyatory" },
  { label: "Трансмиссионные масла", rootStems: ["трансмисс"], slug: "transmissionnye-masla" },
  { label: "Антифриз", rootStems: ["антифриз"], slug: "antifriz" },
  // Two stems: a standalone "Лампа H4" (very common in real listings) starts
  // with "ламп", but the tile's own compound label "Автолампы" does not --
  // "автоламп" catches that compound form too.
  { label: "Автолампы", rootStems: ["ламп", "автоламп"], slug: "avtolampy" },
  { label: "Щётки стеклоочистителя", rootStems: ["щетк"], slug: "shchetki" },
  { label: "Гидравлическая жидкость", rootStems: ["гидравл"], slug: "gidravlicheskaya-zhidkost" },
  { label: "Автохимия", rootStems: ["автохим"], slug: "avtohimiya" },
  { label: "Инструменты", rootStems: ["инструм"], slug: "instrumenty" },
  { label: "Товары для техосмотра", rootStems: ["техосмотр"], slug: "tehosmotr" },
];

/**
 * A small, explicit exception list for common 1С-style abbreviations that a
 * forward stem-prefix match cannot catch (the *word* is shorter than the
 * category's root stem, not longer -- "мот." for "моторное", a real form
 * seen in 1С-exported names such as "Масло мот. 5W-40"). Kept separate from
 * KNOWN_CATALOG_CATEGORIES' rootStems (which only ever match a token that is
 * at least as long as the stem) and deliberately tiny: a generic
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
  return normalizeSearchQuery(value).toLowerCase().replace(/ё/gu, "е");
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
 * Infers one of the twelve known categories from a product's own name, for
 * use only once 1С's own group has already been ruled out as unusable (see
 * this file's module doc and one-c-exchange.service.ts's applyProduct). Two
 * matching rules, checked per token:
 *
 *   1. An explicit NAME_ABBREVIATIONS hit ("мот" -> motornye-masla).
 *   2. A token of at least 3 letters/digits that *starts with* one of a
 *      category's rootStems (declension-safe -- see that field's doc).
 *
 * Returns the matched slug only when every hit across the whole name agrees
 * on exactly one category. Zero hits (nothing recognisable) or hits on more
 * than one distinct category (an ambiguous name -- e.g. a product that
 * mentions two different known sections) both return null: per the task's
 * correctness bar, a wrong category is worse than an honest "uncategorised",
 * so ambiguity is never resolved by picking one guess over another.
 */
export function inferCategoryFromProductName(name: string): string | null {
  const matched = new Set<string>();
  for (const token of tokenize(name)) {
    const abbreviation = NAME_ABBREVIATIONS.get(token);
    if (abbreviation) {
      matched.add(abbreviation);
      continue;
    }
    if (token.length < 3) continue;
    for (const category of KNOWN_CATALOG_CATEGORIES) {
      if (category.rootStems.some((stem) => token.startsWith(stem))) {
        matched.add(category.slug);
        break;
      }
    }
  }
  return matched.size === 1 ? [...matched][0]! : null;
}
