import { Injectable } from "@nestjs/common";

import type { HealthResponse } from "@an30/contracts";

import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisService } from "../infrastructure/redis.service.js";

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
      postgres: "down",
      redis: "down",
    };

    const [postgres, redis] = await Promise.allSettled([
      within(this.database.query("SELECT 1"), 2_000),
      within(this.pingRedis(), 2_000),
    ]);
    if (postgres.status === "fulfilled") checks.postgres = "up";
    if (redis.status === "fulfilled") checks.redis = "up";

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
