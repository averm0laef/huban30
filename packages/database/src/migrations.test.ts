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
      "0025_catalog_search_yo_and_word_forms",
      "0026_checkout_manager_requests",
      "0027_checkout_legal_policy_v3",
      "0028_one_c_session_revocation",
      "0029_client_hub",
      "0030_multi_source_one_c",
      "0031_manager_dispatch",
      "0032_customer_social_identities",
      "0033_one_c_exchange_properties_images",
      "0034_catalog_search_trgm_indexes",
      "0035_search_index_queue",
      "0036_storefront_subsections_one_c_groups",
      "0037_one_c_group_mappings_updated_by_index",
      "0038_parts_finder",
      "0039_chat_numbers_customer_avatars",
      "0040_catalog_search_log",
      "0041_article_crosses_fapi_source",
      "0042_assortment_cross_links",
      "0043_tecdoc_and_garage",
      "0044_parts_sections_and_placement_rules",
      "0045_catalog_tree_second_edition",
      "0046_article_is_not_a_product_key",
      "0047_exchange_run_price_type",
      "0048_hidden_shelf",
      "0049_hoses_fittings_and_heaters",
      "0050_russian_name_order",
      "0051_product_slug_history",
      "0052_daily_one_c_exchange",
      "0053_supplier_cross_lookups",
      "0054_product_photo_rights",
      "0055_one_c_products_adopted",
      "0056_vehicle_catalog",
      "0057_drop_former_vehicle_directory",
      "0058_umapi_usage",
      "0059_search_typo_distance",
      "0060_vehicle_kind_and_popularity",
      "0061_umapi_product_photos",
      "0062_product_catalogue_cards",
      "0063_article_crosses_umapi_source",
      "0064_product_photo_fk_indexes",
    ]);
    expect(migrations.every(({ checksum }) => /^[a-f0-9]{64}$/.test(checksum))).toBe(true);
    expect(migrations[0]?.sql).toContain("CREATE SCHEMA app");
  });
});
