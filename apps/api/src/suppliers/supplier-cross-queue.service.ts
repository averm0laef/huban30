import { createHash } from "node:crypto";

import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type JobsOptions } from "bullmq";

import { SupplierCrossPairSchema, type SupplierCrossPair } from "@an30/contracts";

import { RedisService } from "../infrastructure/redis.service.js";

// Same queue apps/worker/src/main.ts already runs a Worker against
// ("an30-jobs") — reusing it means no second Redis-backed queue, no second
// worker process, and job persistence/retry semantics the rest of the
// system already relies on (see WorkerJobSchema in @an30/contracts).
const QUEUE_NAME = "an30-jobs";
export const CROSS_INGEST_JOB_NAME = "supplier.crosses.ingest";
const MAX_PAIRS_PER_JOB = 1_000;
const DEDUPLICATION_TTL_MS = 15 * 60 * 1_000;

export interface CrossIngestJob {
  data: { pairs: SupplierCrossPair[]; source: "rossko" };
  name: typeof CROSS_INGEST_JOB_NAME;
  options: JobsOptions;
}

/**
 * Filters `pairs` down to what WorkerJobSchema will actually accept and
 * shapes the BullMQ job payload, or returns `null` when nothing survives.
 * Pure and DB/Redis-free so it can be unit tested directly — see
 * supplier-cross-queue.service.test.ts. Re-validating here rather than
 * trusting extractCrossPairs's output means one oversized or malformed pair
 * cannot sink an otherwise-good batch: WorkerJobSchema.parse() on the worker
 * side would reject the *whole* job payload if even one entry failed the
 * shared schema.
 */
export function buildCrossIngestJob(pairs: readonly SupplierCrossPair[]): CrossIngestJob | null {
  const valid: SupplierCrossPair[] = [];
  for (const pair of pairs) {
    const parsed = SupplierCrossPairSchema.safeParse(pair);
    if (parsed.success) valid.push(parsed.data);
    if (valid.length >= MAX_PAIRS_PER_JOB) break;
  }
  if (valid.length === 0) return null;
  const deduplicationId = createHash("sha256").update(JSON.stringify(valid)).digest("hex");
  return {
    data: { pairs: valid, source: "rossko" },
    name: CROSS_INGEST_JOB_NAME,
    options: {
      attempts: 3,
      backoff: { delay: 1_000, type: "exponential" },
      // The supplier cache uses the same 15-minute horizon. Replaying the
      // identical cached cross tree for every visitor must not create one
      // Redis job and one database upsert per page view.
      deduplication: { id: deduplicationId, ttl: DEDUPLICATION_TTL_MS },
      // BullMQ otherwise retains every completed/failed job forever. Keep a
      // bounded diagnostic tail without turning Redis into an append-only log.
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
    },
  };
}

@Injectable()
export class SupplierCrossQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SupplierCrossQueueService.name);
  private readonly queue: Queue;

  constructor(redis: RedisService) {
    this.queue = new Queue(QUEUE_NAME, { connection: redis.client });
  }

  /**
   * Fire-and-forget by design: persisting crosses must never slow down or
   * fail a customer's supplier search. SupplierSearchService.search() calls
   * this without awaiting it. Any failure (Redis unreachable, a malformed
   * pair) is logged and swallowed here — the crosses are simply not learned
   * this time. Nothing is lost forever: the same pair normally reappears
   * the next time a customer searches an overlapping part number, and gets
   * enqueued again.
   */
  enqueue(pairs: readonly SupplierCrossPair[]): void {
    const job = buildCrossIngestJob(pairs);
    if (!job) return;
    this.queue.add(job.name, job.data, job.options).catch((error: unknown) => {
      this.logger.warn(`Failed to enqueue ${job.data.pairs.length} supplier cross pair(s): ${String(error)}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
