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
      DATA_ENCRYPTION_KEY: "local-data-encryption-key-long-enough",
      POSTGRES_PASSWORD: "database-secret",
      REDIS_HOST: "redis",
      REDIS_PASSWORD: "redis-secret",
    });
    expect(config.databaseUrl).toBe("postgresql://an30_app:database-secret@postgres:5432/an30");
    expect(config.redisUrl).toBe("redis://:redis-secret@redis:6379");
  });

  it("fails closed when an optional notification adapter lacks credentials", () => {
    const base = {
      DATA_ENCRYPTION_KEY: "local-data-encryption-key-long-enough",
      POSTGRES_PASSWORD: "database-secret",
      REDIS_PASSWORD: "redis-secret",
    };
    expect(() => readWorkerConfig({ ...base, SMTP_ENABLED: "true" })).toThrow(/SMTP_HOST/);
    expect(() => readWorkerConfig({ ...base, TELEGRAM_ENABLED: "true" })).toThrow(/bot token/);
    expect(() => readWorkerConfig({ ...base, VK_ENABLED: "true" })).toThrow(/access token/);
  });
});
