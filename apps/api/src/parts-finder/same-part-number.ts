import { HIDDEN_CATEGORY_SLUG, UNCATEGORIZED_CATEGORY_SLUG, decideStorefrontCategory, storefrontParentSlug } from "../catalog/catalog-known-categories.js";
import { partTypeKey } from "../catalog/catalog-part-dictionary.js";

/** What is known of one product (or one requested part) beyond its number. */
export interface PartSide {
  /** The brand's identity (app.canonical_brand); null when unknown. */
  brand: string | null;
  /** The storefront section at the top of its shelf; null when unknown, the «Без категории» queue or the hidden shelf. */
  section: string | null;
  /** The kind of part its name is about (partTypeKey); null when the name has no noun. */
  type: string | null;
  /**
   * Its own article is a vehicle maker's original number («13265-74030», «TG-48815-60121»: originalPartCode in catalog-original-numbers.ts).
   * In the owner's base no such number is shared by products of two sections (checked 23.11.2026 on 42 723 items).
   */
  originalNumber?: boolean;
}

/** A number of up to five digits: dozens of makers use «3930» or «2022» for unrelated things. */
const SHORT_DIGITS = /^\d{1,5}$/u;

/** A top-level storefront section, or null for the queue and the hidden shelf: neither says what a product is. */
export function sectionOf(slug: string | null | undefined): string | null {
  if (!slug || slug === UNCATEGORIZED_CATEGORY_SLUG || slug === HIDDEN_CATEGORY_SLUG) return null;
  return storefrontParentSlug(slug) ?? null;
}

/** The section of our product, from the root of its category in the database; null for the queue and the hidden shelf. */
export function sectionFromRoot(rootSlug: string | null | undefined): string | null {
  return !rootSlug || rootSlug === UNCATEGORIZED_CATEGORY_SLUG || rootSlug === HIDDEN_CATEGORY_SLUG ? null : rootSlug;
}

/** A part known only by its brand and name, e.g. a parts catalogue's row: placed by the same rules as our products. */
export function sideFromName(brand: string | null, name: string | null | undefined): PartSide {
  const text = name?.trim() ?? "";
  if (!text) return { brand, section: null, type: null };
  return { brand, section: sectionOf(decideStorefrontCategory({ groupNames: [], productName: text }).slug), type: partTypeKey(text) };
}

/**
 * Whether a product carrying the requested number is the requested part itself and not just another maker's
 * product that happens to share the digits (docs/CATALOG_MATCHING.md, «Совпадение номера»):
 *  - nothing is known of the request (a customer typed only the number): every product of the number is shown;
 *  - both brands known: they must be one brand;
 *  - a brand unknown on either side: never for a short number of digits; a vehicle maker's original number standing as
 *    our product's article is that part; otherwise the same section and the same kind of part.
 * Anything else reaches a product only through a confirmed cross.
 */
export function sameNumberIsSamePart(article: string, asked: PartSide | null, offered: PartSide): boolean {
  if (asked === null) return true;
  if (asked.brand && offered.brand) return asked.brand === offered.brand;
  if (SHORT_DIGITS.test(article)) return false;
  if (offered.originalNumber) return true;
  return asked.section !== null && asked.section === offered.section && asked.type !== null && asked.type === offered.type;
}
