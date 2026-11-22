import { isIP } from "node:net";

import { headers } from "next/headers";
import { cache } from "react";

import {
  CatalogBrandsResponseSchema,
  CatalogCategoryTreeResponseSchema,
  CatalogProductDetailSchema,
  CatalogProductSummarySchema,
  CatalogProductsResponseSchema,
  type CatalogBrandView,
  type CatalogCategoryNode,
  type CatalogImageView,
  type CatalogProductDetail,
  type CatalogProductSummary,
  type CatalogProductsResponse,
} from "@an30/contracts";

import { fetchWithOneRetry } from "./api-fetch";
import { publicSectionName } from "./store-categories";
import { StorefrontApiError } from "./storefront-api-error";
import { timedMemo } from "./timed-memo";

export type CatalogImage = CatalogImageView;
export type CatalogItem = CatalogProductSummary;
export type CatalogProduct = CatalogProductDetail;
export type CatalogSearchResponse = CatalogProductsResponse;
export type CatalogBrand = CatalogBrandView;
export type { CatalogCategoryNode };

export { StorefrontApiError };

function parseCatalogResponse(value: unknown): CatalogSearchResponse {
  const parsed = CatalogProductsResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Некорректный ответ каталога.");
  return parsed.data;
}

/** The tree as a customer reads it: the staff's queue «Без категории» is «Другие товары» everywhere on the storefront. */
function withPublicNames(nodes: CatalogCategoryNode[]): CatalogCategoryNode[] {
  return nodes.map((node) => ({ ...node, children: withPublicNames(node.children), name: publicSectionName(node) }));
}

function parseCategoryTree(value: unknown): CatalogCategoryNode[] {
  const parsed = CatalogCategoryTreeResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Некорректный ответ дерева категорий.");
  return withPublicNames(parsed.data.items);
}

function parseCatalogBrands(value: unknown): CatalogBrand[] {
  const parsed = CatalogBrandsResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Некорректный ответ списка брендов.");
  return parsed.data.items;
}

function parseProduct(value: unknown): CatalogProduct {
  const parsed = CatalogProductDetailSchema.safeParse(value);
  if (!parsed.success) throw new Error("Некорректный ответ карточки товара.");
  return parsed.data;
}

function internalApiOrigin(): string {
  return (process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
}

async function clientIpHeader(): Promise<Record<string, string>> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",").at(-1)?.trim()
    ?? requestHeaders.get("x-real-ip")?.trim();
  return forwarded && isIP(forwarded) ? { "X-Forwarded-For": forwarded } : {};
}

async function getJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithOneRetry(`${internalApiOrigin()}/api/v1${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json", ...await clientIpHeader() },
    });
  } catch {
    throw new StorefrontApiError("Каталог временно недоступен. Попробуйте ещё раз позже.", 503);
  }
  if (!response.ok) {
    throw new StorefrontApiError(
      response.status === 429
        ? "Слишком много запросов. Подождите минуту и обновите страницу."
        : response.status === 404
          ? "Товар не найден."
          : "Каталог временно недоступен. Попробуйте ещё раз позже.",
      response.status,
    );
  }
  return response.json();
}

export interface CatalogSearchOptions {
  availability?: "all" | "in_stock" | "out_of_stock";
  brands?: string[];
  category?: string;
  limit?: number;
  maxPriceKopeks?: number;
  minPriceKopeks?: number;
  offset?: number;
  query?: string;
  sort?: "relevance" | "newest" | "name" | "price_asc" | "price_desc";
}

export const searchCatalog = cache(async (
  options: CatalogSearchOptions,
): Promise<CatalogSearchResponse> => {
  const parameters = new URLSearchParams({
    availability: options.availability ?? "all",
    limit: String(options.limit ?? 48),
    offset: String(options.offset ?? 0),
    sort: options.sort ?? "relevance",
  });
  // `q` must be omitted rather than sent empty: the contract requires at
  // least two characters when the key is present at all, which is how a
  // category level browses with no search text (see catalog/[...slug]).
  if (options.query) parameters.set("q", options.query);
  if (options.category) parameters.set("category", options.category);
  for (const brand of options.brands ?? []) parameters.append("brand", brand);
  if (options.minPriceKopeks !== undefined) {
    parameters.set("minPriceKopeks", String(options.minPriceKopeks));
  }
  if (options.maxPriceKopeks !== undefined) {
    parameters.set("maxPriceKopeks", String(options.maxPriceKopeks));
  }
  return parseCatalogResponse(await getJson(`/catalog/products?${parameters.toString()}`));
});

/** How long the storefront answers with the category tree it already has before asking the API again. */
const CATEGORY_TREE_TTL_MS = 30_000;

/**
 * The full public category tree. It is the same for every visitor and changes only on a 1С exchange, so this
 * process keeps it for half a minute. Every link to a section that Next.js prefetches runs that page's
 * generateMetadata, which reads the tree: one visitor who opened the home page, the catalogue menu and /catalog
 * used to spend 63 requests on it in a minute against the API's limit of 60 per visitor, and the catalogue then
 * answered «слишком много запросов». After an exchange new sections show up within that half minute.
 */
export const getCategoryTree = timedMemo(async (): Promise<CatalogCategoryNode[]> => (
  parseCategoryTree(await getJson("/catalog/categories/tree"))
), CATEGORY_TREE_TTL_MS);

export const getAvailableShowcase = cache(async (): Promise<CatalogItem[]> => {
  const result = await getJson("/catalog/featured?limit=4");
  if (!result || typeof result !== "object" || !("items" in result)) return [];
  return CatalogProductSummarySchema.array().max(4).parse(result.items);
});

/** Brands for the filter rail; scoped to a section when its slug is given. */
export const getCatalogBrands = cache(async (categorySlug?: string): Promise<CatalogBrand[]> => (
  parseCatalogBrands(await getJson(categorySlug
    ? `/catalog/brands?category=${encodeURIComponent(categorySlug)}`
    : "/catalog/brands"))
));

export const findCatalogItem = cache(async (slug: string): Promise<CatalogProduct | null> => {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized) || normalized.length > 180) return null;
  try {
    return parseProduct(await getJson(`/catalog/products/${encodeURIComponent(normalized)}`));
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) return null;
    throw error;
  }
});

export { formatRubles } from "./catalog-format";
