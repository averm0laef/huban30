import { normalizeArticleNumber, normalizeBrand } from "@an30/contracts";
import type { SupplierPartView, SupplierSearchResponse, SupplierStockView } from "@an30/contracts";

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
export interface SupplierPartFilter {
  brandNames?: string[];
  maxPriceKopeks?: number;
  minPriceKopeks?: number;
  ownAvailable?: Array<{ brand: string | null; sku: string }>;
}

function partIdentity(article: string, brand: string): string {
  return `${normalizeArticleNumber(article)}\u0000${normalizeBrand(brand)}`;
}

function filterStocks(stocks: SupplierStockView[], options: SupplierPartFilter): SupplierStockView[] {
  return stocks.filter((stock) => (
    (options.minPriceKopeks === undefined || stock.priceKopeks >= options.minPriceKopeks)
    && (options.maxPriceKopeks === undefined || stock.priceKopeks <= options.maxPriceKopeks)
  ));
}

export function filterSupplierParts(
  response: SupplierSearchResponse | null,
  options: SupplierPartFilter = {},
): SupplierPartView[] {
  if (!response || !response.success) return [];
  const brands = new Set((options.brandNames ?? []).map(normalizeBrand).filter(Boolean));
  const ownAvailable = new Set((options.ownAvailable ?? [])
    .filter((item) => item.brand)
    .map((item) => partIdentity(item.sku, item.brand ?? "")));
  const acceptsBrand = (brand: string) => brands.size === 0 || brands.has(normalizeBrand(brand));
  return response.parts.flatMap((part): SupplierPartView[] => {
    if (part.availability !== "under_order") return [];

    const directDuplicate = ownAvailable.has(partIdentity(part.partNumber, part.brand));
    const stocks = acceptsBrand(part.brand) && !directDuplicate
      ? filterStocks(part.stocks, options)
      : [];
    const crosses = part.crosses.flatMap((cross) => {
      if (!acceptsBrand(cross.brand)) return [];
      if (ownAvailable.has(partIdentity(cross.partNumber, cross.brand))) return [];
      const crossStocks = filterStocks(cross.stocks, options);
      if (crossStocks.length === 0) return [];
      return [{ ...cross, stocks: crossStocks }];
    });

    // An identity without any offer is not actionable. It used to render an
    // empty row saying "Предложений пока нет", which looked like a result but
    // gave the customer nothing to buy or wait for.
    if (stocks.length === 0 && crosses.length === 0) return [];
    return [{ ...part, crosses, stocks }];
  });
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
