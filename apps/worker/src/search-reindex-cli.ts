// Full rebuild of the optional search engine index (docs/SEARCH_ENGINE.md):
//   corepack pnpm --filter @an30/worker search:reindex
// Builds a new index from PostgreSQL and switches the alias atomically.
import pino from "pino";
import { Pool } from "pg";

import { readWorkerConfig } from "./config.js";
import { createSearchIndexer } from "./search-index/create-search-indexer.js";

const logger = pino({ name: "an30-search-reindex", level: process.env.LOG_LEVEL ?? "info" });
const config = readWorkerConfig(process.env);
const database = new Pool({ connectionString: config.databaseUrl, max: 2, statement_timeout: 60_000 });
try {
  const indexer = createSearchIndexer(database, process.env, logger);
  if (!indexer) {
    logger.error("SEARCH_ENGINE is not opensearch; nothing to reindex");
    process.exitCode = 2;
  } else {
    const result = await indexer.reindexAll();
    logger.info(result, "Search index rebuilt");
  }
} catch (error) {
  logger.error({ error }, "Search reindex failed");
  process.exitCode = 1;
} finally {
  await database.end();
}
