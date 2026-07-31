import { readFileSync } from "node:fs";

import { z } from "zod";

const environmentSchema = z.object({
  APP_DB_USER: z.string().regex(/^[a-z_][a-z0-9_]*$/).default("an30_app"),
  APP_POSTGRES_PASSWORD: z.string().min(16).optional(),
  APP_POSTGRES_PASSWORD_FILE: z.string().min(1).optional(),
  DATABASE_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("production"),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_NAME: z.string().min(1).default("an30"),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_USER: z.string().min(1).default("an30"),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_PASSWORD_FILE: z.string().min(1).optional(),
  PROVISION_APP_ROLE: z.enum(["true", "false"]).default("false"),
});

function readSecret(path: string | undefined): string | undefined {
  if (!path) return undefined;

  const value = readFileSync(path, "utf8").trim();
  return value || undefined;
}

export interface DatabaseConfig {
  applicationPassword?: string;
  applicationUser: string;
  connectionString: string;
  databaseEnvironment: "development" | "production" | "staging";
  provisionApplicationRole: boolean;
  ssl: false | { rejectUnauthorized: true };
}

export function getDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const parsed = environmentSchema.parse(environment);
  const password = parsed.POSTGRES_PASSWORD ?? readSecret(parsed.POSTGRES_PASSWORD_FILE);
  const applicationPassword = parsed.APP_POSTGRES_PASSWORD
    ?? readSecret(parsed.APP_POSTGRES_PASSWORD_FILE);

  if (!parsed.DATABASE_URL && !password) {
    throw new Error("Database credentials are required via DATABASE_URL or PostgreSQL password secret");
  }
  if (parsed.PROVISION_APP_ROLE === "true" && !applicationPassword) {
    throw new Error("Application database role provisioning requires its password secret");
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
    applicationPassword,
    applicationUser: parsed.APP_DB_USER,
    connectionString,
    databaseEnvironment: parsed.DATABASE_ENVIRONMENT,
    provisionApplicationRole: parsed.PROVISION_APP_ROLE === "true",
    ssl: parsed.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  };
}
