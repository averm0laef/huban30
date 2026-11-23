import { normalizeArticleNumber, normalizeBrand, type SupplierCrossPair } from "@an30/contracts";

import type { SupplierPart } from "../adapters/provider-contracts.js";
import { extractCrossPairs } from "./supplier-cross-pairs.js";

/** alias (app.normalize_brand form) -> canonical brand, from app.brand_identities. */
export type BrandIdentities = ReadonlyMap<string, string>;

export type SupplierLookupStatus = "brand_mismatch" | "found" | "no_crosses" | "not_found";

export interface SupplierLookupDecision {
  /** Brands the supplier lists the number under, when ours is not among them. */
  readonly note: string | null;
  readonly pairs: SupplierCrossPair[];
  readonly status: SupplierLookupStatus;
}

function canonicalBrand(brand: string, identities: BrandIdentities): string {
  const key = normalizeBrand(brand);
  return identities.get(key) ?? key;
}

/**
 * What the supplier's answer for one of our products allows the shop to
 * store. A text search returns every part the supplier matched, of any
 * brand and sometimes by name: only a part with exactly our number under
 * our brand («MANN» in 1С = «MANN-FILTER» at the supplier, by
 * app.brand_identities) is our product. A number alone is never an identity
 * (docs/CATALOG_MATCHING.md), so the analogs of a same-numbered part of
 * another brand are not stored against ours.
 */
export function decideSupplierLookup(
  parts: readonly SupplierPart[],
  product: { brand: string; sku: string },
  identities: BrandIdentities,
): SupplierLookupDecision {
  const article = normalizeArticleNumber(product.sku);
  const sameNumber = parts.filter((part) => normalizeArticleNumber(part.partNumber) === article);
  if (sameNumber.length === 0) return { note: null, pairs: [], status: "not_found" };
  const ours = canonicalBrand(product.brand, identities);
  const own = sameNumber.filter((part) => part.brand.trim() !== "" && canonicalBrand(part.brand, identities) === ours);
  if (own.length === 0) {
    const brands = [...new Set(sameNumber.map((part) => part.brand.trim()).filter(Boolean))];
    return { note: brands.slice(0, 8).join(", ").slice(0, 200) || null, pairs: [], status: "brand_mismatch" };
  }
  const pairs = extractCrossPairs(own);
  return { note: null, pairs, status: pairs.length > 0 ? "found" : "no_crosses" };
}
