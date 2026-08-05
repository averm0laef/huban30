import { isIP } from "node:net";

import { headers } from "next/headers";
import { cache } from "react";

import {
  CatalogCategoryTreeResponseSchema,
  CatalogProductDetailSchema,
  CatalogProductsResponseSchema,
  type CatalogCategoryNode,
  type CatalogImageView,
  type CatalogProductDetail,
  type CatalogProductSummary,
  type CatalogProductsResponse,
} from "@an30/contracts";

export type CatalogImage = CatalogImageView;
export type CatalogItem = CatalogProductSummary;
export type CatalogProduct = CatalogProductDetail;
export type CatalogSearchResponse = CatalogProductsResponse;
export type { CatalogCategoryNode };

export class StorefrontApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StorefrontApiError";
  }
}

function parseCatalogResponse(value: unknown): CatalogSearchResponse {
  const parsed = CatalogProductsResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Некорректный ответ каталога.");
  return parsed.data;
}

function parseCategoryTree(value: unknown): CatalogCategoryNode[] {
  const parsed = CatalogCategoryTreeResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Некорректный ответ дерева категорий.");
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
    response = await fetch(`${internalApiOrigin()}/api/v1${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json", ...await clientIpHeader() },
    });
  } catch {
    throw new StorefrontApiError("Каталог временно недоступен. Попробуйте ещё раз позже.", 503);
  }
  if (!response.ok) {
    throw new StorefrontApiError(
      response.status === 429
        ? "Слишком много запросов. Подождите минуту и повторите поиск."
        : response.status === 404
          ? "Товар не найден."
          : "Каталог временно недоступен. Попробуйте ещё раз позже.",
      response.status,
    );
  }
  return response.json();
}

export const searchCatalog = cache(async (
  query: string,
  limit = 48,
  availability: "all" | "in_stock" | "out_of_stock" = "all",
  sort: "relevance" | "newest" | "name" | "price_asc" | "price_desc" = "relevance",
  category?: string,
): Promise<CatalogSearchResponse> => {
  const parameters = new URLSearchParams({ availability, limit: String(limit), sort });
  // `q` must be omitted rather than sent empty: the contract requires at
  // least two characters when the key is present at all, which is how a
  // category level browses with no search text (see catalog/[...slug]).
  if (query) parameters.set("q", query);
  if (category) parameters.set("category", category);
  return parseCatalogResponse(await getJson(`/catalog/products?${parameters.toString()}`));
});

/**
 * The full public category tree — cached per request like the rest of this
 * module. Categories only change on a 1C import, and the API layer already
 * caches the assembled tree itself, so this just avoids duplicate fetches
 * within one render.
 */
export const getCategoryTree = cache(async (): Promise<CatalogCategoryNode[]> => (
  parseCategoryTree(await getJson("/catalog/categories/tree"))
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
