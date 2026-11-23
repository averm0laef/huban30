import { CATALOG_PAGE_SIZES, CATALOG_VEHICLE_KINDS, type CatalogVehicleKind } from "@an30/contracts";

import { normalizeCatalogSearchText } from "../_lib/catalog-search-url";

export type CatalogAvailability = "all" | "in_stock" | "out_of_stock";
export type CatalogSort = "name" | "popular" | "price_asc" | "price_desc" | "relevance";
export type CatalogView = "grid" | "list";

/** How many products a list opens with; the customer may choose a longer page (CATALOG_PAGE_SIZES, `perPage`). */
export const CATALOG_PAGE_SIZE = CATALOG_PAGE_SIZES[0];
/** The catalogue API gives the first items of a list up to this offset: a page that starts past it cannot be opened. */
const MAX_OFFSET = 4_800;
/** The last page a list of the usual page size can be opened at (offset ≤ 4 800). */
export const CATALOG_LAST_PAGE = catalogLastPage(CATALOG_PAGE_SIZE);
const MAX_PAGE = CATALOG_LAST_PAGE;

/** The last page that can be opened when a page holds `pageSize` products: 201 by 24, 101 by 48, 51 by 96. */
export function catalogLastPage(pageSize: number): number {
  return Math.floor(MAX_OFFSET / pageSize) + 1;
}
const MAX_PRICE_RUBLES = Math.floor(Number.MAX_SAFE_INTEGER / 100);
const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface CatalogPageQuery {
  availability: CatalogAvailability;
  brands: string[];
  maxPriceRubles: number | null;
  minPriceRubles: number | null;
  page: number;
  /** Products on a page: one of CATALOG_PAGE_SIZES. */
  pageSize: number;
  priceRangeValid: boolean;
  query: string;
  sort: CatalogSort;
  /** Passenger cars, trucks or tractors and machinery (`kind` in the address); null — every product. */
  vehicleKind: CatalogVehicleKind | null;
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
  const requestedPageSize = boundedInteger(first(parameters.perPage), CATALOG_PAGE_SIZES.at(-1)!);
  const pageSize = CATALOG_PAGE_SIZES.find((size) => size === requestedPageSize) ?? CATALOG_PAGE_SIZE;
  const requestedPage = boundedInteger(first(parameters.page), MAX_PAGE);
  const kindValue = first(parameters.kind);
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
    // A page past the last one of a longer page size opens that last one, not an error.
    page: requestedPage && requestedPage > 0 ? Math.min(requestedPage, catalogLastPage(pageSize)) : 1,
    pageSize,
    priceRangeValid: minPriceRubles === null || maxPriceRubles === null
      || minPriceRubles <= maxPriceRubles,
    query: normalizeCatalogSearchText(first(parameters.q)),
    sort: sortValue === "name" || sortValue === "popular" || sortValue === "price_asc" || sortValue === "price_desc"
      ? sortValue
      : "relevance",
    vehicleKind: CATALOG_VEHICLE_KINDS.find((kind) => kind === kindValue) ?? null,
    view: first(parameters.view) === "list" ? "list" : "grid",
  };
}

export function priceKopeks(rubles: number): number;
export function priceKopeks(rubles: null): undefined;
export function priceKopeks(rubles: number | null): number | undefined {
  return rubles === null ? undefined : rubles * 100;
}

/**
 * The page numbers under a list: every page of a short list; of a long one the first, the last, the current page
 * with its neighbours, and `null` where pages are left out. Never more than seven places, so it fits a phone, and
 * a gap never hides a single page.
 */
export function catalogPageNumbers(current: number, last: number): Array<number | null> {
  const page = Math.min(Math.max(1, current), Math.max(1, last));
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_unused, index) => from + index);
  if (last <= 7) return range(1, Math.max(1, last));
  if (page <= 4) return [...range(1, Math.max(4, page + 1)), null, last];
  if (page >= last - 3) return [1, null, ...range(Math.min(last - 3, page - 1), last)];
  return [1, null, page - 1, page, page + 1, null, last];
}

export function hasActiveCatalogFilters(state: CatalogPageQuery): boolean {
  return state.availability !== "all"
    || state.vehicleKind !== null
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
  if (state.vehicleKind !== null) parameters.set("kind", state.vehicleKind);
  if (state.view === "list") parameters.set("view", state.view);
  if (state.pageSize !== CATALOG_PAGE_SIZE) parameters.set("perPage", String(state.pageSize));
  if (page > 1) parameters.set("page", String(page));
  const query = parameters.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * What a link to a section carries from the page it stands on: only how the list is shown (the order, «в наличии»,
 * the view, the page size, the kind of vehicle). The search text, the brand and the price stay behind — a link to a section opens the section. Carried
 * along, the text made every section «find nothing for …» for a customer who had searched and then went to look
 * through the sections, and a brand of one section is not a brand of another.
 */
export function sectionLinkState(state: CatalogPageQuery): CatalogPageQuery {
  return { ...state, brands: [], maxPriceRubles: null, minPriceRubles: null, page: 1, priceRangeValid: true, query: "" };
}

/**
 * What a catalogue page says when the catalogue did not answer, by the status it answered with. «Too many requests
 * from your address» passes in a minute and is said as such; anything else is the catalogue being unavailable.
 */
export function catalogFailureText(status: number | null): { heading: string; message: string } {
  return status === 429
    ? { heading: "Слишком много запросов", message: "С вашего адреса пришло слишком много запросов подряд. Подождите минуту и обновите страницу." }
    : { heading: "Каталог не отвечает", message: "Каталог временно недоступен. Попробуйте ещё раз позже." };
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
    vehicleKind: null,
  });
}
