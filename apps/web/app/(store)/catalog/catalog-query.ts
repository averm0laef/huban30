import { normalizeCatalogSearchText } from "../_lib/catalog-search-url";

export type CatalogAvailability = "all" | "in_stock" | "out_of_stock";
export type CatalogSort = "name" | "price_asc" | "price_desc" | "relevance";
export type CatalogView = "grid" | "list";

export const CATALOG_PAGE_SIZE = 24;
const MAX_PAGE = 201;
const MAX_PRICE_RUBLES = Math.floor(Number.MAX_SAFE_INTEGER / 100);
const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface CatalogPageQuery {
  availability: CatalogAvailability;
  brands: string[];
  maxPriceRubles: number | null;
  minPriceRubles: number | null;
  page: number;
  priceRangeValid: boolean;
  query: string;
  sort: CatalogSort;
  view: CatalogView;
}

type SearchParameters = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function values(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function boundedInteger(value: string, maximum: number): number | null {
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

export function parseCatalogPageQuery(parameters: SearchParameters): CatalogPageQuery {
  const availabilityValue = first(parameters.availability);
  const sortValue = first(parameters.sort);
  const minPriceRubles = boundedInteger(first(parameters.minPrice), MAX_PRICE_RUBLES);
  const maxPriceRubles = boundedInteger(first(parameters.maxPrice), MAX_PRICE_RUBLES);
  const requestedPage = boundedInteger(first(parameters.page), MAX_PAGE);
  const brands = Array.from(new Set(
    values(parameters.brand)
      .map((brand) => brand.trim().toLowerCase())
      .filter((brand) => brand.length <= 180 && PUBLIC_SLUG.test(brand)),
  )).slice(0, 20);

  return {
    availability: availabilityValue === "in_stock" || availabilityValue === "out_of_stock"
      ? availabilityValue
      : "all",
    brands,
    maxPriceRubles,
    minPriceRubles,
    page: requestedPage && requestedPage > 0 ? requestedPage : 1,
    priceRangeValid: minPriceRubles === null || maxPriceRubles === null
      || minPriceRubles <= maxPriceRubles,
    query: normalizeCatalogSearchText(first(parameters.q)),
    sort: sortValue === "name" || sortValue === "price_asc" || sortValue === "price_desc"
      ? sortValue
      : "relevance",
    view: first(parameters.view) === "list" ? "list" : "grid",
  };
}

export function priceKopeks(rubles: number): number;
export function priceKopeks(rubles: null): undefined;
export function priceKopeks(rubles: number | null): number | undefined {
  return rubles === null ? undefined : rubles * 100;
}

export function hasActiveCatalogFilters(state: CatalogPageQuery): boolean {
  return state.availability !== "all"
    || state.brands.length > 0
    || state.minPriceRubles !== null
    || state.maxPriceRubles !== null;
}

const catalogCountFormat = new Intl.NumberFormat("ru-RU");
const catalogCountPlural = new Intl.PluralRules("ru-RU");

export function catalogProductCount(total: number): string {
  const form = catalogCountPlural.select(total);
  const word = form === "one" ? "товар" : form === "few" ? "товара" : "товаров";
  return `${catalogCountFormat.format(total)} ${word}`;
}

export function catalogPageHref(basePath: string, state: CatalogPageQuery, page = 1): string {
  const parameters = new URLSearchParams();
  if (state.query.length > 0) parameters.set("q", state.query);
  if (state.sort !== "relevance") parameters.set("sort", state.sort);
  if (state.availability !== "all") parameters.set("availability", state.availability);
  for (const brand of state.brands) parameters.append("brand", brand);
  if (state.minPriceRubles !== null) parameters.set("minPrice", String(state.minPriceRubles));
  if (state.maxPriceRubles !== null) parameters.set("maxPrice", String(state.maxPriceRubles));
  if (state.view === "list") parameters.set("view", state.view);
  if (page > 1) parameters.set("page", String(page));
  const query = parameters.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * What a link to another section carries from the page it stands on. While the page has results, the section
 * narrows them: the search text and the filters go along. When nothing was found there is nothing to narrow, and
 * the link leads to the section itself, keeping only how the list is shown — otherwise every section finds
 * nothing either and sends the customer back to the same empty search.
 */
export function sectionLinkState(state: CatalogPageQuery, found: number): CatalogPageQuery {
  if (found > 0) return { ...state, page: 1 };
  return { ...state, brands: [], maxPriceRubles: null, minPriceRubles: null, page: 1, priceRangeValid: true, query: "" };
}

/**
 * The section itself, for a search that found nothing inside it. The customer asked for this section — a click in
 * the list beside the results — so it opens as it is, and the text goes along as what was not found in it.
 */
export function sectionWithoutMatchesHref(path: string, state: CatalogPageQuery): string {
  const href = catalogPageHref(path, sectionLinkState(state, 0));
  return `${href}${href.includes("?") ? "&" : "?"}${new URLSearchParams({ missed: state.query }).toString()}`;
}

/** The search text a section had nothing for (see sectionWithoutMatchesHref): one line of a bounded length. */
export function missedSearchText(parameters: SearchParameters): string {
  return normalizeCatalogSearchText(first(parameters.missed));
}

export function clearCatalogFiltersHref(basePath: string, state: CatalogPageQuery): string {
  return catalogPageHref(basePath, {
    ...state,
    availability: "all",
    brands: [],
    maxPriceRubles: null,
    minPriceRubles: null,
    page: 1,
    priceRangeValid: true,
  });
}
