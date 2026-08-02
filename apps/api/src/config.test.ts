import { describe, expect, it } from "vitest";

import { validateEnvironment } from "./config.js";

const secrets = {
  DATA_ENCRYPTION_KEY: "test-data-encryption-key-with-more-than-32-characters",
  SESSION_SECRET: "test-session-hmac-secret-with-more-than-32-characters",
  SANDBOX_PAYMENT_WEBHOOK_SECRET: "test-sandbox-webhook-secret-with-more-than-32-characters",
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

  it("derives the admin token lookup flag from deployment tier, never from a raw switch", () => {
    const production = validateEnvironment({ ...secrets, DEPLOYMENT_ENVIRONMENT: "production" });
    expect(production.AUTH_ADMIN_TOKEN_LOOKUP).toBe(false);

    const staging = validateEnvironment({ ...secrets, DEPLOYMENT_ENVIRONMENT: "staging" });
    expect(staging.AUTH_ADMIN_TOKEN_LOOKUP).toBe(true);

    const development = validateEnvironment({ ...secrets, DEPLOYMENT_ENVIRONMENT: "development" });
    expect(development.AUTH_ADMIN_TOKEN_LOOKUP).toBe(true);

    // There is deliberately no env var that can flip this back on in production:
    // unknown keys are dropped by the schema, so this must still resolve to false.
    const spoofed = validateEnvironment({
      ...secrets,
      AUTH_ADMIN_TOKEN_LOOKUP: "true",
      DEPLOYMENT_ENVIRONMENT: "production",
    });
    expect(spoofed.AUTH_ADMIN_TOKEN_LOOKUP).toBe(false);
  });

  it("blocks sandbox checkout in production but permits it in staging", () => {
    expect(() => validateEnvironment({
      ...secrets,
      DEPLOYMENT_ENVIRONMENT: "production",
      ENABLE_PUBLIC_CHECKOUT: "true",
      LEGAL_DOCUMENTS_APPROVED: "true",
      PAYMENTS_PROVIDER: "sandbox",
    })).toThrow(/Production public checkout cannot use the sandbox/);

    const staging = validateEnvironment({
      ...secrets,
      DEPLOYMENT_ENVIRONMENT: "staging",
      ENABLE_PUBLIC_CHECKOUT: "true",
      LEGAL_DOCUMENTS_APPROVED: "true",
      PAYMENTS_PROVIDER: "sandbox",
    });
    expect(staging.ENABLE_PUBLIC_CHECKOUT).toBe(true);
    expect(staging.PAYMENTS_PROVIDER).toBe("sandbox");
  });
});
