// Attaches <Картинка> files of a CommerceML import.xml to products. 1C
// uploads the image files with mode=file in the same session (relative paths
// such as "import_files/ab/abcd.jpg"), before it calls mode=import for the
// XML, so they are read back from the exchange's temp storage here.
//
// Every image goes through the same gate as a chat attachment before it can
// become public: signature sniffing (JPEG/PNG/WebP only), ClamAV and the
// media probe. An image that cannot pass -- missing file, wrong type, scanner
// unavailable -- is skipped and counted, never fatal to the exchange: 1C
// would otherwise abort the whole price/stock update over one photo.
import { createHash } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";

import { PRODUCT_PHOTO_STORAGE, type ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import type { StoredObject } from "../adapters/provider-contracts.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { MalwareScannerService } from "../security/malware-scanner.service.js";
import { MediaValidationService } from "../security/media-validation.service.js";
import { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";
import { sourceSql, type OneCSource } from "./one-c-source.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// After a failed store the photo storage is left alone this long.
const STORAGE_RETRY_PAUSE_MS = 60_000;
const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export type ImageAttachOutcome = "attached" | "skipped" | "unchanged";

export interface ImageTask {
  path: string;
  productExternalId: string;
  sortOrder: number;
}

@Injectable()
export class OneCExchangeImagesService {
  private readonly logger = new Logger(OneCExchangeImagesService.name);
  private storagePausedUntil = 0;

  constructor(
    private readonly database: DatabaseService,
    private readonly tempStorage: OneCExchangeTempStorageService,
    @Inject(PRODUCT_PHOTO_STORAGE) private readonly photos: ProductPhotoStorage,
    private readonly malwareScanner: MalwareScannerService,
    private readonly mediaValidation: MediaValidationService,
  ) {}

  async attach(task: ImageTask, source: OneCSource): Promise<ImageAttachOutcome> {
    if (/-an30-umapi-[0-9a-f]{8}\.jpe?g$/iu.test(task.path)) return this.skip(task, "internal UMAPI photo");
    const product = (await this.database.query<{ id: string; name: string }>(
      `SELECT id, name FROM app.products
       WHERE external_id = $1 AND one_c_source = ${sourceSql(source)} AND deleted_at IS NULL`,
      [task.productExternalId],
    )).rows[0];
    if (!product) return "skipped";

    let content: Buffer;
    try {
      content = await this.tempStorage.readAssembled(task.path, source, MAX_IMAGE_BYTES);
    } catch (error) {
      if (error instanceof RangeError) return this.skip(task, "size");
      // A later exchange may reference a photo it does not upload again;
      // the copy attached from the same 1C path earlier is still current.
      const known = (await this.database.query(
        `SELECT 1 FROM app.product_images AS image
         JOIN app.storage_objects AS storage ON storage.id = image.storage_object_id
         WHERE image.product_id = $1 AND storage.original_name = $2 AND storage.status = 'available'`,
        [product.id, `1c:${task.path}`.slice(0, 255)],
      )).rowCount;
      if (known) return "unchanged";
      return this.skip(task, "file was not uploaded with mode=file");
    }
    if (content.length === 0) return this.skip(task, "size");
    const detected = await fileTypeFromBuffer(content);
    const extension = detected ? IMAGE_EXTENSIONS.get(detected.mime) : undefined;
    if (!detected || !extension) return this.skip(task, "not a JPEG/PNG/WebP image");

    const sha256 = createHash("sha256").update(content).digest();
    const alreadyAttached = (await this.database.query(
      `SELECT 1 FROM app.product_images AS image
       JOIN app.storage_objects AS storage ON storage.id = image.storage_object_id
       WHERE image.product_id = $1 AND storage.sha256 = $2 AND storage.byte_size = $3
         AND storage.status = 'available' AND storage.deleted_at IS NULL`,
      [product.id, sha256, content.length],
    )).rowCount;
    if (alreadyAttached) return "unchanged";

    // A photo taken down on a rights claim stays down (docs/PRODUCT_PHOTOS.md): 1С keeps sending the file it has.
    const withdrawn = (await this.database.query(
      `SELECT 1 FROM app.product_image_withdrawals
       WHERE (sha256 = $1 AND byte_size = $2) OR (upload_sha256 = $1 AND upload_byte_size = $2)
       UNION ALL
       SELECT 1 FROM app.umapi_product_photos WHERE jpeg IS NOT NULL AND digest(jpeg, 'sha256') = $1 LIMIT 1`,
      [sha256, content.length],
    )).rowCount;
    if (withdrawn) return this.skip(task, "the photo was withdrawn or is internal UMAPI media");

    try {
      await this.malwareScanner.assertClean(content);
      await this.mediaValidation.assertValid(content, detected.mime);
    } catch (error) {
      return this.skip(task, error instanceof Error ? error.constructor.name : "validation failed");
    }

    const storage = this.photos.target;
    // A bucket that stopped answering costs a full timeout per photo; the rest
    // of the exchange's photos must not each wait for it while imports queue.
    if (Date.now() < this.storagePausedUntil) {
      return this.skip(task, `photo storage "${storage.name}" is not answering`);
    }
    let stored: StoredObject;
    try {
      stored = await storage.store(content, extension);
    } catch (error) {
      // An unreachable bucket must not abort the price and stock update.
      this.storagePausedUntil = Date.now() + STORAGE_RETRY_PAUSE_MS;
      return this.skip(task, `photo storage "${storage.name}" did not accept it (${error instanceof Error ? error.name : "error"})`);
    }
    let removeStored = false;
    try {
      const outcome = await this.database.transaction(async (client) => {
        const object = (await client.query<{ id: string; status: string; storage_key: string }>(
          `INSERT INTO app.storage_objects (provider, storage_key, original_name, mime_type, byte_size, sha256, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'available')
           ON CONFLICT (provider, sha256, byte_size) DO UPDATE SET
             storage_key = CASE WHEN app.storage_objects.status = 'deleted'
               THEN EXCLUDED.storage_key ELSE app.storage_objects.storage_key END,
             status = CASE WHEN app.storage_objects.status = 'deleted'
               THEN 'available'::app.storage_status ELSE app.storage_objects.status END,
             deleted_at = CASE WHEN app.storage_objects.status = 'deleted'
               THEN NULL ELSE app.storage_objects.deleted_at END,
             updated_at = clock_timestamp()
           RETURNING id, storage_key, status::text`,
          [storage.name, stored.storageKey, `1c:${task.path}`.slice(0, 255), detected.mime, content.length, sha256],
        )).rows[0]!;
        removeStored = object.storage_key !== stored.storageKey;
        if (object.status !== "available") return "skipped" as const;
        await client.query(
          `INSERT INTO app.product_images (product_id, storage_object_id, alt_text, sort_order, is_primary)
           VALUES ($1, $2, $3, $4,
             NOT EXISTS (SELECT 1 FROM app.product_images WHERE product_id = $1 AND is_primary))
           ON CONFLICT (product_id, storage_object_id) DO NOTHING`,
          [product.id, object.id, product.name, task.sortOrder],
        );
        return "attached" as const;
      });
      return outcome;
    } catch (error) {
      removeStored = true;
      throw error;
    } finally {
      if (removeStored) await storage.remove(stored.storageKey).catch(() => undefined);
    }
  }

  private skip(task: ImageTask, reason: string): ImageAttachOutcome {
    this.logger.warn(`1C image ${task.path} skipped: ${reason}`);
    return "skipped";
  }
}
