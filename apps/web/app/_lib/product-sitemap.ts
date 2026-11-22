import { CATALOG_SITEMAP_PART_SIZE, CatalogSitemapResponseSchema, type CatalogSitemapResponse } from "@an30/contracts";

import { timedMemo } from "../(store)/_lib/timed-memo";

const EMPTY: CatalogSitemapResponse = { items: [], partSize: CATALOG_SITEMAP_PART_SIZE, total: 0 };
/** The API takes parts 0–99 (CatalogSitemapQuerySchema). */
const MOST_PARTS = 100;

/** The ids of the parts the catalogue needs; a catalogue not yet imported still has its first, empty part. */
export function sitemapPartIds(total: number, partSize: number): Array<{ id: string }> {
  const parts = Math.min(MOST_PARTS, Math.max(1, Math.ceil(total / partSize)));
  return Array.from({ length: parts }, (_, index) => ({ id: String(index) }));
}

/** The address of every part, for robots.txt: Next.js lists the parts of a site map but writes no index of them. */
export function productSitemapPaths(total: number, partSize: number): string[] {
  return sitemapPartIds(total, partSize).map(({ id }) => `/catalog/product/sitemap/${id}.xml`);
}

/** One part from the API. A site map must never take the site down with it: any failure is an empty part. */
export async function readSitemapPart(apiOrigin: string, part: number, fetchImpl: typeof fetch = fetch): Promise<CatalogSitemapResponse> {
  try {
    const response = await fetchImpl(`${apiOrigin}/api/v1/catalog/sitemap/products?part=${part}`, {
      cache: "no-store", headers: { Accept: "application/json" },
    });
    if (!response.ok) return EMPTY;
    const parsed = CatalogSitemapResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function internalApiOrigin(): string {
  return (process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
}

/**
 * How many public products there are, kept for an hour: robots.txt is read by every crawler, and the number of parts
 * changes only when the catalogue grows past another CATALOG_SITEMAP_PART_SIZE. An answer the API could not give is
 * not kept.
 */
const keptSize = timedMemo(async () => {
  const { partSize, total } = await readSitemapPart(internalApiOrigin(), 0);
  if (total === 0) throw new Error("the catalogue did not answer");
  return { partSize, total };
}, 3_600_000);

export async function productSitemapSize(): Promise<{ partSize: number; total: number }> {
  return keptSize().catch(() => ({ partSize: CATALOG_SITEMAP_PART_SIZE, total: 0 }));
}
