import { describe, expect, it } from "vitest";

import { validateEnvironment } from "./config.js";

const secrets = {
  DATA_ENCRYPTION_KEY: "test-data-encryption-key-with-more-than-32-characters",
  SESSION_SECRET: "test-session-hmac-secret-with-more-than-32-characters",
};

describe("API environment", () => {
  it("fails closed without security keys", () => {
    expect(() => validateEnvironment({ NODE_ENV: "development" })).toThrow(/Session HMAC secret/);
  });

  it("allows debug auth tokens only on localhost", () => {
    expect(() => validateEnvironment({
      ...secrets,
      APP_ORIGIN: "https://an30.ru",
      AUTH_DEBUG_TOKENS: "true",
    })).toThrow(/only for a local HTTP origin/);
  });

  it("normalizes boolean security settings", () => {
    const environment = validateEnvironment({
      ...secrets,
      APP_ORIGIN: "http://localhost:3000",
      AUTH_DEBUG_TOKENS: "true",
      COOKIE_SECURE: "false",
    });

    expect(environment.AUTH_DEBUG_TOKENS).toBe(true);
    expect(environment.COOKIE_SECURE).toBe(false);
  });
});
