import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface Migration {
  checksum: string;
  id: string;
  sql: string;
}

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory))
    .filter((name) => migrationNamePattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  if (names.length === 0) {
    throw new Error(`No migration files found in ${directory}`);
  }

  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(directory, name), "utf8");
    return {
      checksum: createHash("sha256").update(sql).digest("hex"),
      id: name.replace(/\.sql$/, ""),
      sql,
    };
  }));

  const ids = new Set(migrations.map(({ id }) => id));
  if (ids.size !== migrations.length) {
    throw new Error("Duplicate migration identifiers found");
  }

  return migrations;
}
