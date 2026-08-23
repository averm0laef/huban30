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
      "0011_chat_realtime",
      "0012_chat_message_edit_guard",
      "0013_staff_workspace",
      "0014_storefront_account",
      "0015_supplier_waiting_list",
      "0016_one_c_exchange",
      "0017_one_c_exchange_credentials",
      "0018_article_crosses",
      "0019_registration_personal_data_consent",
      "0020_checkout_personal_data_consent",
      "0021_supplier_waitlist_retention",
      "0022_article_crosses_confirmed_by_index",
      "0023_supplier_waitlist_anonymized_name",
      "0024_one_c_exchange_category_fallback",
    ]);
    expect(migrations.every(({ checksum }) => /^[a-f0-9]{64}$/.test(checksum))).toBe(true);
    expect(migrations[0]?.sql).toContain("CREATE SCHEMA app");
  });
});
