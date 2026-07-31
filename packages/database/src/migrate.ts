import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client, escapeIdentifier, escapeLiteral } from "pg";

import { getDatabaseConfig } from "./config.js";
import { log } from "./logger.js";
import { loadMigrations } from "./migrations.js";

const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const migrationLockName = "an30-schema-migrations-v1";

async function ensureMigrationTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function migrationStatus(client: Client): Promise<{ applied: number; pending: number }> {
  const migrations = await loadMigrations(migrationDirectory);
  await ensureMigrationTable(client);
  const result = await client.query<{ checksum: string; id: string }>(
    "SELECT id, checksum FROM public.schema_migrations ORDER BY id",
  );
  const applied = new Map(result.rows.map((row) => [row.id, row.checksum.trim()]));
  const knownIds = new Set(migrations.map(({ id }) => id));

  for (const id of applied.keys()) {
    if (!knownIds.has(id)) {
      throw new Error(`Applied migration ${id} is missing from the application image`);
    }
  }

  for (const migration of migrations) {
    const checksum = applied.get(migration.id);
    if (checksum && checksum !== migration.checksum) {
      throw new Error(`Checksum mismatch for applied migration ${migration.id}`);
    }
  }

  return {
    applied: migrations.filter(({ id }) => applied.has(id)).length,
    pending: migrations.filter(({ id }) => !applied.has(id)).length,
  };
}

async function ensureDatabaseEnvironment(
  client: Client,
  expectedEnvironment: "development" | "production" | "staging",
): Promise<void> {
  await client.query(
    `
      UPDATE app.deployment_settings
      SET environment = $1, initialized_at = COALESCE(initialized_at, clock_timestamp())
      WHERE singleton AND environment = 'unconfigured'
    `,
    [expectedEnvironment],
  );
  await assertDatabaseEnvironment(client, expectedEnvironment);
}

async function assertDatabaseEnvironment(
  client: Client,
  expectedEnvironment: "development" | "production" | "staging",
): Promise<void> {
  const current = (await client.query<{ environment: string }>(
    "SELECT environment FROM app.deployment_settings WHERE singleton",
  )).rows[0];

  if (!current) {
    throw new Error("Database deployment environment marker is missing");
  }
  if (current.environment !== expectedEnvironment) {
    throw new Error(
      `Database environment mismatch: expected ${expectedEnvironment}, found ${current.environment}`,
    );
  }
}

async function provisionApplicationRole(
  client: Client,
  applicationUser: string,
  applicationPassword: string,
): Promise<void> {
  const role = escapeIdentifier(applicationUser);
  const password = escapeLiteral(applicationPassword);
  const identity = await client.query<{ current_database: string; current_user: string }>(
    "SELECT current_database(), current_user",
  );
  const databaseName = identity.rows[0]?.current_database;
  const ownerName = identity.rows[0]?.current_user;
  if (!databaseName || !ownerName) {
    throw new Error("Unable to resolve the migration owner and database name");
  }

  const database = escapeIdentifier(databaseName);
  const owner = escapeIdentifier(ownerName);

  await client.query(`
    DO $role$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${escapeLiteral(applicationUser)}) THEN
        CREATE ROLE ${role}
          LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
      END IF;
    END
    $role$;

    ALTER ROLE ${role}
      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS
      PASSWORD ${password};
    GRANT CONNECT ON DATABASE ${database} TO ${role};
    GRANT USAGE ON SCHEMA app TO ${role};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ${role};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO ${role};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${role};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA app
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA app
      GRANT USAGE, SELECT ON SEQUENCES TO ${role};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA app
      GRANT EXECUTE ON FUNCTIONS TO ${role};
  `);
}

async function assertApplicationRole(client: Client, applicationUser: string): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = $1
          AND rolcanlogin
          AND NOT rolsuper
          AND NOT rolcreatedb
          AND NOT rolcreaterole
          AND NOT rolbypassrls
      ) AS exists
    `,
    [applicationUser],
  );
  if (!result.rows[0]?.exists) {
    throw new Error(`Least-privilege application role ${applicationUser} is missing or unsafe`);
  }
}

async function migrate(
  client: Client,
  config: ReturnType<typeof getDatabaseConfig>,
): Promise<void> {
  const migrations = await loadMigrations(migrationDirectory);
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [migrationLockName]);

  try {
    await ensureMigrationTable(client);
    const result = await client.query<{ checksum: string; id: string }>(
      "SELECT id, checksum FROM public.schema_migrations ORDER BY id",
    );
    const applied = new Map(result.rows.map((row) => [row.id, row.checksum.trim()]));
    const knownIds = new Set(migrations.map(({ id }) => id));

    for (const id of applied.keys()) {
      if (!knownIds.has(id)) {
        throw new Error(`Applied migration ${id} is missing from the application image`);
      }
    }

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.id);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(`Checksum mismatch for applied migration ${migration.id}`);
      }
      if (existingChecksum) continue;

      log("info", "migration.started", { migration: migration.id });
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '5min'");
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO public.schema_migrations (id, checksum) VALUES ($1, $2)",
          [migration.id, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      log("info", "migration.completed", { migration: migration.id });
    }

    await ensureDatabaseEnvironment(client, config.databaseEnvironment);
    if (config.provisionApplicationRole) {
      await provisionApplicationRole(
        client,
        config.applicationUser,
        config.applicationPassword ?? "",
      );
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [migrationLockName]);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  if (command !== "up" && command !== "status") {
    throw new Error(`Unknown database command: ${command}`);
  }

  const config = getDatabaseConfig();
  const client = new Client(config);
  await client.connect();

  try {
    if (command === "status") {
      const status = await migrationStatus(client);
      if (status.pending === 0) {
        await assertDatabaseEnvironment(client, config.databaseEnvironment);
        if (config.provisionApplicationRole) {
          await assertApplicationRole(client, config.applicationUser);
        }
      }
      log("info", "migration.status", status);
      return;
    }

    await migrate(client, config);
    log("info", "migration.status", await migrationStatus(client));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  log("error", "migration.failed", {
    message: error instanceof Error ? error.message : "Unknown migration error",
  });
  process.exitCode = 1;
});
