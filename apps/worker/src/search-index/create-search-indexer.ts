import type { Logger } from "pino";
import type { Pool } from "pg";

import { FetchSearchEngineHttp } from "./opensearch-http.js";
import { readSearchIndexConfig } from "./search-index-config.js";
import { SearchIndexer } from "./search-indexer.js";

/** The indexer for the configured engine, or null while SEARCH_ENGINE is not opensearch. */
export function createSearchIndexer(database: Pool, environment: NodeJS.ProcessEnv, logger: Logger): SearchIndexer | null {
  const config = readSearchIndexConfig(environment);
  if (!config) return null;
  return new SearchIndexer(
    database as never,
    new FetchSearchEngineHttp(config.url, config.authorization),
    config.alias,
    config.batchSize,
    logger,
  );
}
