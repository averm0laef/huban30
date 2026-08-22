import { Injectable } from "@nestjs/common";

import type { HealthResponse } from "@an30/contracts";

import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import { MalwareScannerService } from "../security/malware-scanner.service.js";

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Health check timeout")));
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly malwareScanner: MalwareScannerService,
  ) {}

  live(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<HealthResponse> {
    const checks: Record<string, "up" | "down"> = {
      clamav: "down",
      postgres: "down",
      redis: "down",
    };

    const [postgres, redis, clamav] = await Promise.allSettled([
      within(this.database.query("SELECT 1"), 2_000),
      within(this.pingRedis(), 2_000),
      within(this.malwareScanner.ping(), 2_500),
    ]);
    if (postgres.status === "fulfilled") checks.postgres = "up";
    if (redis.status === "fulfilled") checks.redis = "up";
    if (clamav.status === "fulfilled") checks.clamav = "up";

    return {
      status: Object.values(checks).every((status) => status === "up") ? "ok" : "degraded",
      service: "api",
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async pingRedis() {
    await this.redis.ensureConnected();
    return this.redis.client.ping();
  }
}
