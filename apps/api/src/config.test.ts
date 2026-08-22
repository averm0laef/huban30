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

  it("pins bounded local malware and media probe settings", () => {
    const environment = validateEnvironment({
      ...secrets,
      CLAMAV_CONNECT_TIMEOUT_MS: "1750",
      CLAMAV_HOST: "clamav",
      CLAMAV_PORT: "3310",
      CLAMAV_SCAN_TIMEOUT_MS: "45000",
      MEDIA_PROBE_TIMEOUT_MS: "8000",
    });

    expect(environment.CLAMAV_CONNECT_TIMEOUT_MS).toBe(1_750);
    expect(environment.CLAMAV_HOST).toBe("clamav");
    expect(environment.CLAMAV_PORT).toBe(3_310);
    expect(environment.CLAMAV_SCAN_TIMEOUT_MS).toBe(45_000);
    expect(environment.FFMPEG_PATH).toBe("ffmpeg");
    expect(environment.FFPROBE_PATH).toBe("ffprobe");
    expect(environment.MEDIA_PROBE_TIMEOUT_MS).toBe(8_000);

    expect(() => validateEnvironment({ ...secrets, CLAMAV_SCAN_TIMEOUT_MS: "0" })).toThrow();
    expect(() => validateEnvironment({ ...secrets, MEDIA_PROBE_TIMEOUT_MS: "60000" })).toThrow();
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

  it("leaves the Rossko supplier integration off by default without requiring credentials", () => {
    const environment = validateEnvironment({ ...secrets });
    expect(environment.ROSSKO_ENABLED).toBe(false);
    expect(environment.ROSSKO_DELIVERY_ID).toBe("000000001");
    expect(environment.ROSSKO_KEY1).toBeUndefined();
    expect(environment.ROSSKO_KEY2).toBeUndefined();
  });

  it("fails closed when Rossko is enabled without both API keys", () => {
    expect(() => validateEnvironment({ ...secrets, ROSSKO_ENABLED: "true" }))
      .toThrow(/Rossko API credentials are not configured/);
    expect(() => validateEnvironment({ ...secrets, ROSSKO_ENABLED: "true", ROSSKO_KEY1: "key-one" }))
      .toThrow(/Rossko API credentials are not configured/);
  });

  it("enables Rossko once both API keys are present", () => {
    const environment = validateEnvironment({
      ...secrets,
      ROSSKO_ENABLED: "true",
      ROSSKO_KEY1: "key-one",
      ROSSKO_KEY2: "key-two",
    });
    expect(environment.ROSSKO_ENABLED).toBe(true);
    expect(environment.ROSSKO_KEY1).toBe("key-one");
    expect(environment.ROSSKO_KEY2).toBe("key-two");
  });

  it("rejects a delivery id that is not the pinned nine-digit format", () => {
    expect(() => validateEnvironment({ ...secrets, ROSSKO_DELIVERY_ID: "1" })).toThrow();
  });

  it("leaves the Gemini chat assistant off by default without requiring a key", () => {
    const environment = validateEnvironment({ ...secrets });
    expect(environment.AI_ENABLED).toBe(false);
    expect(environment.AI_MODEL).toBe("gemini-2.5-flash");
    expect(environment.GEMINI_API_KEY).toBeUndefined();
  });

  it("fails closed when the AI assistant is enabled without a Gemini API key", () => {
    expect(() => validateEnvironment({ ...secrets, AI_ENABLED: "true" }))
      .toThrow(/Gemini API key is not configured/);
  });

  it("enables the AI assistant once a Gemini API key is present", () => {
    const environment = validateEnvironment({
      ...secrets,
      AI_ENABLED: "true",
      AI_MODEL: "gemini-2.5-pro",
      GEMINI_API_KEY: "test-gemini-key",
    });
    expect(environment.AI_ENABLED).toBe(true);
    expect(environment.AI_MODEL).toBe("gemini-2.5-pro");
    expect(environment.GEMINI_API_KEY).toBe("test-gemini-key");
  });
});
