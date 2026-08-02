import type { MetadataRoute } from "next";

import { PRIVATE_PATHS, absoluteUrl, indexingAllowed } from "./site-config";

export const dynamic = "force-dynamic";

/**
 * Staging and development refuse every crawler outright, so a closed
 * environment can never compete with production in a search index.
 */
export default function robots(): MetadataRoute.Robots {
  if (!indexingAllowed()) {
    return { rules: [{ disallow: "/", userAgent: "*" }] };
  }
  return {
    host: absoluteUrl("/").replace(/\/$/u, ""),
    rules: [{ allow: "/", disallow: [...PRIVATE_PATHS], userAgent: "*" }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
