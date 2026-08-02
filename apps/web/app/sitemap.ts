import type { MetadataRoute } from "next";

import { CatalogProductsResponseSchema } from "@an30/contracts";

import { storeContentPages } from "./(store)/_lib/legacy-pages";
import { absoluteUrl, indexingAllowed } from "./site-config";

export const dynamic = "force-dynamic";
export const revalidate = 3_600;

const PAGE_SIZE = 48;
const MAX_OFFSET = 4_800;

interface ProductEntry {
  slug: string;
  updatedAt: string;
}

function internalApiOrigin(): string {
  return (process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
}

/**
 * Walks the public catalog page by page.
 *
 * A sitemap must never take the site down with it, so any failure degrades to
 * the pages we already know rather than throwing.
 */
async function catalogProducts(): Promise<ProductEntry[]> {
  const entries: ProductEntry[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
    let payload: unknown;
    try {
      const response = await fetch(
        `${internalApiOrigin()}/api/v1/catalog/products?limit=${PAGE_SIZE}&offset=${offset}&sort=newest`,
        { cache: "no-store", headers: { Accept: "application/json" } },
      );
      if (!response.ok) break;
      payload = await response.json();
    } catch {
      break;
    }
    const parsed = CatalogProductsResponseSchema.safeParse(payload);
    if (!parsed.success) break;
    for (const item of parsed.data.items) {
      entries.push({ slug: item.slug, updatedAt: item.updatedAt });
    }
    if (offset + PAGE_SIZE >= parsed.data.total) break;
  }
  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingAllowed()) return [];

  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { changeFrequency: "daily", lastModified: now, priority: 1, url: absoluteUrl("/") },
    { changeFrequency: "daily", lastModified: now, priority: 0.9, url: absoluteUrl("/catalog") },
    { changeFrequency: "monthly", lastModified: now, priority: 0.7, url: absoluteUrl("/contacts") },
    { changeFrequency: "monthly", lastModified: now, priority: 0.6, url: absoluteUrl("/expert-help") },
  ];

  const contentEntries: MetadataRoute.Sitemap = Object.keys(storeContentPages).map((slug) => ({
    changeFrequency: "monthly",
    lastModified: now,
    priority: 0.4,
    url: absoluteUrl(`/${slug}`),
  }));

  const productEntries: MetadataRoute.Sitemap = (await catalogProducts()).map((product) => ({
    changeFrequency: "weekly",
    lastModified: new Date(product.updatedAt),
    priority: 0.8,
    url: absoluteUrl(`/catalog/product/${product.slug}`),
  }));

  return [...staticEntries, ...contentEntries, ...productEntries];
}
