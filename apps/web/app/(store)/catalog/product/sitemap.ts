import type { MetadataRoute } from "next";

import { internalApiOrigin, productSitemapSize, readSitemapPart, sitemapPartIds } from "../../../_lib/product-sitemap";
import { absoluteUrl, indexingAllowed } from "../../../site-config";

export const dynamic = "force-dynamic";
export const revalidate = 3_600;

/**
 * Every public product, in parts of CATALOG_SITEMAP_PART_SIZE at /catalog/product/sitemap/<part>.xml (robots.txt
 * names each part). The site map used to walk the catalogue's pages and stopped at the API's last page: 4 848 of
 * 42 723 products reached a search engine.
 */
export async function generateSitemaps(): Promise<Array<{ id: string }>> {
  if (!indexingAllowed()) return [{ id: "0" }];
  const { partSize, total } = await productSitemapSize();
  return sitemapPartIds(total, partSize);
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  if (!indexingAllowed()) return [];
  const part = Number(await props.id);
  if (!Number.isInteger(part) || part < 0) return [];
  const { items } = await readSitemapPart(internalApiOrigin(), part);
  return items.map((product) => ({
    changeFrequency: "weekly",
    lastModified: new Date(product.updatedAt),
    priority: 0.8,
    url: absoluteUrl(`/catalog/product/${product.slug}`),
  }));
}
