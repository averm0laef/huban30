import type { SupplierPartView, SupplierSearchResponse } from "@an30/contracts";

import type { CatalogItem } from "./catalog-api";

/**
 * Filters a supplier search response down to parts the storefront is allowed
 * to show. `null` (not fetched yet) and `success: false` (supplier disabled,
 * temporarily unreachable, or an empty normalised query) both collapse to no
 * rows — a failed or pending supplier call must never be rendered as "found
 * nothing", only as its own honest loading/error state (see
 * `catalog/supplier-results.tsx`).
 *
 * The `availability === "under_order"` filter is a second, defence-in-depth
 * check on top of the contract's own `z.literal("under_order")`: even if a
 * future response shape slipped a differently-tagged row past the schema,
 * this is the one place that decides what counts as a legitimate supplier
 * row, and it refuses anything not explicitly tagged "под заказ". This is
 * the project's hard rule — a supplier listing must never be presentable as
 * shelf stock — enforced in code, not just by convention.
 */
export function filterSupplierParts(response: SupplierSearchResponse | null): SupplierPartView[] {
  if (!response || !response.success) return [];
  return response.parts.filter((part) => part.availability === "under_order");
}

/**
 * The two-source view a search results page renders from: the shop's own 1C
 * stock and the supplier's under-order offer, kept as two distinct arrays on
 * two distinct keys. They are never concatenated into one `items` list —
 * that separation is intentional and load-bearing (see the file-header
 * comment on `filterSupplierParts`), so callers that need "is there anything
 * at all" must check both fields rather than expect a merged list.
 */
export interface TwoSourceCatalogView {
  own: CatalogItem[];
  supplier: SupplierPartView[];
}

export function composeTwoSourceCatalog(
  own: CatalogItem[],
  supplierResponse: SupplierSearchResponse | null,
): TwoSourceCatalogView {
  return { own, supplier: filterSupplierParts(supplierResponse) };
}
