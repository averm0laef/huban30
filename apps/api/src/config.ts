import { readFileSync } from "node:fs";

import { z } from "zod";

const RawEnvironmentSchema = z.object({
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

  if (environment.NODE_ENV === "production" && !environment.DATABASE_URL && !databasePassword) {
    throw new Error("Production database credentials are not configured");
  }
  if (environment.NODE_ENV === "production" && !environment.REDIS_URL && !redisPassword) {
    throw new Error("Production Redis credentials are not configured");
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

  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
  };
}
