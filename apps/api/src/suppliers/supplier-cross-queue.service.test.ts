import { describe, expect, it } from "vitest";

import type { SupplierCrossPair } from "@an30/contracts";

import { buildCrossIngestJob, CROSS_INGEST_JOB_NAME } from "./supplier-cross-queue.service.js";

function pair(article: string, brand: string): SupplierCrossPair {
  return { partA: { article: "W914/2", brand: "MANN" }, partB: { article, brand } };
}

describe("buildCrossIngestJob", () => {
  it("shapes a valid batch into the supplier.crosses.ingest job the worker expects", () => {
    const job = buildCrossIngestJob([pair("OC90", "MAHLE")]);
    expect(job).toMatchObject({
      data: { pairs: [pair("OC90", "MAHLE")], source: "rossko" },
      name: CROSS_INGEST_JOB_NAME,
      options: {
        attempts: 3,
        backoff: { delay: 1_000, type: "exponential" },
        deduplication: { id: expect.stringMatching(/^[a-f0-9]{64}$/u), ttl: 900_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 1_000 },
      },
    });
  });

  it("drops an individually malformed pair without discarding the rest of the batch", () => {
    const good = pair("OC90", "MAHLE");
    const bad: SupplierCrossPair = { partA: { article: "", brand: "MANN" }, partB: { article: "OC90", brand: "MAHLE" } };
    const job = buildCrossIngestJob([bad, good]);
    expect(job?.data.pairs).toEqual([good]);
  });

  it("returns null when there is nothing left to enqueue", () => {
    expect(buildCrossIngestJob([])).toBeNull();
    const bad: SupplierCrossPair = { partA: { article: "", brand: "" }, partB: { article: "OC90", brand: "" } };
    expect(buildCrossIngestJob([bad])).toBeNull();
  });

  it("uses a stable deduplication key for an identical cached supplier batch", () => {
    const first = buildCrossIngestJob([pair("OC90", "MAHLE")]);
    const second = buildCrossIngestJob([pair("OC90", "MAHLE")]);
    expect(first?.options.deduplication?.id).toBe(second?.options.deduplication?.id);
  });

  it("normalises schema transforms and never exceeds the worker contract's 1,000-pair cap", () => {
    const pairs = Array.from({ length: 1_050 }, (_, index) => pair(`  OC${index}  `, "  MAHLE  "));
    const job = buildCrossIngestJob(pairs);
    expect(job?.data.pairs).toHaveLength(1_000);
    expect(job?.data.pairs[0]?.partB).toEqual({ article: "OC0", brand: "MAHLE" });
  });
});
