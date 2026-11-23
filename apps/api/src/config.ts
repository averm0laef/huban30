import { readFileSync } from "node:fs";

import { z } from "zod";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const RawEnvironmentSchema = z.object({
  API_BIND_HOST: z.string().trim().min(1).max(253).default("127.0.0.1"),
  REEFAPI_ENABLED: z.enum(["true", "false"]).default("false"),
  REEFAPI_KEY: z.string().min(10).optional(),
  REEFAPI_KEY_FILE: z.string().min(1).optional(),
  REEFAPI_MARKET: z.enum(["uk", "de", "es"]).default("de"),
  REEFAPI_DAILY_CREDITS: z.coerce.number().int().min(3).max(1_000).default(30),
  // Gemini-backed chat assistant (AN30-011). Disabled by default: ADR-004
  // requires the shop and chat to work fully with every external
  // integration off, and ADR-016 requires catalog search ranking to stay
  // deterministic whether or not this is on.
  AI_ENABLED: z.enum(["true", "false"]).default("false"),
  AI_MODEL: z.string().min(1).max(100).default("gemini-2.5-flash"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY_FILE: z.string().min(1).optional(),
  AUTH_DEBUG_TOKENS: z.enum(["true", "false"]).default("false"),
  CLAMAV_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(2_000),
  CLAMAV_HOST: z.string().min(1).max(253).default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY_FILE: z.string().min(1).optional(),
  DEPLOYMENT_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
  ENABLE_PUBLIC_CHECKOUT: z.enum(["true", "false"]).default("false"),
  LEGAL_DOCUMENTS_APPROVED: z.enum(["true", "false"]).default("false"),
  YANDEX_ID_CLIENT_ID: z.string().trim().regex(/^(?:[a-zA-Z0-9_-]{8,128})?$/u).optional(),
  VK_ID_CLIENT_ID: z.string().trim().regex(/^(?:[0-9]{1,16})?$/u).optional(),
  FFMPEG_PATH: z.string().min(1).max(1_024).default("ffmpeg"),
  FFPROBE_PATH: z.string().min(1).max(1_024).default("ffprobe"),
  MEDIA_PROBE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
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
  REDIS_URL: z.string().url().optional(),
  REDIS_HOST: z.string().min(1).default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_PASSWORD: z.string().min(1).optional(),
  REDIS_PASSWORD_FILE: z.string().min(1).optional(),
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
  // Rossko allows 100 000 calls a day (reset at 00:00 MSK) and 300 a minute.
  // The shop stops itself earlier: every live call, a customer's or its own,
  // is counted against ROSSKO_DAILY_LIMIT. Checking our own assortment at
  // night (off until staff switch it on) may spend
  // ROSSKO_CROSS_FILL_DAILY_LIMIT of that a day; 0 forbids it outright.
  ROSSKO_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(90_000),
  ROSSKO_CROSS_FILL_DAILY_LIMIT: z.coerce.number().int().min(0).max(50_000).default(4_000),
  // Retail margin applied to every supplier price before it is shown or
  // recorded. The shop buys at the distributor's price and sells at its own,
  // so the markup belongs on the server: a browser must never be able to
  // influence what a part costs. Expressed in percent.
  SUPPLIER_MARKUP_PERCENT: z.coerce.number().min(0).max(500).default(30),
  STORAGE_ROOT: z.string().min(1).default("/data/uploads"),
  // Product photos (docs/PRODUCT_PHOTOS_S3.md): "s3" sends new photos to an
  // S3-compatible bucket instead of the server's disk. Chat attachments and
  // banners stay on STORAGE_ROOT either way.
  PRODUCT_PHOTO_STORAGE: z.preprocess(blankToUndefined, z.enum(["local", "s3"]).default("local")),
  // compose.yaml passes an empty string for a setting the owner has not filled in.
  S3_ENDPOINT: z.preprocess(blankToUndefined, z.string().url().optional()),
  S3_REGION: z.preprocess(blankToUndefined, z.string().regex(/^[a-z0-9-]{1,64}$/u).default("ru-1")),
  S3_BUCKET: z.preprocess(blankToUndefined, z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u).optional()),
  S3_ACCESS_KEY_ID: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  S3_ACCESS_KEY_ID_FILE: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  S3_SECRET_ACCESS_KEY_FILE: z.string().min(1).optional(),
  // Path-style addressing (endpoint/bucket/key) is what every S3-compatible
  // provider accepts; "false" switches to bucket.endpoint for AWS-style hosts.
  S3_FORCE_PATH_STYLE: z.preprocess(blankToUndefined, z.enum(["true", "false"]).default("true")),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_SECRET_FILE: z.string().min(1).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  // «Подбор по автомобилю» (docs/PARTS_FINDER.md). Works offline (Probox
  // reference, shop fitment, LADA VIN rules); every paid provider is optional.
  PARTS_FINDER_ENABLED: z.enum(["true", "false"]).default("true"),
  FAPI_KEY: z.string().optional(),
  FAPI_KEY_FILE: z.string().min(1).optional(),
  // Vehicle fitment through FAPI (up to 35 credits per cold lookup). Off by
  // default: fitment comes from the shop's own table, FAPI pays for crosses.
  FAPI_FITMENT_ENABLED: z.enum(["true", "false", "1", "0"]).default("false"),
  FAPI_DAILY_CREDIT_LIMIT: z.coerce.number().int().min(0).max(1_000_000).default(1_000),
  // One visitor's share of the day's credits: without it one address spends the whole site's day in minutes.
  FAPI_VISITOR_DAILY_CREDIT_LIMIT: z.coerce.number().int().min(1).max(100_000).default(100),
  API_NINJAS_KEY: z.string().optional(),
  API_NINJAS_KEY_FILE: z.string().min(1).optional(),
  API_NINJAS_MODE: z.enum(["off", "demo", "commercial"]).default("off"),
  // TecDoc through tecdoc.site (docs/TECDOC.md). Request–response only, for
  // what a visitor is looking at: the offer forbids local copies and caching
  // beyond what displaying needs, so the cache is short and bounded and
  // nothing is stored in PostgreSQL. Enabled by the key alone.
  TECDOC_ENABLED: z.enum(["true", "false"]).default("true"),
  TECDOC_API_KEY: z.string().optional(),
  TECDOC_API_KEY_FILE: z.string().min(1).optional(),
  TECDOC_BASE_URL: z.string().url().default("https://tecdoc.site/api/v2"),
  // The paid package (requests per 30 days) and when it started (YYYY-MM-DD);
  // without a start date the calendar month is used.
  TECDOC_MONTHLY_LIMIT: z.coerce.number().int().min(100).max(5_000_000).default(150_000),
  TECDOC_PERIOD_START: z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/u).optional(),
  // 0 = automatic: what is left of the package, spread evenly over the days left.
  TECDOC_DAILY_LIMIT: z.coerce.number().int().min(0).max(1_000_000).default(0),
  // 0 = automatic: a fifth of the day's allowance in any one hour.
  TECDOC_HOURLY_LIMIT: z.coerce.number().int().min(0).max(200_000).default(0),
  // Provider calls one visitor may cause (cache answers are not counted).
  TECDOC_VISITOR_DAILY_LIMIT: z.coerce.number().int().min(5).max(10_000).default(150),
  // Display cache: 24 hours by default, never more than 7 days, at most
  // TECDOC_CACHE_MAX_ENTRIES answers. Raise only with the provider's written consent.
  TECDOC_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
  TECDOC_CACHE_MAX_ENTRIES: z.coerce.number().int().min(100).max(200_000).default(20_000),
});

/** Optional provider key: a missing or empty secret file simply means "not configured". */
function readOptionalSecret(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

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
  const rosskoKey1 = environment.ROSSKO_KEY1 ?? readSecret(environment.ROSSKO_KEY1_FILE);
  const rosskoKey2 = environment.ROSSKO_KEY2 ?? readSecret(environment.ROSSKO_KEY2_FILE);
  const geminiApiKey = environment.GEMINI_API_KEY ?? readSecret(environment.GEMINI_API_KEY_FILE);
  const reefApiKey = environment.REEFAPI_KEY ?? readSecret(environment.REEFAPI_KEY_FILE);
  const s3AccessKeyId = environment.S3_ACCESS_KEY_ID ?? readOptionalSecret(environment.S3_ACCESS_KEY_ID_FILE);
  const s3SecretAccessKey = environment.S3_SECRET_ACCESS_KEY
    ?? readOptionalSecret(environment.S3_SECRET_ACCESS_KEY_FILE);

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
  if (environment.ROSSKO_ENABLED === "true" && (!rosskoKey1 || !rosskoKey2)) {
    throw new Error("Rossko API credentials are not configured");
  }
  if (environment.AI_ENABLED === "true" && !geminiApiKey) {
    throw new Error("Gemini API key is not configured");
  }
  if (environment.REEFAPI_ENABLED === "true" && (!reefApiKey || reefApiKey.length < 10)) {
    throw new Error("ReefAPI credentials are not configured");
  }
  if (environment.ENABLE_PUBLIC_CHECKOUT === "true" && environment.LEGAL_DOCUMENTS_APPROVED !== "true") {
    throw new Error("Public checkout requires approved legal documents");
  }
  if (environment.PRODUCT_PHOTO_STORAGE === "s3") {
    if (!environment.S3_ENDPOINT || !environment.S3_BUCKET || !s3AccessKeyId || !s3SecretAccessKey) {
      throw new Error("S3 storage is not configured: endpoint, bucket, access key id and secret access key are required");
    }
  }
  // The keys sign every request (the bucket is still read after new photos are
  // switched back to the disk); plain HTTP is only for a local store on a developer's machine.
  if (
    environment.S3_ENDPOINT
    && !environment.S3_ENDPOINT.startsWith("https://")
    && environment.DEPLOYMENT_ENVIRONMENT !== "development"
  ) {
    throw new Error("S3 endpoint must use HTTPS");
  }
  if (!environment.STORAGE_ROOT.startsWith("/")) {
    throw new Error("Storage root must be an absolute path");
  }
  if (
    environment.AUTH_DEBUG_TOKENS === "true"
    && environment.DEPLOYMENT_ENVIRONMENT !== "development"
  ) {
    throw new Error("Auth debug tokens are forbidden in staging and production deployments");
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
    REEFAPI_ENABLED: environment.REEFAPI_ENABLED === "true",
    REEFAPI_KEY: reefApiKey,
    DATABASE_URL: databaseUrl,
    ENABLE_PUBLIC_CHECKOUT: environment.ENABLE_PUBLIC_CHECKOUT === "true",
    LEGAL_DOCUMENTS_APPROVED: environment.LEGAL_DOCUMENTS_APPROVED === "true",
    REDIS_URL: redisUrl,
    API_NINJAS_KEY: environment.API_NINJAS_KEY?.trim() || readOptionalSecret(environment.API_NINJAS_KEY_FILE),
    FAPI_FITMENT_ENABLED: environment.FAPI_FITMENT_ENABLED === "true" || environment.FAPI_FITMENT_ENABLED === "1",
    FAPI_KEY: environment.FAPI_KEY?.trim() || readOptionalSecret(environment.FAPI_KEY_FILE),
    PARTS_FINDER_ENABLED: environment.PARTS_FINDER_ENABLED === "true",
    TECDOC_API_KEY: environment.TECDOC_API_KEY?.trim() || readOptionalSecret(environment.TECDOC_API_KEY_FILE),
    TECDOC_ENABLED: environment.TECDOC_ENABLED === "true",
    TECDOC_PERIOD_START: environment.TECDOC_PERIOD_START || undefined,
    ROSSKO_ENABLED: environment.ROSSKO_ENABLED === "true",
    ROSSKO_KEY1: rosskoKey1,
    ROSSKO_KEY2: rosskoKey2,
    S3_ACCESS_KEY_ID: s3AccessKeyId,
    S3_FORCE_PATH_STYLE: environment.S3_FORCE_PATH_STYLE === "true",
    S3_SECRET_ACCESS_KEY: s3SecretAccessKey,
    SESSION_SECRET: sessionSecret,
  };
}
