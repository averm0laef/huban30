import { readFileSync } from "node:fs";

import { z } from "zod";

// Read separately from config.ts: the search engine is optional and off by
// default (SEARCH_ENGINE=postgres), see docs/SEARCH_ENGINE.md.
const SearchIndexEnvironmentSchema = z.object({
  SEARCH_ENGINE: z.enum(["postgres", "opensearch"]).default("postgres"),
  OPENSEARCH_URL: z.string().url().optional(),
  OPENSEARCH_INDEX: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,80}$/u).default("an30-products"),
  OPENSEARCH_USERNAME: z.string().min(1).optional(),
  OPENSEARCH_PASSWORD: z.string().min(1).optional(),
  OPENSEARCH_PASSWORD_FILE: z.string().min(1).optional(),
  SEARCH_INDEX_BATCH_SIZE: z.coerce.number().int().min(10).max(5_000).default(500),
});

export interface SearchIndexConfig {
  /** Alias the API searches; concrete indices are `${alias}-<timestamp>`. */
  alias: string;
  authorization?: string;
  batchSize: number;
  url: string;
}

/** Null while the engine is switched off (the default). */
export function readSearchIndexConfig(raw: NodeJS.ProcessEnv): SearchIndexConfig | null {
  const environment = SearchIndexEnvironmentSchema.parse(Object.fromEntries(
    Object.entries(raw).filter(([key, value]) => (key.startsWith("SEARCH_") || key.startsWith("OPENSEARCH_")) && value !== ""),
  ));
  if (environment.SEARCH_ENGINE !== "opensearch") return null;
  if (!environment.OPENSEARCH_URL) throw new Error("SEARCH_ENGINE=opensearch requires OPENSEARCH_URL");
  const password = environment.OPENSEARCH_PASSWORD
    ?? (environment.OPENSEARCH_PASSWORD_FILE ? readFileSync(environment.OPENSEARCH_PASSWORD_FILE, "utf8").trim() : undefined);
  return {
    alias: environment.OPENSEARCH_INDEX,
    batchSize: environment.SEARCH_INDEX_BATCH_SIZE,
    url: environment.OPENSEARCH_URL.replace(/\/$/u, ""),
    ...(environment.OPENSEARCH_USERNAME && password
      ? { authorization: `Basic ${Buffer.from(`${environment.OPENSEARCH_USERNAME}:${password}`).toString("base64")}` }
      : {}),
  };
}
