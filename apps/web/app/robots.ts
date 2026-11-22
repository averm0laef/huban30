import type { MetadataRoute } from "next";

import { productSitemapPaths, productSitemapSize } from "./_lib/product-sitemap";
import { PRIVATE_PATHS, absoluteUrl, indexingAllowed } from "./site-config";

export const dynamic = "force-dynamic";

/**
 * Staging and development refuse every crawler outright, so a closed
 * environment can never compete with production in a search index.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!indexingAllowed()) {
    return { rules: [{ disallow: "/", userAgent: "*" }] };
  }
  // The products' parts are listed one by one: Next.js writes no index of a split site map.
  const { partSize, total } = await productSitemapSize();
  return {
    host: absoluteUrl("/").replace(/\/$/u, ""),
    rules: [{ allow: "/", disallow: [...PRIVATE_PATHS], userAgent: "*" }],
    sitemap: [absoluteUrl("/sitemap.xml"), ...productSitemapPaths(total, partSize).map((path) => absoluteUrl(path))],
  };
}
