import type { CatalogProductDetail } from "@an30/contracts";

import { StorefrontApiError } from "../../../_lib/storefront-api-error";

export type ProductLoad =
  | { kind: "busy" }
  | { kind: "found"; product: CatalogProductDetail }
  | { kind: "missing" }
  | { kind: "moved"; slug: string };

/**
 * The product of a page. Too many requests from the visitor's address (several customers behind one address, a
 * burst of prefetched links) is answered with a page asking to wait a few seconds, not with the error page and a 500.
 * A former address of a product renamed in 1С leads to its address of today.
 */
export async function loadProduct(slug: string, find: (slug: string) => Promise<CatalogProductDetail | null>): Promise<ProductLoad> {
  try {
    const product = await find(slug);
    return product ? { kind: "found", product } : { kind: "missing" };
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 429) return { kind: "busy" };
    if (error instanceof StorefrontApiError && error.status === 404 && error.movedTo) return { kind: "moved", slug: error.movedTo };
    throw error;
  }
}
