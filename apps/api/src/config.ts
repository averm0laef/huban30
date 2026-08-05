import { readFileSync } from "node:fs";

import { z } from "zod";

const RawEnvironmentSchema = z.object({
  // Gemini-backed chat assistant (AN30-011). Disabled by default: ADR-004
  // requires the shop and chat to work fully with every external
  // integration off, and ADR-016 requires catalog search ranking to stay
  // deterministic whether or not this is on.
  AI_ENABLED: z.enum(["true", "false"]).default("false"),
  AI_MODEL: z.string().min(1).max(100).default("gemini-2.5-flash"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY_FILE: z.string().min(1).optional(),
  AUTH_DEBUG_TOKENS: z.enum(["true", "false"]).default("false"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY_FILE: z.string().min(1).optional(),
  DEPLOYMENT_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
  ENABLE_PUBLIC_CHECKOUT: z.enum(["true", "false"]).default("false"),
  LEGAL_DOCUMENTS_APPROVED: z.enum(["true", "false"]).default("false"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_NAME: z.string().min(1).default("an30"),
  DB_USER: z.string().min(1).default("an30"),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_PASSWORD_FILE: z.string().min(1).optional(),
  PAYMENTS_PROVIDER: z.enum(["disabled", "sandbox"]).default("disabled"),
  REDIS_URL: z.string().url().optional(),
  REDIS_HOST: z.string().min(1).default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_PASSWORD: z.string().min(1).optional(),
  REDIS_PASSWORD_FILE: z.string().min(1).optional(),
  RESERVATION_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(20),
  // Rossko supplier integration (AN30-013). Disabled by default: ADR-004
  // requires the shop to work fully with every external integration off.
  ROSSKO_ENABLED: z.enum(["true", "false"]).default("false"),
  ROSSKO_KEY1: z.string().min(1).optional(),
  ROSSKO_KEY1_FILE: z.string().min(1).optional(),
  ROSSKO_KEY2: z.string().min(1).optional(),
  ROSSKO_KEY2_FILE: z.string().min(1).optional(),
  // Verified live delivery ids: 000000001 Самовывоз, 000000002 Курьерская
  // доставка, 000000012 Отправка через Автобус. GetSearch rejects any other
  // value with success=false, so the format is pinned rather than left free text.
  ROSSKO_DELIVERY_ID: z.string().regex(/^\d{9}$/u).default("000000001"),
  // Retail margin applied to every supplier price before it is shown or
  // recorded. The shop buys at the distributor's price and sells at its own,
  // so the markup belongs on the server: a browser must never be able to
  // influence what a part costs. Expressed in percent.
  SUPPLIER_MARKUP_PERCENT: z.coerce.number().min(0).max(500).default(30),
  STORAGE_ROOT: z.string().min(1).default("/data/uploads"),
  SANDBOX_PAYMENT_WEBHOOK_SECRET: z.string().min(32).optional(),
  SANDBOX_PAYMENT_WEBHOOK_SECRET_FILE: z.string().min(1).optional(),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_SECRET_FILE: z.string().min(1).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
});

function readSecret(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return readFileSync(path, "utf8").trim();
}

export function validateEnvironment(raw: Record<string, unknown>) {
  const environment = RawEnvironmentSchema.parse(raw);
  const databasePassword = environment.POSTGRES_PASSWORD
    ?? readSecret(environment.POSTGRES_PASSWORD_FILE);
  const redisPassword = environment.REDIS_PASSWORD
    ?? readSecret(environment.REDIS_PASSWORD_FILE);
  const sessionSecret = environment.SESSION_SECRET
    ?? readSecret(environment.SESSION_SECRET_FILE);
  const dataEncryptionKey = environment.DATA_ENCRYPTION_KEY
    ?? readSecret(environment.DATA_ENCRYPTION_KEY_FILE);
  const sandboxPaymentWebhookSecret = environment.SANDBOX_PAYMENT_WEBHOOK_SECRET
    ?? readSecret(environment.SANDBOX_PAYMENT_WEBHOOK_SECRET_FILE);
  const rosskoKey1 = environment.ROSSKO_KEY1 ?? readSecret(environment.ROSSKO_KEY1_FILE);
  const rosskoKey2 = environment.ROSSKO_KEY2 ?? readSecret(environment.ROSSKO_KEY2_FILE);
  const geminiApiKey = environment.GEMINI_API_KEY ?? readSecret(environment.GEMINI_API_KEY_FILE);

  if (environment.NODE_ENV === "production" && !environment.DATABASE_URL && !databasePassword) {
    throw new Error("Production database credentials are not configured");
  }
  if (environment.NODE_ENV === "production" && !environment.REDIS_URL && !redisPassword) {
    throw new Error("Production Redis credentials are not configured");
  }
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("Session HMAC secret must contain at least 32 characters");
  }
  if (!dataEncryptionKey || dataEncryptionKey.length < 32) {
    throw new Error("Data encryption key must contain at least 32 characters");
  }
  if (environment.PAYMENTS_PROVIDER === "sandbox"
    && (!sandboxPaymentWebhookSecret || sandboxPaymentWebhookSecret.length < 32)) {
    throw new Error("Sandbox payment webhook secret must contain at least 32 characters");
  }
  if (environment.ROSSKO_ENABLED === "true" && (!rosskoKey1 || !rosskoKey2)) {
    throw new Error("Rossko API credentials are not configured");
  }
  if (environment.AI_ENABLED === "true" && !geminiApiKey) {
    throw new Error("Gemini API key is not configured");
  }
  if (environment.ENABLE_PUBLIC_CHECKOUT === "true" && environment.PAYMENTS_PROVIDER === "disabled") {
    throw new Error("Public checkout requires a configured payment provider");
  }
  if (
    environment.DEPLOYMENT_ENVIRONMENT === "production"
    && environment.ENABLE_PUBLIC_CHECKOUT === "true"
    && environment.PAYMENTS_PROVIDER === "sandbox"
  ) {
    throw new Error("Production public checkout cannot use the sandbox payment provider");
  }
  if (environment.ENABLE_PUBLIC_CHECKOUT === "true" && environment.LEGAL_DOCUMENTS_APPROVED !== "true") {
    throw new Error("Public checkout requires approved legal documents");
  }
  if (!environment.STORAGE_ROOT.startsWith("/")) {
    throw new Error("Storage root must be an absolute path");
  }
  if (
    environment.AUTH_DEBUG_TOKENS === "true"
    && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(environment.APP_ORIGIN)
  ) {
    throw new Error("Auth debug tokens are allowed only for a local HTTP origin");
  }

  const databaseUrl = environment.DATABASE_URL ?? [
    `postgresql://${encodeURIComponent(environment.DB_USER)}`,
    `:${encodeURIComponent(databasePassword ?? "an30_dev")}`,
    `@${environment.DB_HOST}:${environment.DB_PORT}/${environment.DB_NAME}`,
  ].join("");

  const redisUrl = environment.REDIS_URL ?? [
    "redis://",
    redisPassword ? `:${encodeURIComponent(redisPassword)}@` : "",
    `${environment.REDIS_HOST}:${environment.REDIS_PORT}`,
  ].join("");

  // Support tool that lets an authenticated admin read back a pending
  // verification/reset/staff-invitation link when transactional email is not
  // configured (see AuthService.adminPendingToken). Unlike AUTH_DEBUG_TOKENS
  // this has no raw env toggle of its own on purpose: it is derived entirely
  // from DEPLOYMENT_ENVIRONMENT, which main.ts additionally cross-checks
  // against the database's own deployment_settings row on every boot, so
  // there is no configuration that can turn it on for a production
  // deployment. It still requires the caller to hold the admin-only
  // `auth:tokens:read` permission behind a fully authenticated, TOTP-verified
  // session — this flag only narrows *when*, RBAC narrows *who*.
  const authAdminTokenLookup = environment.DEPLOYMENT_ENVIRONMENT !== "production";

  return {
    ...environment,
    AI_ENABLED: environment.AI_ENABLED === "true",
    AUTH_ADMIN_TOKEN_LOOKUP: authAdminTokenLookup,
    AUTH_DEBUG_TOKENS: environment.AUTH_DEBUG_TOKENS === "true",
    COOKIE_SECURE: environment.COOKIE_SECURE === "true",
    DATA_ENCRYPTION_KEY: dataEncryptionKey,
    GEMINI_API_KEY: geminiApiKey,
    DATABASE_URL: databaseUrl,
    ENABLE_PUBLIC_CHECKOUT: environment.ENABLE_PUBLIC_CHECKOUT === "true",
    LEGAL_DOCUMENTS_APPROVED: environment.LEGAL_DOCUMENTS_APPROVED === "true",
    REDIS_URL: redisUrl,
    ROSSKO_ENABLED: environment.ROSSKO_ENABLED === "true",
    ROSSKO_KEY1: rosskoKey1,
    ROSSKO_KEY2: rosskoKey2,
    SANDBOX_PAYMENT_WEBHOOK_SECRET: sandboxPaymentWebhookSecret,
    SESSION_SECRET: sessionSecret,
  };
}
