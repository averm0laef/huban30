import { createServer } from "node:http";

import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { Pool } from "pg";

import { WorkerJobSchema } from "@an30/contracts";

import { ingestArticleCrosses } from "./article-cross-ingest.js";
import { readWorkerConfig } from "./config.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";
import { HubDispatcher } from "./hub-dispatcher.js";
import { createSearchIndexer } from "./search-index/create-search-indexer.js";

const config = readWorkerConfig(process.env);
const logger = pino({ name: "an30-worker", level: process.env.LOG_LEVEL ?? "info" });
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const database = new Pool({ connectionString: config.databaseUrl, max: 2, statement_timeout: 15_000 });
redis.on("error", (error: Error) => logger.error({ error }, "Redis connection error"));

const worker = new Worker(
  "an30-jobs",
  async (job) => {
    const parsed = WorkerJobSchema.parse({ name: job.name, payload: job.data });

    switch (parsed.name) {
      case "system.heartbeat":
        return { processedAt: new Date().toISOString() };
      case "supplier.crosses.ingest":
        return ingestArticleCrosses(database, parsed.payload.pairs, parsed.payload.source);
    }
  },
  { connection: redis, concurrency: 4 },
);
const outbox = new OutboxDispatcher(database, config, logger);
const hub = new HubDispatcher(database, config.dataEncryptionKey, config.deploymentEnvironment, logger);
const hubTimer = setInterval(() => void hub.poll(), 1_000);
hubTimer.unref();
void hub.poll();

worker.on("completed", (job) => logger.info({ jobId: job.id, jobName: job.name }, "Job completed"));
worker.on("failed", (job, error) => logger.error({ error, jobId: job?.id, jobName: job?.name }, "Job failed"));

let contactRetentionRunning = false;
async function anonymizeExpiredContactRequests() {
  if (contactRetentionRunning) return;
  contactRetentionRunning = true;
  try {
    const result = await database.query<{ anonymized_count: number }>(
      "SELECT app.anonymize_expired_contact_requests(500) AS anonymized_count",
    );
    const anonymizedCount = result.rows[0]?.anonymized_count ?? 0;
    if (anonymizedCount > 0) {
      logger.info({ anonymizedCount }, "Expired contact requests anonymized");
    }
  } catch (error) {
    logger.error({ error }, "Contact request retention sweep failed");
  } finally {
    contactRetentionRunning = false;
  }
}

const contactRetentionTimer = setInterval(() => void anonymizeExpiredContactRequests(), 60 * 60 * 1_000);
contactRetentionTimer.unref();
void anonymizeExpiredContactRequests();

let supplierWaitlistRetentionRunning = false;
async function anonymizeExpiredSupplierWaitlistRequests() {
  if (supplierWaitlistRetentionRunning) return;
  supplierWaitlistRetentionRunning = true;
  try {
    const result = await database.query<{ anonymized_count: number }>(
      "SELECT app.anonymize_expired_supplier_waitlist_requests(500) AS anonymized_count",
    );
    const anonymizedCount = result.rows[0]?.anonymized_count ?? 0;
    if (anonymizedCount > 0) {
      logger.info({ anonymizedCount }, "Expired supplier waitlist requests anonymized");
    }
  } catch (error) {
    logger.error({ error }, "Supplier waitlist retention sweep failed");
  } finally {
    supplierWaitlistRetentionRunning = false;
  }
}

const supplierWaitlistRetentionTimer = setInterval(
  () => void anonymizeExpiredSupplierWaitlistRequests(),
  60 * 60 * 1_000,
);
supplierWaitlistRetentionTimer.unref();
void anonymizeExpiredSupplierWaitlistRequests();

// Optional search engine (docs/SEARCH_ENGINE.md); null unless SEARCH_ENGINE=opensearch.
const searchIndexer = createSearchIndexer(database, process.env, logger);
const searchIndexTimer = searchIndexer
  ? setInterval(() => void searchIndexer.drainQueue().catch((error: unknown) => logger.warn({ error }, "Search index drain failed")), 5_000)
  : null;
searchIndexTimer?.unref();

const outboxTimer = setInterval(() => void outbox.poll(), 5_000);
outboxTimer.unref();
void outbox.poll();

const healthServer = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  if (request.url === "/health/live") {
    response.statusCode = 200;
    response.end(JSON.stringify({ status: "ok", service: "worker", timestamp: new Date().toISOString() }));
    return;
  }

  if (request.url === "/health/ready") {
    try {
      await Promise.all([redis.ping(), database.query("SELECT 1")]);
      response.statusCode = worker.isRunning() ? 200 : 503;
      response.end(JSON.stringify({
        status: worker.isRunning() ? "ok" : "degraded",
        service: "worker",
        timestamp: new Date().toISOString(),
        checks: { postgres: "up", redis: "up", queue: worker.isRunning() ? "up" : "down" },
      }));
    } catch {
      response.statusCode = 503;
      response.end(JSON.stringify({
        status: "degraded",
        service: "worker",
        timestamp: new Date().toISOString(),
        checks: { postgres: "down", redis: "down", queue: "down" },
      }));
    }
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not_found" }));
});

healthServer.listen(config.healthPort, "0.0.0.0", () => {
  logger.info({ port: config.healthPort }, "Worker health server listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Worker shutdown started");
  healthServer.close();
  clearInterval(contactRetentionTimer);
  clearInterval(supplierWaitlistRetentionTimer);
  clearInterval(outboxTimer);
  if (searchIndexTimer) clearInterval(searchIndexTimer);
  clearInterval(hubTimer);
  await hub.stop();
  await worker.close();
  await database.end();
  await redis.quit();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}
