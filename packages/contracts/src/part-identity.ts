import { normalizeArticleNumber } from "./catalog-search-normalize.js";
import { UNLINKABLE_SECTIONS } from "./parts-finder.js";

/**
 * Numbers of analogues the owner's 1С writes in a product's name: «… AFW1272 (FILTRON K1288, MANN CU3569)» ->
 * FILTRON K1288, MANN CU3569. They name other makers' parts, not the product's own maker (catalog-part-makers.ts
 * leaves brackets out for that reason); a check through them is labelled «по номерам-аналогам из названия».
 */
export function bracketedNumbers(name: string): Array<{ article: string; brand: string }> {
  const found: Array<{ article: string; brand: string }> = [];
  for (const [, inside] of name.matchAll(/\(([^()]{3,120})\)/gu)) {
    for (const segment of inside!.split(/[,;]/u)) {
      const words = segment.trim().split(/\s+/u).filter(Boolean);
      if (words.length < 2) continue;
      const number = words[words.length - 1]!;
      const maker = words.slice(0, -1).join(" ");
      // A maker is Latin letters (with «-», «&», «.»); a number has a digit and is not a size like «4л».
      if (!/^[A-Za-z][A-Za-z&.\- ]{1,30}$/u.test(maker) || !/\d/u.test(number) || /^[\d.,]+(?:л|мл|кг|г|мм|шт)\.?$/iu.test(number)) continue;
      if (normalizeArticleNumber(number).length < 3) continue;
      found.push({ article: number, brand: maker });
    }
  }
  return found;
}

/**
 * Whether the UMAPI catalogue can be asked about a product (compatibility, analogs, photo): outside
 * UNLINKABLE_SECTIONS, and either our own maker and a number of four characters or more, or analogue numbers in the
 * name, or a number of five characters or more whose maker UMAPI can tell. Unlike partNumberCatalogueApplies a
 * product without a maker of ours is not excluded: half of the owner's base names none.
 */
export function umapiCatalogueApplies(product: { brand: string | null; name: string; section: string | null; sku: string }): boolean {
  if (product.section && UNLINKABLE_SECTIONS.includes(product.section)) return false;
  const number = normalizeArticleNumber(product.sku).length;
  if (product.brand) return number >= 4;
  return number >= 5 || bracketedNumbers(product.name).length > 0;
}
