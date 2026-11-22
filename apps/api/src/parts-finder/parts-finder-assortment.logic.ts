import { normalizeBrand } from "@an30/contracts";

/** alias (app.normalize_brand form) -> canonical brand, loaded from app.brand_identities. */
export type BrandIdentities = ReadonlyMap<string, string>;

export function canonicalBrand(brand: string | null | undefined, identities: BrandIdentities): string {
  const key = brand ? normalizeBrand(brand) : "";
  return identities.get(key) ?? key;
}

export type ProductLinkDecision =
  | { action: "linked" }
  | { action: "no_data" }
  /** The number belongs to several brands: ask again for ours (one more credit). */
  | { action: "ask_brand"; manufacturerId: number }
  /** The catalogue knows the number, but not under our brand: never link by number alone. */
  | { action: "brand_mismatch"; note: string };

interface CardPart { article?: unknown; brand?: unknown; manufacturer_id?: unknown }

function brandsNote(parts: readonly CardPart[]): string {
  const brands = [...new Set(parts.flatMap((part) => (typeof part.brand === "string" && part.brand.trim() ? [part.brand.trim()] : [])))];
  return brands.slice(0, 8).join(", ").slice(0, 200);
}

/**
 * What a FAPI card (findPart result) for one of our products allows. A link
 * is made only when the card's brand is our product's brand by identity
 * («MANN» in 1С = «MANN-FILTER» in the catalogue); a number alone is never
 * an identity (docs/CATALOG_MATCHING.md).
 */
export function decideProductLink(card: Record<string, unknown>, productBrand: string, identities: BrandIdentities): ProductLinkDecision {
  const ours = canonicalBrand(productBrand, identities);
  if (card.status === "choose_brand") {
    const candidates = Array.isArray(card.candidates) ? card.candidates as CardPart[] : [];
    const match = candidates.find((part) => typeof part.brand === "string" && canonicalBrand(part.brand, identities) === ours
      && typeof part.manufacturer_id === "number");
    return match ? { action: "ask_brand", manufacturerId: match.manufacturer_id as number } : { action: "brand_mismatch", note: brandsNote(candidates) };
  }
  if (card.status !== "found") return { action: "no_data" };
  const part = (card.current && typeof card.current === "object" ? card.current : card.part) as CardPart | undefined;
  const original = card.part as CardPart | undefined;
  const named = [part, original].filter((item): item is CardPart => Boolean(item) && typeof item === "object");
  if (named.some((item) => typeof item.brand === "string" && canonicalBrand(item.brand, identities) === ours)) return { action: "linked" };
  return { action: "brand_mismatch", note: brandsNote(named) };
}

/** Storefront sections whose goods have no part-number catalogue (fluids, chemistry, tools): never looked up. */
export const UNLINKABLE_SECTIONS: readonly string[] = [
  "motornye-masla", "transmissionnye-masla", "antifriz", "gidravlicheskaya-zhidkost", "avtohimiya", "instrumenty", "tehosmotr", "aksessuary",
];
