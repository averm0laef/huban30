import { createServer } from "node:http";

import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { Pool } from "pg";

import { WorkerJobSchema } from "@an30/contracts";

import { readWorkerConfig } from "./config.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";

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
    }
  },
  { connection: redis, concurrency: 4 },
);
const outbox = new OutboxDispatcher(database, config, logger);

worker.on("completed", (job) => logger.info({ jobId: job.id, jobName: job.name }, "Job completed"));
worker.on("failed", (job, error) => logger.error({ error, jobId: job?.id, jobName: job?.name }, "Job failed"));

let expiryRunning = false;
async function releaseExpiredReservations() {
  if (expiryRunning) return;
  expiryRunning = true;
  try {
    const result = await database.query<{ expired_count: number }>(
      "SELECT app.expire_stock_reservations(100) AS expired_count",
    );
    const expiredCount = result.rows[0]?.expired_count ?? 0;
    if (expiredCount > 0) logger.info({ expiredCount }, "Expired stock reservations released");
  } catch (error) {
    logger.error({ error }, "Reservation expiry sweep failed");
  } finally {
    expiryRunning = false;
  }
}

const expiryTimer = setInterval(() => void releaseExpiredReservations(), 30_000);
expiryTimer.unref();
void releaseExpiredReservations();

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
  clearInterval(expiryTimer);
  clearInterval(outboxTimer);
  await worker.close();
  await database.end();
  await redis.quit();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}
