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

  // Yandex Cloud Postbox, as its documentation gives it: the server, port 587 with STARTTLS, the id of an API key
  // (scope yc.postbox.send) as the user and the key's secret as the password.
  it("takes the settings of Yandex Cloud Postbox and sends under the shop's name", () => {
    const base = {
      DATA_ENCRYPTION_KEY: "local-data-encryption-key-long-enough",
      POSTGRES_PASSWORD: "database-secret",
      REDIS_PASSWORD: "redis-secret",
      SMTP_ENABLED: "true",
      SMTP_FROM: "shop@an30.ru",
      SMTP_HOST: "postbox.cloud.yandex.net",
      SMTP_PASSWORD: "secret-part-of-the-api-key",
      SMTP_USER: "ajeexampleapikeyid00",
    };
    expect(readWorkerConfig(base).notifications.smtp).toEqual({
      enabled: true,
      from: "shop@an30.ru",
      fromName: "АН-30",
      host: "postbox.cloud.yandex.net",
      password: "secret-part-of-the-api-key",
      port: 587,
      secure: false,
      user: "ajeexampleapikeyid00",
    });
    expect(readWorkerConfig({ ...base, SMTP_FROM_NAME: "Магазин АН-30" }).notifications.smtp.fromName).toBe("Магазин АН-30");
  });

  it("refuses a sender's name that could forge a header", () => {
    const base = { DATA_ENCRYPTION_KEY: "local-data-encryption-key-long-enough", POSTGRES_PASSWORD: "database-secret", REDIS_PASSWORD: "redis-secret" };
    expect(() => readWorkerConfig({ ...base, SMTP_FROM_NAME: "АН-30\r\nBcc: someone@example.com" })).toThrow();
    expect(() => readWorkerConfig({ ...base, SMTP_FROM_NAME: "x".repeat(81) })).toThrow();
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
