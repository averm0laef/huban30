import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import type { ProductPhotoNormalizer } from "../catalog/product-photo-normalizer.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { MalwareScannerService } from "../security/malware-scanner.service.js";
import type { MediaValidationService } from "../security/media-validation.service.js";
import { cataloguePhotoUrls, UmapiPhotoArchiveService } from "./umapi-photo-archive.service.js";
import type { UmapiGateway } from "./umapi.gateway.js";

const mediaBaseUrl = "https://image.umapi.example/IMAGE";

describe("UMAPI photo addresses", () => {
  it("accepts and deduplicates photos under the configured origin and path", () => {
    expect(cataloguePhotoUrls([
      { file: "photo.webp", supId: 1 },
      { file: "https://image.umapi.example/IMAGE/1/photo.webp", supId: null },
      { file: "https://image.umapi.example/another/photo.webp", supId: null },
      { file: "https://outside.example/IMAGE/photo.webp", supId: null },
      { file: "../photo.webp", supId: 1 },
    ], mediaBaseUrl)).toEqual([`${mediaBaseUrl}/1/photo.webp`]);
  });
});

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
describe.skipIf(!url)("private UMAPI photo archive in PostgreSQL", () => {
  it("deduplicates a product's link, saves a staff JPEG and blocks its public reimport", async () => {
    const database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    const tag = randomUUID();
    try {
      const brand = `UMAPI TEST ${tag}`;
      const sku = `sku-${tag}`;
      const code = `code-${tag}`;
      const brandId = (await database.query<{ id: string }>(
        "INSERT INTO app.brands (name,slug) VALUES ($1,$2) RETURNING id", [brand, tag],
      )).rows[0]!.id;
      const id = (await database.query<{ id: string }>(
        "INSERT INTO app.products (external_id,sku,name,slug,brand_id) VALUES ($1,$2,'Test private photo',$3,$4) RETURNING id",
        [code, sku, tag, brandId],
      )).rows[0]!.id;
      const jpeg = Buffer.from("test-normalized-jpeg");
      const archive = new UmapiPhotoArchiveService(database, { mediaBaseUrl } as UmapiGateway,
        { assertClean: async () => undefined } as unknown as MalwareScannerService,
        { assertValid: async () => undefined } as unknown as MediaValidationService,
        { normalize: async () => jpeg } as unknown as ProductPhotoNormalizer);
      const part = { artId: 123, article: sku, asked: sku, brand, via: "own" as const };
      await archive.remember({ brand, id, sku }, part, [`${mediaBaseUrl}/1/photo.webp`]);
      await archive.remember({ brand, id, sku }, part, [`${mediaBaseUrl}/1/photo.webp`]);
      const page = await archive.list({ search: code });
      expect(page.total).toBe(1);
      const photo = page.items[0]!;
      expect(photo).toMatchObject({ externalId: code, saved: false, sku });
      const image = await readFile(new URL("../../../web/public/categories/tormoznye-kolodki.webp", import.meta.url));
      const fetchImage = vi.fn(async () => new Response(new Uint8Array(image)));
      vi.stubGlobal("fetch", fetchImage);
      await expect(archive.save(photo.id)).resolves.toEqual({ saved: true });
      await archive.save(photo.id);
      expect(fetchImage).toHaveBeenCalledTimes(1);
      const saved = await archive.file(photo.id);
      expect(saved.bytes.equals(jpeg)).toBe(true);
      expect(saved.name).toBe(`${code}-an30-umapi-${photo.id.slice(0, 8)}.jpg`);
      const storageId = (await database.query<{ id: string }>(
        `INSERT INTO app.storage_objects (provider,storage_key,original_name,mime_type,byte_size,sha256,status)
         VALUES ('local',$1,'renamed.jpg','image/jpeg',$2,$3,'available') RETURNING id`,
        [`umapi-test/${tag}`, jpeg.length, createHash("sha256").update(jpeg).digest()],
      )).rows[0]!.id;
      const attached = await database.query(
        "INSERT INTO app.product_images (product_id,storage_object_id,alt_text) VALUES ($1,$2,'test') RETURNING id", [id, storageId],
      );
      expect(attached.rowCount).toBe(0);
      await database.query("UPDATE app.products SET sku='replacement' WHERE id=$1", [id]);
      await expect(archive.file(photo.id)).rejects.toThrow("Сохранённое фото не найдено");
    } finally {
      vi.unstubAllGlobals();
      await database.onModuleDestroy();
    }
  });
});
