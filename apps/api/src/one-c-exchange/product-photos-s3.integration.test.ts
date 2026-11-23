// A photo 1С uploads ends up in the S3 bucket -- not on the server's disk --
// and the shop serves exactly those bytes for the product card. Runs against
// a real PostgreSQL and a real S3-compatible server; skipped unless both
// CATALOG_SEARCH_DATABASE_URL and S3_TEST_ENDPOINT are set
// (docs/PRODUCT_PHOTOS_S3.md, «Локальная проверка»).
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalStorageProvider } from "../adapters/local-storage.provider.js";
import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { S3StorageProvider } from "../adapters/s3-storage.provider.js";
import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "../catalog/catalog-public.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { MalwareScannerService } from "../security/malware-scanner.service.js";
import type { MediaValidationService } from "../security/media-validation.service.js";
import { OneCExchangeImagesService } from "./one-c-exchange-images.service.js";
import { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const endpoint = process.env.S3_TEST_ENDPOINT;
const EXTERNAL_ID = "s3-photo-fixture-product";
const PHOTO_PATH = "import_files/s3/photo-fixture.png";
// A real 1x1 PNG, made unique per run so an earlier run's record cannot satisfy this one.
const PNG = Buffer.concat([
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
  Buffer.from(`run-${Date.now()}`),
]);

describe.skipIf(!url || !endpoint)("product photos in S3 (real PostgreSQL and S3-compatible server)", () => {
  let database: DatabaseService;
  let root: string;
  let s3: S3StorageProvider;
  let images: OneCExchangeImagesService;
  let storefront: CatalogPublicService;
  const storedKeys = async () => (await database.query<{ provider: string; storage_key: string }>(
    `SELECT storage.provider, storage.storage_key FROM app.storage_objects AS storage
     JOIN app.product_images AS image ON image.storage_object_id = storage.id
     JOIN app.products AS product ON product.id = image.product_id WHERE product.external_id = $1`,
    [EXTERNAL_ID],
  )).rows;
  const clean = async () => {
    for (const row of await storedKeys()) if (row.provider === "s3") await s3.remove(row.storage_key);
    await database.query("DELETE FROM app.products WHERE external_id = $1", [EXTERNAL_ID]);
    await database.query("DELETE FROM app.storage_objects WHERE original_name = $1", [`1c:${PHOTO_PATH}`]);
  };

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "an30-s3-photos-"));
    const config = new ConfigService({ STORAGE_ROOT: root });
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    s3 = new S3StorageProvider({
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "",
      bucket: process.env.S3_TEST_BUCKET ?? "",
      endpoint: endpoint!,
      forcePathStyle: true,
      region: process.env.S3_TEST_REGION ?? "ru-1",
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "",
    });
    const photos = new ProductPhotoStorage(s3, [new LocalStorageProvider(config)]);
    images = new OneCExchangeImagesService(
      database,
      new OneCExchangeTempStorageService(config),
      photos,
      { assertClean: async () => undefined } as unknown as MalwareScannerService,
      { assertValid: async () => undefined } as unknown as MediaValidationService,
    );
    storefront = new CatalogPublicService(new CatalogCategoryTreeCache(), database, photos, null);
    await clean();
    await database.query(
      "INSERT INTO app.products (external_id,sku,name,slug,one_c_source) VALUES ($1,'S3-PHOTO-1','Фильтр с фото','s3-photo-fixture','one_c')",
      [EXTERNAL_ID],
    );
    // What mode=file leaves behind for mode=import to pick up.
    const incoming = path.join(root, "one-c-exchange", "incoming", "one_c", path.dirname(PHOTO_PATH));
    await mkdir(incoming, { recursive: true });
    await writeFile(path.join(incoming, path.basename(PHOTO_PATH)), PNG);
  }, 60_000);

  afterAll(async () => {
    if (database) await clean();
    await database?.onModuleDestroy?.();
    if (root) await rm(root, { force: true, recursive: true });
  });

  it("stores the 1С photo in the bucket and serves the same bytes on the product card", async () => {
    await expect(images.attach({ path: PHOTO_PATH, productExternalId: EXTERNAL_ID, sortOrder: 0 }, "one_c"))
      .resolves.toBe("attached");

    const [stored] = await storedKeys();
    expect(stored?.provider).toBe("s3");
    expect(stored?.storage_key).toMatch(/^catalog\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/u);
    expect((await s3.read(stored!.storage_key)).equals(PNG)).toBe(true);
    // Nothing but the 1С scratch area was written to the server's disk.
    expect(await readdir(root)).toEqual(["one-c-exchange"]);

    const product = await storefront.product("s3-photo-fixture");
    expect(product.images).toHaveLength(1);
    const imageId = product.images[0]!.id;
    const served = await storefront.media(imageId);
    expect(served.mimeType).toBe("image/png");
    expect(served.content?.equals(PNG)).toBe(true);
  });

  it("does not store the same photo twice when 1С sends it again", async () => {
    await expect(images.attach({ path: PHOTO_PATH, productExternalId: EXTERNAL_ID, sortOrder: 0 }, "one_c"))
      .resolves.toBe("unchanged");
    expect(await storedKeys()).toHaveLength(1);
  });
});
