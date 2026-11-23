// Rehearsal of product photos on the owner's catalogue: items taken as they are from the 1С export get a
// <Картинка>, go through the real OneCExchangeService into a copy of the test product base, and their photos
// must land in the S3 bucket -- not on the disk -- and be served on the product cards.
//
// Skipped unless all are set:
//   PRODUCT_PHOTO_REHEARSAL_DATABASE_URL   a COPY of the test product base, made for this run and dropped after it
//   PRODUCT_PHOTO_REHEARSAL_DIR            folder with rehearsal-import.xml (absolute path, local-data/1c)
//   S3_TEST_ENDPOINT, S3_TEST_BUCKET, S3_TEST_ACCESS_KEY_ID, S3_TEST_SECRET_ACCESS_KEY
//
// docs/PRODUCT_PHOTOS_S3.md, «Проверка на тестовой базе товаров». The suite refuses a database that already holds
// product photos. What it does not check: the antivirus (clamd is replaced by a stub here; the image itself is
// still checked by the real ffprobe when it is installed) and a file made by 1С itself.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalStorageProvider } from "../adapters/local-storage.provider.js";
import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { S3StorageProvider, type S3StorageSettings } from "../adapters/s3-storage.provider.js";
import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "../catalog/catalog-public.service.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { MalwareScannerService } from "../security/malware-scanner.service.js";
import { MediaValidationService } from "../security/media-validation.service.js";
import { OneCExchangeImagesService } from "./one-c-exchange-images.service.js";
import { OneCExchangeService, type OneCExchangeImportOutcome } from "./one-c-exchange.service.js";
import { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";

const url = process.env.PRODUCT_PHOTO_REHEARSAL_DATABASE_URL;
const directory = process.env.PRODUCT_PHOTO_REHEARSAL_DIR;
const endpoint = process.env.S3_TEST_ENDPOINT;
const PHOTOS = 40;
const TEN_MINUTES = 600_000;

/** A valid PNG of noise: every photo is different and weighs about as much as a real product photo (~350 KB). */
function png(width = 400, height = 300): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) randomBytes(width * 3).copy(rows, y * (1 + width * 3) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe.skipIf(!url || !directory || !endpoint)("rehearsal of product photos in S3 on the test product base", () => {
  let database: DatabaseService;
  let root: string;
  let s3: S3StorageProvider;
  let local: LocalStorageProvider;
  let storefront: CatalogPublicService;
  let config: ConfigService;
  let items: { externalId: string; photo: Buffer; photoPath: string; xml: string }[] = [];
  let productsBefore = 0;
  const settings = (): S3StorageSettings => ({
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "",
    bucket: process.env.S3_TEST_BUCKET ?? "",
    endpoint: endpoint!,
    forcePathStyle: true,
    region: process.env.S3_TEST_REGION ?? "ru-1",
    secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "",
  });
  const count = async (sql: string) => Number((await database.query<{ n: string }>(sql)).rows[0]!.n);
  const scanner = { assertClean: async () => undefined } as unknown as MalwareScannerService;
  const media = () => (existsSync("/usr/bin/ffprobe")
    ? new MediaValidationService(config)
    : { assertValid: async () => undefined } as unknown as MediaValidationService);

  function exchangeWith(target: S3StorageProvider): OneCExchangeService {
    const images = new OneCExchangeImagesService(
      database, new OneCExchangeTempStorageService(config), new ProductPhotoStorage(target, [local]), scanner, media(),
    );
    const integration = new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never);
    return new OneCExchangeService(new CatalogCategoryTreeCache(), database, integration, images);
  }

  /** The way 1С sends it: the photos with mode=file, then import.xml polled with mode=import until it is done. */
  async function send(exchange: OneCExchangeService, filename: string, slice: typeof items, formedAt = "2026-11-23T00:00:00"): Promise<OneCExchangeImportOutcome> {
    for (const item of slice) {
      const target = path.join(root, "one-c-exchange", "incoming", "one_c", item.photoPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, item.photo);
    }
    const assembled = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="${formedAt}">\n`
      + `<Классификатор><Ид>c</Ид><Наименование>Классификатор</Наименование></Классификатор>\n`
      + `<Каталог СодержитТолькоИзменения="true"><Ид>cat</Ид><Товары>\n${slice.map((item) => item.xml).join("\n")}\n</Товары></Каталог>\n`
      + `</КоммерческаяИнформация>\n`,
      "utf8",
    );
    const checksum = createHash("sha256").update(assembled).digest();
    for (let polls = 0; polls < 200; polls += 1) {
      const outcome = await exchange.processImport({ assembled, checksum, filename, kind: "catalog" });
      if (outcome.kind !== "progress") return outcome;
    }
    throw new Error("the import did not finish in 200 polls");
  }
  const journal = async (filename: string) => (await database.query<{ images_attached: number; images_skipped: number; rows_rejected: number; status: string }>(
    "SELECT status, rows_rejected, images_attached, images_skipped FROM app.one_c_exchange_runs WHERE filename = $1",
    [filename],
  )).rows[0];
  const stored = async (externalIds: string[]) => (await database.query<{ byte_size: string; external_id: string; provider: string; slug: string; storage_key: string }>(
    `SELECT product.external_id, product.slug, storage.provider, storage.storage_key, storage.byte_size::text
     FROM app.product_images AS image JOIN app.storage_objects AS storage ON storage.id = image.storage_object_id
     JOIN app.products AS product ON product.id = image.product_id WHERE product.external_id = ANY($1::text[])`,
    [externalIds],
  )).rows;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "an30-photo-rehearsal-"));
    config = new ConfigService({ FFPROBE_PATH: "/usr/bin/ffprobe", STORAGE_ROOT: root });
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    s3 = new S3StorageProvider(settings());
    local = new LocalStorageProvider(config);
    storefront = new CatalogPublicService(new CatalogCategoryTreeCache(), database, new ProductPhotoStorage(s3, [local]), null);
    productsBefore = await count("SELECT count(*)::text AS n FROM app.products WHERE deleted_at IS NULL AND is_active");
    if (productsBefore < 1000) throw new Error(`PRODUCT_PHOTO_REHEARSAL_DATABASE_URL must be a copy of the test product base; this one holds ${productsBefore} products`);
    const photos = await count("SELECT count(*)::text AS n FROM app.product_images");
    if (photos > 0) throw new Error(`the copy of the test product base already holds ${photos} photos: restore a fresh copy`);

    // Items of the owner's export, as 1С wrote them, that the shop shows; each gets one photo.
    const shown = new Set((await database.query<{ external_id: string }>(
      `SELECT product.external_id FROM app.products AS product JOIN app.categories AS category ON category.id = product.category_id
       WHERE product.deleted_at IS NULL AND product.is_active AND category.is_active AND product.one_c_source = 'one_c'`,
    )).rows.map((row) => row.external_id));
    const xml = readFileSync(path.join(directory!, "rehearsal-import.xml"), "utf8");
    const all = [...xml.matchAll(/<Товар><Ид>([^<]+)<\/Ид>.*?<\/Товар>/gsu)].filter((match) => shown.has(match[1]!));
    const step = Math.floor(all.length / (PHOTOS + 2));
    items = Array.from({ length: PHOTOS + 2 }, (_, index) => {
      const match = all[index * step]!;
      const photoPath = `import_files/${String(index % 7).padStart(2, "0")}/photo-${index}.png`;
      return {
        externalId: match[1]!,
        photo: png(),
        photoPath,
        xml: match[0].replace("</Товар>", `<Картинка>${photoPath}</Картинка></Товар>`),
      };
    });
  }, TEN_MINUTES);

  afterAll(async () => {
    await database?.onModuleDestroy?.();
    if (root) await rm(root, { force: true, recursive: true });
  });

  it("puts every photo 1С sends into the bucket and shows it on the product card", async () => {
    const batch = items.slice(0, PHOTOS);
    const namesBefore = await database.query<{ category_id: string; external_id: string; name: string; slug: string }>(
      "SELECT external_id, name, slug, category_id FROM app.products WHERE external_id = ANY($1::text[]) ORDER BY external_id", [batch.map((item) => item.externalId)],
    );

    await expect(send(exchangeWith(s3), "photo-rehearsal-1.xml", batch)).resolves.toEqual({ kind: "success" });

    expect(await journal("photo-rehearsal-1.xml")).toEqual({ images_attached: PHOTOS, images_skipped: 0, rows_rejected: 0, status: "completed" });
    const rows = await stored(batch.map((item) => item.externalId));
    expect(rows).toHaveLength(PHOTOS);
    expect(new Set(rows.map((row) => row.provider))).toEqual(new Set(["s3"]));
    // The server's disk holds nothing but the 1С scratch area: no catalog/ or chat/ folder appeared.
    expect(existsSync(path.join(root, "catalog"))).toBe(false);
    expect(existsSync(path.join(root, "chat"))).toBe(false);

    let bytes = 0;
    for (const item of batch) {
      const row = rows.find((candidate) => candidate.external_id === item.externalId)!;
      expect((await s3.read(row.storage_key)).equals(item.photo)).toBe(true);
      const card = await storefront.product(row.slug);
      expect(card.images).toHaveLength(1);
      expect(card.primaryImage?.id).toBe(card.images[0]!.id);
      const served = await storefront.media(card.images[0]!.id);
      expect(served.mimeType).toBe("image/png");
      expect(served.content?.equals(item.photo)).toBe(true);
      bytes += item.photo.length;
    }
    process.stdout.write(`\n[photo rehearsal] ${PHOTOS} photos, ${Math.round(bytes / 1024)} KB in the bucket, 0 bytes on the disk\n`);

    // The exchange changed nothing else: same number of products on sale, same names, addresses and sections.
    expect(await count("SELECT count(*)::text AS n FROM app.products WHERE deleted_at IS NULL AND is_active")).toBe(productsBefore);
    const namesAfter = await database.query(
      "SELECT external_id, name, slug, category_id FROM app.products WHERE external_id = ANY($1::text[]) ORDER BY external_id", [batch.map((item) => item.externalId)],
    );
    expect(namesAfter.rows).toEqual(namesBefore.rows);
  }, TEN_MINUTES);

  it("does not store a photo twice when 1С sends the same one again", async () => {
    const batch = items.slice(0, PHOTOS);
    // A later export of the same items: a new file for the exchange, the same photos.
    await expect(send(exchangeWith(s3), "photo-rehearsal-2.xml", batch, "2026-11-23T06:00:00")).resolves.toEqual({ kind: "success" });

    expect(await journal("photo-rehearsal-2.xml")).toMatchObject({ images_attached: 0, images_skipped: 0, status: "completed" });
    expect(await stored(batch.map((item) => item.externalId))).toHaveLength(PHOTOS);
    expect(await count("SELECT count(*)::text AS n FROM app.storage_objects")).toBe(PHOTOS);
  }, TEN_MINUTES);

  it("does not serve a photo that was replaced in the bucket", async () => {
    const [row] = await stored([items[0]!.externalId]);
    const card = await storefront.product(row!.slug);
    const tampering = new ProductPhotoStorage(
      { name: "s3", read: async () => png(), remove: async () => undefined, store: async () => ({ byteSize: 0, storageKey: "" }) },
    );
    const exposed = new CatalogPublicService(new CatalogCategoryTreeCache(), database, tampering, null);

    await expect(exposed.media(card.images[0]!.id)).rejects.toThrow();
  }, TEN_MINUTES);

  it("finishes the exchange when the bucket is unreachable: the photos are skipped, the products stay", async () => {
    const batch = items.slice(PHOTOS);
    const unreachable = new S3StorageProvider({ ...settings(), endpoint: "http://127.0.0.1:9" });

    await expect(send(exchangeWith(unreachable), "photo-rehearsal-3.xml", batch)).resolves.toEqual({ kind: "success" });

    expect(await journal("photo-rehearsal-3.xml")).toEqual({ images_attached: 0, images_skipped: batch.length, rows_rejected: 0, status: "completed" });
    expect(await stored(batch.map((item) => item.externalId))).toHaveLength(0);
    expect(await count("SELECT count(*)::text AS n FROM app.products WHERE deleted_at IS NULL AND is_active")).toBe(productsBefore);
  }, TEN_MINUTES);
});
