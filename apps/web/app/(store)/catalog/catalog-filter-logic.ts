import type { CatalogBrand } from "../_lib/catalog-api";

/**
 * Brand list logic for `BrandFacet` / `CatalogFilterRail`, split out as pure
 * functions so it is testable without rendering React — this repo's
 * convention (see `_lib/supplier-results.ts`, `catalog-query.ts`).
 */

/**
 * Brands worth showing in the facet: `brands()` (see
 * `CatalogPublicService.brands` in the API) already drops zero-count rows,
 * but this stays defensive so a future response shape change degrades to
 * "no brand block" rather than an empty, unusable checkbox for a brand with
 * nothing to sell. Selected brands sort first (so a filter a customer just
 * applied never scrolls out of view), then by product count, then by name —
 * matching the owner's rossko.ru reference, where the busiest brands lead.
 */
export function sortBrandsForFacet(brands: CatalogBrand[], selectedSlugs: readonly string[]): CatalogBrand[] {
  const selected = new Set(selectedSlugs);
  return brands
    .filter((brand) => brand.productCount > 0)
    .sort((left, right) => {
      const bySelection = Number(selected.has(right.slug)) - Number(selected.has(left.slug));
      if (bySelection !== 0) return bySelection;
      const byCount = right.productCount - left.productCount;
      if (byCount !== 0) return byCount;
      return left.name.localeCompare(right.name, "ru");
    });
}

/**
 * Case- and whitespace-insensitive substring match against the brand name,
 * for the "Найти бренд" box above a long brand list (rossko.ru's rail has
 * the same box for the same reason: a flat A-Z wall of checkboxes is
 * unusable past a few dozen brands). An empty term matches everything, so
 * callers can run this unconditionally rather than branching on whether the
 * customer has typed anything yet.
 */
export function filterBrandsByTerm(brands: CatalogBrand[], term: string): CatalogBrand[] {
  const folded = term.trim().toLowerCase();
  if (folded.length === 0) return brands;
  return brands.filter((brand) => brand.name.toLowerCase().includes(folded));
}
