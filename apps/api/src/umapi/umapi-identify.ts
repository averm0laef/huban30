/**
 * Which catalogue part a product of ours is (docs/UMAPI_INTEGRATION.md, part 4).
 * Pure rules; the service asks UMAPI with what they give.
 *
 * Our own brand and number come first. When 1С names no maker, the numbers in
 * the name's brackets («… AFW1272 (FILTRON K1288, MANN CU3569)») are analogues
 * of the product, not the product: they may stand in for it only as «по
 * номерам-аналогам из названия», and only when they agree.
 */
import { bracketedNumbers, normalizeArticleNumber, normalizeBrand } from "@an30/contracts";

export interface PartCandidate {
  article: string;
  /** null: our number without a maker — UMAPI is asked whose it is. */
  brand: string | null;
  /** «own»: the product's brand and number; «name»: a number named in the product's name. */
  via: "own" | "name";
}

// Short forms the owner's 1С uses for makers whose catalogue name is longer.
const MAKER_ALIASES: Readonly<Record<string, string>> = {
  MANN: "MANNFILTER",
  HENGST: "HENGSTFILTER",
  KNECHT: "KNECHTMAHLE",
  MAHLE: "MAHLEORIGINAL",
};

/** A maker's name as compared: «MANN-FILTER», «Mann filter» and «MANN» are one maker. */
export function makerKey(name: string): string {
  const key = normalizeBrand(name);
  return MAKER_ALIASES[key] ?? key;
}

/** True when two spellings name one maker: equal keys, or one is the other plus a word («MANN» / «MANN-FILTER»). */
export function sameMaker(a: string, b: string): boolean {
  const left = makerKey(a);
  const right = makerKey(b);
  if (!left || !right) return false;
  return left === right || (left.length >= 3 && right.startsWith(left)) || (right.length >= 3 && left.startsWith(right));
}

/** What to look up, in order: our brand and number, then (without a brand of ours) the bracketed analogue numbers. */
export function partCandidates(product: { brand: string | null; name: string; sku: string }): PartCandidate[] {
  const own: PartCandidate = { article: product.sku, brand: product.brand, via: "own" };
  if (product.brand) return [own];
  const named = bracketedNumbers(product.name)
    .filter((item) => normalizeArticleNumber(item.article) !== normalizeArticleNumber(product.sku))
    .slice(0, 3)
    .map((item): PartCandidate => ({ ...item, via: "name" }));
  return [own, ...named];
}
