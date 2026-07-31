import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

describe("database migrations", () => {
  it("loads ordered migrations with stable SHA-256 checksums", async () => {
    const migrations = await loadMigrations(directory);

    expect(migrations.map(({ id }) => id)).toEqual([
      "0001_initial_schema",
      "0002_deployment_environment",
      "0003_demo_catalog_guard",
      "0004_catalog_revision_changes",
      "0005_wishlist",
      "0006_foreign_key_indexes",
      "0007_auth_security",
      "0008_one_c_import_pipeline",
      "0009_one_c_request_batch_index",
      "0010_checkout_reservations",
    ]);
    expect(migrations.every(({ checksum }) => /^[a-f0-9]{64}$/.test(checksum))).toBe(true);
    expect(migrations[0]?.sql).toContain("CREATE SCHEMA app");
  });
});
