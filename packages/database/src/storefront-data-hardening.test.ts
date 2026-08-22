import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

describe("storefront data hardening migration", () => {
  it("defines retention, anonymization, money bounds, and every missing FK index", async () => {
    const migration = (await loadMigrations(directory)).find(
      ({ id }) => id === "0014_storefront_account",
    );

    expect(migration).toBeDefined();
    const sql = migration?.sql ?? "";

    expect(sql).toContain("CREATE FUNCTION app.anonymize_expired_contact_requests");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("contact_requests_retention_idx");

    for (const index of [
      "wishlist_items_product_idx",
      "product_images_storage_object_idx",
      "inventory_events_warehouse_idx",
      "stock_reservation_items_product_idx",
      "stock_reservation_items_warehouse_idx",
      "chat_participants_user_idx",
      "chat_attachments_storage_object_idx",
    ]) {
      expect(sql).toContain(`CREATE INDEX ${index}`);
    }

    for (const constraint of [
      "product_prices_amount_safe_integer",
      "stock_reservation_items_unit_price_safe_integer",
      "orders_money_safe_integer",
      "order_items_money_safe_integer",
      "payments_money_safe_integer",
      "refunds_amount_safe_integer",
      "invoices_amount_safe_integer",
    ]) {
      expect(sql).toContain(`VALIDATE CONSTRAINT ${constraint}`);
    }

    expect(sql.match(/9007199254740991/g)?.length).toBe(13);
  });

  it("keeps checkout consent separate and makes its evidence immutable", async () => {
    const migration = (await loadMigrations(directory)).find(
      ({ id }) => id === "0020_checkout_personal_data_consent",
    );
    const sql = migration?.sql ?? "";

    expect(sql).toContain("personal_data_consent_at");
    expect(sql).toContain("personal_data_consent_policy_version");
    expect(sql).toContain("personal_data_consent_document_path");
    expect(sql).toContain("personal_data_consent_text");
    expect(sql).toContain("orders_current_legal_evidence_complete");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.preserve_order_legal_acceptance");
  });

  it("anonymizes expired supplier waitlist contact data", async () => {
    const migration = (await loadMigrations(directory)).find(
      ({ id }) => id === "0021_supplier_waitlist_retention",
    );
    const sql = migration?.sql ?? "";

    expect(sql).toContain("CREATE FUNCTION app.anonymize_expired_supplier_waitlist_requests");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("supplier_waitlist_requests_retention_idx");
    expect(sql).toContain("customer_email=NULL");
    expect(sql).toContain("customer_phone=NULL");
  });
});
