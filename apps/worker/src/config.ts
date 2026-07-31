import { readFileSync } from "node:fs";

import { z } from "zod";

const WorkerEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_NAME: z.string().min(1).default("an30"),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_USER: z.string().min(1).default("an30_app"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_PASSWORD_FILE: z.string().min(1).optional(),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(4001),
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

export function readWorkerConfig(raw: NodeJS.ProcessEnv) {
  const environment = WorkerEnvironmentSchema.parse(raw);
  const password = environment.REDIS_PASSWORD ?? readSecret(environment.REDIS_PASSWORD_FILE);
  const databasePassword = environment.POSTGRES_PASSWORD
    ?? readSecret(environment.POSTGRES_PASSWORD_FILE);

  if (environment.NODE_ENV === "production" && !environment.REDIS_URL && !password) {
    throw new Error("Production Redis credentials are not configured");
  }
  if (environment.NODE_ENV === "production" && !environment.DATABASE_URL && !databasePassword) {
    throw new Error("Production database credentials are not configured");
  }

  return {
    databaseUrl: environment.DATABASE_URL ?? [
      `postgresql://${encodeURIComponent(environment.DB_USER)}`,
      `:${encodeURIComponent(databasePassword ?? "an30_dev")}`,
      `@${environment.DB_HOST}:${environment.DB_PORT}/${environment.DB_NAME}`,
    ].join(""),
    healthPort: environment.WORKER_HEALTH_PORT,
    redisUrl: environment.REDIS_URL ?? [
      "redis://",
      password ? `:${encodeURIComponent(password)}@` : "",
      `${environment.REDIS_HOST}:${environment.REDIS_PORT}`,
    ].join(""),
  };
}
