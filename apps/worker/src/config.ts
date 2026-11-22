import { readFileSync } from "node:fs";

import { z } from "zod";

const optionalText = (schema: z.ZodString = z.string()) => z.preprocess(
  (value) => value === "" ? undefined : value,
  schema.optional(),
);
const optionalPositiveInteger = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.coerce.number().int().positive().optional(),
);

const WorkerEnvironmentSchema = z.object({
  DEPLOYMENT_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY_FILE: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_NAME: z.string().min(1).default("an30"),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_USER: z.string().min(1).default("an30_app"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost"),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_PASSWORD_FILE: z.string().min(1).optional(),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(4001),
  REDIS_URL: z.string().url().optional(),
  REDIS_HOST: z.string().min(1).default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_PASSWORD: z.string().min(1).optional(),
  REDIS_PASSWORD_FILE: z.string().min(1).optional(),
  SMTP_ENABLED: z.enum(["true", "false"]).default("false"),
  SMTP_FROM: optionalText(z.string().email()),
  SMTP_HOST: optionalText(z.string().min(1)),
  SMTP_PASSWORD: optionalText(z.string().min(1)),
  SMTP_PASSWORD_FILE: optionalText(z.string().min(1)),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: optionalText(z.string().min(1)),
  TELEGRAM_BOT_TOKEN: optionalText(z.string().min(20)),
  TELEGRAM_BOT_TOKEN_FILE: optionalText(z.string().min(1)),
  TELEGRAM_CHAT_ID: optionalText(z.string().min(1)),
  TELEGRAM_ENABLED: z.enum(["true", "false"]).default("false"),
  VK_ACCESS_TOKEN: optionalText(z.string().min(20)),
  VK_ACCESS_TOKEN_FILE: optionalText(z.string().min(1)),
  VK_ENABLED: z.enum(["true", "false"]).default("false"),
  VK_PEER_ID: optionalPositiveInteger,
});

function readSecret(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return readFileSync(path, "utf8").trim();
}

export function readWorkerConfig(raw: NodeJS.ProcessEnv) {
  const environment = WorkerEnvironmentSchema.parse(raw);
  const password = environment.REDIS_PASSWORD ?? readSecret(environment.REDIS_PASSWORD_FILE);
  const databasePassword = environment.POSTGRES_PASSWORD
    ?? readSecret(environment.POSTGRES_PASSWORD_FILE);
  const dataEncryptionKey = environment.DATA_ENCRYPTION_KEY
    ?? readSecret(environment.DATA_ENCRYPTION_KEY_FILE);
  const smtpPassword = environment.SMTP_PASSWORD ?? readSecret(environment.SMTP_PASSWORD_FILE);
  const telegramBotToken = environment.TELEGRAM_BOT_TOKEN
    ?? readSecret(environment.TELEGRAM_BOT_TOKEN_FILE);
  const vkAccessToken = environment.VK_ACCESS_TOKEN ?? readSecret(environment.VK_ACCESS_TOKEN_FILE);

  if (environment.NODE_ENV === "production" && !environment.REDIS_URL && !password) {
    throw new Error("Production Redis credentials are not configured");
  }
  if (environment.NODE_ENV === "production" && !environment.DATABASE_URL && !databasePassword) {
    throw new Error("Production database credentials are not configured");
  }
  if (!dataEncryptionKey || dataEncryptionKey.length < 32) {
    throw new Error("Worker data encryption key must contain at least 32 characters");
  }
  const smtpEnabled = environment.SMTP_ENABLED === "true";
  if (smtpEnabled && (!environment.SMTP_HOST || !environment.SMTP_FROM)) {
    throw new Error("Enabled SMTP requires SMTP_HOST and SMTP_FROM");
  }
  if (smtpEnabled && Boolean(environment.SMTP_USER) !== Boolean(smtpPassword)) {
    throw new Error("SMTP_USER and SMTP password must be configured together");
  }
  const telegramEnabled = environment.TELEGRAM_ENABLED === "true";
  if (telegramEnabled && (!telegramBotToken || !environment.TELEGRAM_CHAT_ID)) {
    throw new Error("Enabled Telegram requires bot token and chat id");
  }
  const vkEnabled = environment.VK_ENABLED === "true";
  if (vkEnabled && (!vkAccessToken || !environment.VK_PEER_ID)) {
    throw new Error("Enabled VK requires access token and peer id");
  }

  return {
    deploymentEnvironment: environment.DEPLOYMENT_ENVIRONMENT,
    databaseUrl: environment.DATABASE_URL ?? [
      `postgresql://${encodeURIComponent(environment.DB_USER)}`,
      `:${encodeURIComponent(databasePassword ?? "an30_dev")}`,
      `@${environment.DB_HOST}:${environment.DB_PORT}/${environment.DB_NAME}`,
    ].join(""),
    healthPort: environment.WORKER_HEALTH_PORT,
    notifications: {
      publicBaseUrl: environment.PUBLIC_BASE_URL,
      smtp: {
        enabled: smtpEnabled,
        from: environment.SMTP_FROM,
        host: environment.SMTP_HOST,
        password: smtpPassword,
        port: environment.SMTP_PORT,
        secure: environment.SMTP_SECURE === "true",
        user: environment.SMTP_USER,
      },
      telegram: {
        botToken: telegramBotToken,
        chatId: environment.TELEGRAM_CHAT_ID,
        enabled: telegramEnabled,
      },
      vk: {
        accessToken: vkAccessToken,
        enabled: vkEnabled,
        peerId: environment.VK_PEER_ID,
      },
    },
    redisUrl: environment.REDIS_URL ?? [
      "redis://",
      password ? `:${encodeURIComponent(password)}@` : "",
      `${environment.REDIS_HOST}:${environment.REDIS_PORT}`,
    ].join(""),
    dataEncryptionKey,
  };
}
