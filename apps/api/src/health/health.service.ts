import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { Pool } from "pg";

import type { HealthResponse } from "@an30/contracts";

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
export class HealthService implements OnModuleDestroy {
  private readonly postgres: Pool;
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.postgres = new Pool({
      connectionString: config.getOrThrow<string>("DATABASE_URL"),
      connectionTimeoutMillis: 1_500,
      max: 2,
    });
    this.redis = new Redis(config.getOrThrow<string>("REDIS_URL"), {
      connectTimeout: 1_500,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.redis.on("error", () => undefined);
  }

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
      within(this.postgres.query("SELECT 1"), 2_000),
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

  async onModuleDestroy() {
    await Promise.allSettled([
      this.postgres.end(),
      this.redis.quit(),
    ]);
  }

  private async pingRedis() {
    if (this.redis.status === "wait") await this.redis.connect();
    return this.redis.ping();
  }
}
