import { describe, expect, it } from "vitest";

import { readWorkerConfig } from "./config.js";

describe("worker configuration", () => {
  it("requires both Redis and PostgreSQL credentials in production", () => {
    expect(() => readWorkerConfig({ NODE_ENV: "production" })).toThrow(/Redis credentials/);
    expect(() => readWorkerConfig({
      NODE_ENV: "production",
      REDIS_PASSWORD: "redis-secret",
    })).toThrow(/database credentials/);
  });

  it("builds autonomous Redis and PostgreSQL URLs", () => {
    const config = readWorkerConfig({
      DB_HOST: "postgres",
      DB_NAME: "an30",
      DB_USER: "an30_app",
      POSTGRES_PASSWORD: "database-secret",
      REDIS_HOST: "redis",
      REDIS_PASSWORD: "redis-secret",
    });
    expect(config.databaseUrl).toBe("postgresql://an30_app:database-secret@postgres:5432/an30");
    expect(config.redisUrl).toBe("redis://:redis-secret@redis:6379");
  });
});
