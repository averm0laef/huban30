import { describe, expect, it } from "vitest";

import {
  CHAT_SMOKE_STORAGE_CONSUMER_GUARDS,
  newlyCreatedSmokeStorage,
  sameSmokeStorageSnapshot,
} from "./chat-smoke-storage.js";

describe("chat smoke storage cleanup", () => {
  it("does not claim an existing deduplicated object as smoke-owned", () => {
    const existing = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "available" as const,
      storage_key: "catalog/2026-08/11111111-1111-4111-8111-111111111111.png",
    };

    // This is the product_images-identical-hash regression: the upload may
    // reuse the existing storage row, but cleanup must not acquire ownership.
    expect(newlyCreatedSmokeStorage(existing, existing)).toBeNull();
  });

  it("tracks a tombstone revived under a new key by a repeated smoke run", () => {
    const before = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "deleted" as const,
      storage_key: "chat/2026-08/11111111-1111-4111-8111-111111111110.png",
    };
    const after = {
      ...before,
      status: "available" as const,
      storage_key: "chat/2026-08/11111111-1111-4111-8111-111111111112.png",
    };

    expect(newlyCreatedSmokeStorage(before, after)).toEqual(after);
    expect(sameSmokeStorageSnapshot(before, after)).toBe(false);
  });

  it("guards every non-chat foreign-key consumer before physical deletion", () => {
    expect(CHAT_SMOKE_STORAGE_CONSUMER_GUARDS).toContain("app.product_images");
    expect(CHAT_SMOKE_STORAGE_CONSUMER_GUARDS).toContain("app.catalog_import_batches");
    expect(CHAT_SMOKE_STORAGE_CONSUMER_GUARDS).toContain("app.banners");
    expect(CHAT_SMOKE_STORAGE_CONSUMER_GUARDS).toContain("app.invoices");
    expect(CHAT_SMOKE_STORAGE_CONSUMER_GUARDS).toContain("app.report_runs");
  });
});
