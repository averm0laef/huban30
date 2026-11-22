import { describe, expect, it, vi } from "vitest";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { MalwareScannerService } from "../security/malware-scanner.service.js";
import type { MediaValidationService } from "../security/media-validation.service.js";
import { OneCExchangeImagesService } from "./one-c-exchange-images.service.js";
import type { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";

// A real 1x1 PNG: the service sniffs the signature before anything is stored.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TASK = { path: "import_files/ab/photo.png", productExternalId: "ext-1", sortOrder: 0 };

function setup(target: StorageProvider) {
  const inserted: unknown[][] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text.includes("FROM app.products")) return { rowCount: 1, rows: [{ id: "product-1", name: "Фильтр" }] };
    if (text.includes("INSERT INTO app.storage_objects")) {
      inserted.push(values ?? []);
      return { rowCount: 1, rows: [{ id: "object-1", status: "available", storage_key: values?.[1] }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const database = {
    query,
    transaction: async <T>(work: (client: { query: typeof query }) => Promise<T>) => work({ query }),
  };
  const service = new OneCExchangeImagesService(
    database as unknown as DatabaseService,
    { readAssembled: async () => PNG } as unknown as OneCExchangeTempStorageService,
    new ProductPhotoStorage(target, [{ name: "local" } as StorageProvider]),
    { assertClean: async () => undefined } as unknown as MalwareScannerService,
    { assertValid: async () => undefined } as unknown as MediaValidationService,
  );
  return { inserted, query, service };
}

describe("OneCExchangeImagesService", () => {
  it("puts a 1С photo into the photo storage and records which storage holds it", async () => {
    const store = vi.fn(async (content: Buffer) => ({ byteSize: content.length, storageKey: "catalog/2026-11/019bf9ea-0d3e-7def-8c9a-000000000011.png" }));
    const { inserted, service } = setup({ name: "s3", read: vi.fn(), remove: vi.fn(), store });

    await expect(service.attach(TASK, "one_c")).resolves.toBe("attached");

    expect(store).toHaveBeenCalledWith(PNG, "png");
    expect(inserted[0]?.slice(0, 2)).toEqual(["s3", "catalog/2026-11/019bf9ea-0d3e-7def-8c9a-000000000011.png"]);
  });

  it("skips the photo, not the exchange, when the photo storage does not accept it", async () => {
    const store = vi.fn(async () => { throw new Error("connect ECONNREFUSED"); });
    const { inserted, service } = setup({ name: "s3", read: vi.fn(), remove: vi.fn(), store });

    await expect(service.attach(TASK, "one_c")).resolves.toBe("skipped");

    expect(inserted).toHaveLength(0);
  });
});
