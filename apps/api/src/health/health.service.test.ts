import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { RedisService } from "../infrastructure/redis.service.js";
import type { MalwareScannerService } from "../security/malware-scanner.service.js";
import { HealthService } from "./health.service.js";

function dependencies(clamavPing: () => Promise<void>) {
  const database = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
  const redis = {
    client: { ping: vi.fn().mockResolvedValue("PONG") },
    ensureConnected: vi.fn().mockResolvedValue(undefined),
  };
  const malwareScanner = { ping: vi.fn(clamavPing) };
  return {
    database,
    malwareScanner,
    redis,
    service: new HealthService(
      database as unknown as DatabaseService,
      redis as unknown as RedisService,
      malwareScanner as unknown as MalwareScannerService,
    ),
  };
}

describe("HealthService readiness", () => {
  it("is ready only when PostgreSQL, Redis, and clamd all answer", async () => {
    const setup = dependencies(async () => undefined);

    await expect(setup.service.ready()).resolves.toMatchObject({
      checks: { clamav: "up", postgres: "up", redis: "up" },
      status: "ok",
    });
    expect(setup.malwareScanner.ping).toHaveBeenCalledOnce();
  });

  it("fails readiness closed while clamd is unavailable", async () => {
    const setup = dependencies(async () => {
      throw new Error("clamd unavailable");
    });

    await expect(setup.service.ready()).resolves.toMatchObject({
      checks: { clamav: "down", postgres: "up", redis: "up" },
      status: "degraded",
    });
  });
});
