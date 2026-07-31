import { readFileSync } from "node:fs";

import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("production"),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_NAME: z.string().min(1).default("an30"),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_USER: z.string().min(1).default("an30"),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_PASSWORD_FILE: z.string().min(1).optional(),
});

function readSecret(path: string | undefined): string | undefined {
  if (!path) return undefined;

  const value = readFileSync(path, "utf8").trim();
  return value || undefined;
}

export interface DatabaseConfig {
  connectionString: string;
  databaseEnvironment: "development" | "production" | "staging";
  ssl: false | { rejectUnauthorized: true };
}

export function getDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const parsed = environmentSchema.parse(environment);
  const password = parsed.POSTGRES_PASSWORD ?? readSecret(parsed.POSTGRES_PASSWORD_FILE);

  if (!parsed.DATABASE_URL && !password) {
    throw new Error("Database credentials are required via DATABASE_URL or PostgreSQL password secret");
  }

  const connectionString = parsed.DATABASE_URL ?? (() => {
    const url = new URL("postgresql://localhost");
    url.hostname = parsed.DB_HOST;
    url.port = String(parsed.DB_PORT);
    url.username = parsed.DB_USER;
    url.password = password ?? "";
    url.pathname = `/${parsed.DB_NAME}`;
    return url.toString();
  })();

  return {
    connectionString,
    databaseEnvironment: parsed.DATABASE_ENVIRONMENT,
    ssl: parsed.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  };
}
