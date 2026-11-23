import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { publicProductName } from "@an30/contracts";
import { fileTypeFromBuffer } from "file-type";
import type { PoolClient } from "pg";
import { z } from "zod";

import { PRODUCT_PHOTO_STORAGE, type ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import type { StoredObject } from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import {
  MalwareDetectedError,
  MalwareScannerService,
  MalwareScannerUnavailableError,
} from "../security/malware-scanner.service.js";
import { InvalidMediaError, MediaValidationService } from "../security/media-validation.service.js";
import { ProductPhotoNormalizeError, ProductPhotoNormalizer } from "./product-photo-normalizer.js";

/**
 * Product photos the shop has the right to show (docs/PRODUCT_PHOTOS.md): its own, shot by the staff on a phone
 * straight into the card, and those a manufacturer or supplier allowed in writing, attached by the article in the
 * file name. Every photo says where it came from; any photo is taken down in one step and stays down.
 *
 * Nothing here downloads a picture from anywhere: a photo enters only as a file a member of staff uploads, or with
 * the 1С exchange (one-c-exchange-images.service.ts).
 */
export const PHOTO_SOURCES = ["one_c", "own_photo", "licensed"] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TAKEN_DOWN = "Это фото уже снимали с сайта. Сделайте другой снимок";
const REVOKED = "Разрешение этого источника отозвано: его фото публиковать нельзя";

export const MAX_PHOTO_UPLOAD_BYTES = 15 * 1024 * 1024;

export interface PhotoUpload {
  content: Buffer;
  fileName: string;
}

const QueueQuery = z.object({
  inStock: z.enum(["true", "false"]).default("true"),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  search: z.string().trim().max(120).default(""),
});

const ImagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  search: z.string().trim().max(120).default(""),
  source: z.enum(PHOTO_SOURCES).optional(),
});

const RightsSourceBody = z.object({
  basis: z.string().trim().min(5).max(1_000),
  name: z.string().trim().min(2).max(200),
});

const ReasonBody = z.object({ reason: z.string().trim().min(3).max(1_000) });

const UploadQuery = z.object({ rightsSourceId: z.uuid().optional() });

const Id = z.uuid();

interface StoredFile { provider: string; storage_key: string }

interface ProductRow {
  available: string;
  brand: string | null;
  category: string | null;
  external_id: string;
  id: string;
  name: string;
  sku: string;
  total?: string;
}

const PRODUCT_COLUMNS = `product.id,product.external_id,product.sku::text AS sku,product.name,brand.name AS brand,
  category.name AS category,GREATEST(COALESCE(stock.available,0),0)::text AS available`;

const PRODUCT_JOINS = `LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
  LEFT JOIN app.categories AS category ON category.id=product.category_id
  LEFT JOIN LATERAL (
    SELECT sum(balance.quantity_on_hand-balance.quantity_reserved)::bigint AS available
    FROM app.inventory_balances AS balance WHERE balance.product_id=product.id
  ) AS stock ON true`;

const LIVE = "product.deleted_at IS NULL AND NOT product.is_demo";

function productView(row: ProductRow) {
  return {
    availableQuantity: Number(row.available),
    brand: row.brand,
    category: row.category,
    code: row.external_id,
    id: row.id,
    name: row.name,
    shownName: publicProductName(row.name, row.sku),
    sku: row.sku,
  };
}

/**
 * The article a file of a manufacturer's pack is named after: «W914-2.jpg» → «W914-2», and for the second and
 * later pictures of one part «W914-2_2.jpg», «W914-2 (3).jpg» → «W914-2» as well. A «-2» is left alone: it is
 * part of real articles far more often than a picture number.
 */
export function articlesFromFileName(fileName: string): string[] {
  const stem = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{2,5}$/i, "").trim();
  if (!stem) return [];
  const numbered = stem.replace(/(?:_\d{1,2}|\s*\(\d{1,2}\))$/, "").trim();
  return numbered && numbered !== stem ? [stem, numbered] : [stem];
}

@Injectable()
export class ProductPhotosService {
  private readonly logger = new Logger(ProductPhotosService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly malwareScanner: MalwareScannerService,
    private readonly mediaValidation: MediaValidationService,
    private readonly normalizer: ProductPhotoNormalizer,
    @Inject(PRODUCT_PHOTO_STORAGE) private readonly photos: ProductPhotoStorage,
  ) {}

  /** How much of the catalogue has a photo, and where the photos came from. */
  async summary() {
    const row = (await this.database.query<{
      in_stock: string; in_stock_without: string; licensed: string; one_c: string; own_photo: string;
      products: string; withdrawn: string; without: string;
    }>(`
      WITH product AS (
        SELECT product.id,
          EXISTS (SELECT 1 FROM app.product_images AS image WHERE image.product_id=product.id) AS has_photo,
          COALESCE((SELECT sum(balance.quantity_on_hand-balance.quantity_reserved)
            FROM app.inventory_balances AS balance WHERE balance.product_id=product.id),0)>0 AS in_stock
        FROM app.products AS product WHERE ${LIVE}
      )
      SELECT count(*)::text AS products,
        count(*) FILTER (WHERE NOT has_photo)::text AS without,
        count(*) FILTER (WHERE in_stock)::text AS in_stock,
        count(*) FILTER (WHERE in_stock AND NOT has_photo)::text AS in_stock_without,
        (SELECT count(*) FROM app.product_images WHERE source='one_c')::text AS one_c,
        (SELECT count(*) FROM app.product_images WHERE source='own_photo')::text AS own_photo,
        (SELECT count(*) FROM app.product_images WHERE source='licensed')::text AS licensed,
        (SELECT count(*) FROM app.product_image_withdrawals)::text AS withdrawn
      FROM product
    `)).rows[0]!;
    return {
      inStock: Number(row.in_stock),
      inStockWithoutPhoto: Number(row.in_stock_without),
      photos: { licensed: Number(row.licensed), one_c: Number(row.one_c), own_photo: Number(row.own_photo) },
      products: Number(row.products),
      withdrawn: Number(row.withdrawn),
      withoutPhoto: Number(row.without),
    };
  }

  /**
   * What to photograph next: products without a photo, by default only those on the shelf, section by section and
   * by name inside one — the order the goods lie in, so the queue is walked along the shelves, not across the shop.
   */
  async queue(rawQuery: unknown) {
    const parsed = QueueQuery.safeParse(rawQuery ?? {});
    if (!parsed.success) throw new BadRequestException({ error: "invalid_photo_query", issues: parsed.error.issues });
    const { inStock, limit, offset, search } = parsed.data;
    const rows = (await this.database.query<ProductRow>(`
      SELECT ${PRODUCT_COLUMNS},count(*) OVER ()::text AS total
      FROM app.products AS product ${PRODUCT_JOINS}
      WHERE ${LIVE}
        AND NOT EXISTS (SELECT 1 FROM app.product_images AS image WHERE image.product_id=product.id)
        AND ($1::boolean IS NOT TRUE OR COALESCE(stock.available,0)>0)
        AND ($2='' OR product.name ILIKE '%'||$2||'%' OR product.external_id=$2
          OR (app.normalize_article($2)<>'' AND product.sku_normalized LIKE app.normalize_article($2)||'%'))
      ORDER BY category.name NULLS LAST,product.name,product.id
      LIMIT $3 OFFSET $4
    `, [inStock === "true", search.replace(/[%_\\]/g, "\\$&"), limit, offset])).rows;
    return { items: rows.map(productView), limit, offset, total: Number(rows[0]?.total ?? 0) };
  }

  /** The shop's own photo of one product, or — with `rightsSourceId` — a picture its right holder allowed. */
  async attach(rawProductId: unknown, rawQuery: unknown, upload: PhotoUpload | undefined, auth: AuthContext) {
    const productId = Id.safeParse(rawProductId);
    if (!productId.success) throw new NotFoundException("Товар не найден");
    const rightsSourceId = this.rightsSourceId(rawQuery);
    const product = (await this.database.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM app.products AS product ${PRODUCT_JOINS} WHERE product.id=$1 AND ${LIVE}`,
      [productId.data],
    )).rows[0];
    if (!product) throw new NotFoundException("Товар не найден");
    return { ...(await this.store(product, upload, rightsSourceId, auth)), product: productView(product) };
  }

  /**
   * A file of a pack, attached to the product whose article (or 1С code) the file is named after. Only when exactly
   * one product answers to it: two cards with one article are for a person to tell apart, so the file is returned
   * with both and attached to neither.
   */
  async attachByFileName(rawQuery: unknown, upload: PhotoUpload | undefined, auth: AuthContext) {
    if (!upload) throw new BadRequestException("Файл не передан");
    const rightsSourceId = this.rightsSourceId(rawQuery);
    for (const article of articlesFromFileName(upload.fileName)) {
      const found = (await this.database.query<ProductRow>(`
        SELECT ${PRODUCT_COLUMNS} FROM app.products AS product ${PRODUCT_JOINS}
        WHERE ${LIVE} AND (product.external_id=$1
          OR (app.normalize_article($1)<>'' AND product.sku_normalized=app.normalize_article($1)))
        ORDER BY product.name,product.id LIMIT 6
      `, [article])).rows;
      if (found.length === 1) {
        return { ...(await this.store(found[0]!, upload, rightsSourceId, auth)), article, product: productView(found[0]!) };
      }
      if (found.length > 1) {
        return { article, candidates: found.map(productView), fileName: upload.fileName, outcome: "ambiguous" as const };
      }
    }
    return { fileName: upload.fileName, outcome: "not_found" as const };
  }

  /** Photos on the site with where each came from, newest first: the list a takedown starts from. */
  async images(rawQuery: unknown) {
    const parsed = ImagesQuery.safeParse(rawQuery ?? {});
    if (!parsed.success) throw new BadRequestException({ error: "invalid_photo_query", issues: parsed.error.issues });
    const { limit, offset, search, source } = parsed.data;
    const rows = (await this.database.query<{
      code: string; created_at: Date; id: string; name: string; product_id: string; rights_source: string | null;
      sku: string; source: PhotoSource; total: string; uploaded_by: string | null;
    }>(`
      SELECT image.id,image.source::text AS source,image.created_at,product.id AS product_id,product.name,
        product.sku::text AS sku,product.external_id AS code,rights.name AS rights_source,
        COALESCE(uploader.display_name,uploader.email::text) AS uploaded_by,count(*) OVER ()::text AS total
      FROM app.product_images AS image
      JOIN app.products AS product ON product.id=image.product_id
      LEFT JOIN app.image_rights_sources AS rights ON rights.id=image.rights_source_id
      LEFT JOIN app.users AS uploader ON uploader.id=image.uploaded_by
      WHERE ($1::app.product_image_source IS NULL OR image.source=$1)
        AND ($2='' OR product.name ILIKE '%'||$2||'%' OR product.external_id=$2
          OR (app.normalize_article($2)<>'' AND product.sku_normalized LIKE app.normalize_article($2)||'%'))
      ORDER BY image.created_at DESC,image.id
      LIMIT $3 OFFSET $4
    `, [source ?? null, search.replace(/[%_\\]/g, "\\$&"), limit, offset])).rows;
    return {
      items: rows.map((row) => ({
        code: row.code,
        createdAt: row.created_at.toISOString(),
        id: row.id,
        productId: row.product_id,
        rightsSource: row.rights_source,
        shownName: publicProductName(row.name, row.sku),
        sku: row.sku,
        source: row.source,
        uploadedBy: row.uploaded_by,
        url: `/api/v1/catalog/media/${row.id}`,
      })),
      limit,
      offset,
      total: Number(rows[0]?.total ?? 0),
    };
  }

  /**
   * Takes a picture down: from every card that shows this file, at once. The file leaves the storage; what stays
   * is the record (what, whose, why, who) and the refusal to attach the same file again — also when 1С sends it.
   */
  async withdraw(rawImageId: unknown, rawBody: unknown, auth: AuthContext) {
    const imageId = Id.safeParse(rawImageId);
    if (!imageId.success) throw new NotFoundException("Фото не найдено");
    const { reason } = this.reason(rawBody);
    const removed = await this.database.transaction(async (client) => {
      // The same file may be kept twice, once on the disk and once in the bucket: both copies come down.
      const objects = (await client.query<{ id: string }>(
        `SELECT storage.id FROM app.storage_objects AS storage
         WHERE (storage.sha256,storage.byte_size) IN (
           SELECT shown.sha256,shown.byte_size FROM app.product_images AS image
           JOIN app.storage_objects AS shown ON shown.id=image.storage_object_id WHERE image.id=$1
         )
         ORDER BY storage.id FOR UPDATE OF storage`,
        [imageId.data],
      )).rows.map((row) => row.id);
      if (objects.length === 0) throw new NotFoundException("Фото не найдено");
      return this.withdrawObjects(client, objects, reason, auth);
    });
    await this.removeFiles(removed.files);
    return { withdrawn: removed.withdrawn };
  }

  async rightsSources() {
    const rows = (await this.database.query<{
      basis: string; created_at: Date; id: string; name: string; photos: string; revoked_at: Date | null;
    }>(`
      SELECT rights.id,rights.name,rights.basis,rights.created_at,rights.revoked_at,
        (SELECT count(*) FROM app.product_images AS image WHERE image.rights_source_id=rights.id)::text AS photos
      FROM app.image_rights_sources AS rights ORDER BY rights.revoked_at IS NOT NULL,lower(rights.name)
    `)).rows;
    return {
      items: rows.map((row) => ({
        basis: row.basis,
        createdAt: row.created_at.toISOString(),
        id: row.id,
        name: row.name,
        photos: Number(row.photos),
        revokedAt: row.revoked_at?.toISOString() ?? null,
      })),
    };
  }

  /** Who allowed the shop to show their pictures, and the paper that says so: asked for before the first file. */
  async createRightsSource(rawBody: unknown, auth: AuthContext) {
    const parsed = RightsSourceBody.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Укажите, чьи это фото и на каком основании магазин их публикует (письмо, договор)");
    }
    try {
      const id = await this.database.transaction(async (client) => {
        const created = (await client.query<{ id: string }>(
          "INSERT INTO app.image_rights_sources (name,basis,created_by) VALUES ($1,$2,$3) RETURNING id",
          [parsed.data.name, parsed.data.basis, auth.userId],
        )).rows[0]!.id;
        await this.audit.record({
          action: "catalog.photo_rights_source.created", actorRole: auth.role, actorUserId: auth.userId,
          afterState: parsed.data, entityId: created, entityType: "image_rights_source",
        }, client);
        return created;
      });
      return { id };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("Такой источник уже записан");
      throw error;
    }
  }

  /** The permission is over (withdrawn, expired, disputed): every picture published under it comes down with it. */
  async revokeRightsSource(rawId: unknown, rawBody: unknown, auth: AuthContext) {
    const id = Id.safeParse(rawId);
    if (!id.success) throw new NotFoundException("Источник не найден");
    const { reason } = this.reason(rawBody);
    const removed = await this.database.transaction(async (client) => {
      const source = (await client.query<{ name: string }>(
        `UPDATE app.image_rights_sources SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
           revoked_reason=COALESCE(revoked_reason,$2) WHERE id=$1 RETURNING name`,
        [id.data, reason],
      )).rows[0];
      if (!source) throw new NotFoundException("Источник не найден");
      const objects = (await client.query<{ id: string }>(
        `SELECT storage.id FROM app.storage_objects AS storage
         WHERE storage.id IN (SELECT storage_object_id FROM app.product_images WHERE rights_source_id=$1)
         ORDER BY storage.id FOR UPDATE OF storage`,
        [id.data],
      )).rows.map((row) => row.id);
      await this.audit.record({
        action: "catalog.photo_rights_source.revoked", actorRole: auth.role, actorUserId: auth.userId,
        entityId: id.data, entityType: "image_rights_source", metadata: { name: source.name, reason },
      }, client);
      return this.withdrawObjects(client, objects, `Источник «${source.name}» отозван: ${reason}`.slice(0, 1_000), auth, id.data);
    });
    await this.removeFiles(removed.files);
    return { withdrawn: removed.withdrawn };
  }

  private rightsSourceId(rawQuery: unknown): string | undefined {
    const parsed = UploadQuery.safeParse(rawQuery ?? {});
    if (!parsed.success) throw new BadRequestException("Источник фото указан неверно");
    return parsed.data.rightsSourceId;
  }

  private reason(rawBody: unknown) {
    const parsed = ReasonBody.safeParse(rawBody ?? {});
    if (!parsed.success) throw new BadRequestException("Укажите причину: чьё требование или что не так с фото");
    return parsed.data;
  }

  private async takenDown(sha256: Buffer, byteSize: number) {
    return Boolean((await this.database.query(
      `SELECT 1 FROM app.product_image_withdrawals
       WHERE (sha256=$1 AND byte_size=$2) OR (upload_sha256=$1 AND upload_byte_size=$2) LIMIT 1`,
      [sha256, byteSize],
    )).rowCount);
  }

  private async store(product: ProductRow, upload: PhotoUpload | undefined, rightsSourceId: string | undefined, auth: AuthContext) {
    if (!upload) throw new BadRequestException("Файл не передан");
    if (rightsSourceId) {
      const rights = (await this.database.query<{ revoked_at: Date | null }>(
        "SELECT revoked_at FROM app.image_rights_sources WHERE id=$1", [rightsSourceId],
      )).rows[0];
      if (!rights) throw new BadRequestException("Источник фото не найден");
      if (rights.revoked_at) throw new ConflictException(REVOKED);
    }
    // A file taken down is refused both as it was sent and as it is stored: 1С keeps the untouched file, the site the reshaped one.
    const uploadSha256 = createHash("sha256").update(upload.content).digest();
    if (await this.takenDown(uploadSha256, upload.content.length)) throw new ConflictException(TAKEN_DOWN);
    const picture = await this.prepare(upload.content);
    const sha256 = createHash("sha256").update(picture).digest();
    if (await this.takenDown(sha256, picture.length)) throw new ConflictException(TAKEN_DOWN);
    const source: PhotoSource = rightsSourceId ? "licensed" : "own_photo";
    const storage = this.photos.target;
    let stored: StoredObject;
    try {
      stored = await storage.store(picture, "jpg");
    } catch (error) {
      this.logger.warn(`Photo storage "${storage.name}" did not accept a photo: ${error instanceof Error ? error.name : "error"}`);
      throw new ServiceUnavailableException("Хранилище фото не отвечает. Повторите через минуту");
    }
    let removeStored = false;
    try {
      const imageId = await this.database.transaction(async (client) => {
        if (rightsSourceId) {
          // The permission may have been revoked while the file was being checked; the lock makes the two wait for each
          // other. It is taken before the file's row, in the order a revocation takes them, so the two cannot deadlock.
          const rights = (await client.query<{ revoked_at: Date | null }>(
            "SELECT revoked_at FROM app.image_rights_sources WHERE id=$1 FOR SHARE", [rightsSourceId],
          )).rows[0];
          if (!rights || rights.revoked_at) throw new ConflictException(REVOKED);
        }
        // Same adoption of an object already stored (or stored once and deleted) as the 1С exchange does.
        const object = (await client.query<{ id: string; status: string; storage_key: string }>(
          `INSERT INTO app.storage_objects (provider,storage_key,original_name,mime_type,byte_size,sha256,status,owner_user_id)
           VALUES ($1,$2,$3,'image/jpeg',$4,$5,'available',$6)
           ON CONFLICT (provider,sha256,byte_size) DO UPDATE SET
             storage_key=CASE WHEN app.storage_objects.status='deleted' THEN EXCLUDED.storage_key ELSE app.storage_objects.storage_key END,
             status=CASE WHEN app.storage_objects.status='deleted' THEN 'available'::app.storage_status ELSE app.storage_objects.status END,
             deleted_at=CASE WHEN app.storage_objects.status='deleted' THEN NULL ELSE app.storage_objects.deleted_at END,
             updated_at=clock_timestamp()
           RETURNING id,storage_key,status::text`,
          [storage.name, stored.storageKey, `${source}:${upload.fileName}`.slice(0, 255), picture.length, sha256, auth.userId],
        )).rows[0]!;
        removeStored = object.storage_key !== stored.storageKey;
        if (object.status !== "available") throw new ConflictException(TAKEN_DOWN);
        const image = (await client.query<{ id: string }>(
          `INSERT INTO app.product_images
             (product_id,storage_object_id,alt_text,sort_order,is_primary,source,rights_source_id,uploaded_by,upload_sha256,upload_byte_size)
           VALUES ($1,$2,$3,
             COALESCE((SELECT max(sort_order)+1 FROM app.product_images WHERE product_id=$1),0),
             NOT EXISTS (SELECT 1 FROM app.product_images WHERE product_id=$1 AND is_primary),
             $4,$5,$6,$7,$8)
           ON CONFLICT (product_id,storage_object_id) DO NOTHING RETURNING id`,
          [product.id, object.id, product.name, source, rightsSourceId ?? null, auth.userId, uploadSha256, upload.content.length],
        )).rows[0];
        if (!image) return undefined;
        await this.audit.record({
          action: "catalog.product_photo.attached", actorRole: auth.role, actorUserId: auth.userId,
          entityId: image.id, entityType: "product_image",
          metadata: { fileName: upload.fileName.slice(0, 255), productExternalId: product.external_id, rightsSourceId: rightsSourceId ?? null, source },
        }, client);
        return image.id;
      });
      if (!imageId) return { outcome: "unchanged" as const };
      return { imageId, outcome: "attached" as const, source, url: `/api/v1/catalog/media/${imageId}` };
    } catch (error) {
      removeStored = true;
      throw error;
    } finally {
      if (removeStored) await storage.remove(stored.storageKey).catch(() => undefined);
    }
  }

  /** A file from the outside becomes a product photo: checked like any upload, then given the one shape of the catalogue. */
  private async prepare(content: Buffer): Promise<Buffer> {
    if (content.length === 0 || content.length > MAX_PHOTO_UPLOAD_BYTES) {
      throw new BadRequestException("Допустимый размер фото: до 15 МБ");
    }
    const detected = await fileTypeFromBuffer(content);
    if (!detected || !ACCEPTED_TYPES.has(detected.mime)) {
      throw new BadRequestException("Подходят снимки JPEG, PNG и WebP");
    }
    try {
      await this.malwareScanner.assertClean(content);
      await this.mediaValidation.assertValid(content, detected.mime);
      return await this.normalizer.normalize(content);
    } catch (error) {
      if (error instanceof MalwareDetectedError) throw new BadRequestException("Файл отклонён проверкой безопасности");
      if (error instanceof MalwareScannerUnavailableError) throw new ServiceUnavailableException("Проверка файлов временно недоступна");
      if (error instanceof InvalidMediaError || error instanceof ProductPhotoNormalizeError) {
        throw new BadRequestException("Файл не читается как фотография. Сделайте снимок ещё раз");
      }
      throw error;
    }
  }

  private async withdrawObjects(client: PoolClient, objectIds: string[], reason: string, auth: AuthContext, rightsSourceId?: string) {
    if (objectIds.length === 0) return { files: [] as StoredFile[], withdrawn: 0 };
    // Under a revoked source only that source's use of a file comes down; a takedown of a picture takes every use.
    const rows = (await client.query<{ id: string; product_id: string }>(
      `WITH removed AS (
         DELETE FROM app.product_images AS image
         WHERE image.storage_object_id=ANY($1::uuid[]) AND ($4::uuid IS NULL OR image.rights_source_id=$4)
         RETURNING image.*
       )
       INSERT INTO app.product_image_withdrawals
         (sha256,byte_size,upload_sha256,upload_byte_size,product_id,product_external_id,source,rights_source_id,original_name,published_at,reason,withdrawn_by)
       SELECT storage.sha256,storage.byte_size,removed.upload_sha256,removed.upload_byte_size,removed.product_id,product.external_id,removed.source,
         removed.rights_source_id,storage.original_name,removed.created_at,$2,$3
       FROM removed
       JOIN app.storage_objects AS storage ON storage.id=removed.storage_object_id
       JOIN app.products AS product ON product.id=removed.product_id
       RETURNING id,product_id`,
      [objectIds, reason, auth.userId, rightsSourceId ?? null],
    )).rows;
    // A card that lost its main picture shows the next one it has.
    await client.query(
      `UPDATE app.product_images AS image SET is_primary=true
       WHERE image.id IN (
         SELECT DISTINCT ON (next.product_id) next.id FROM app.product_images AS next
         WHERE next.product_id=ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM app.product_images AS main WHERE main.product_id=next.product_id AND main.is_primary)
         ORDER BY next.product_id,next.sort_order,next.created_at,next.id
       )`,
      [rows.map((row) => row.product_id)],
    );
    const files = (await client.query<StoredFile>(
      `UPDATE app.storage_objects AS storage SET status='quarantined',updated_at=clock_timestamp()
       WHERE storage.id=ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM app.product_images AS image WHERE image.storage_object_id=storage.id)
       RETURNING storage.provider,storage.storage_key`,
      [objectIds],
    )).rows;
    await this.audit.record({
      action: "catalog.product_photo.withdrawn", actorRole: auth.role, actorUserId: auth.userId,
      entityType: "product_image", metadata: { photos: rows.length, reason, rightsSourceId: rightsSourceId ?? null },
    }, client);
    return { files, withdrawn: rows.length };
  }

  /** A file is removed from the storage that holds it — the disk or the bucket (docs/PRODUCT_PHOTOS_S3.md). */
  private async removeFiles(files: StoredFile[]) {
    for (const file of files) {
      try {
        const storage = this.photos.provider(file.provider);
        if (!storage) throw new Error(`storage "${file.provider}" is not connected`);
        await storage.remove(file.storage_key);
      } catch (error) {
        // The picture is already off the site and cannot come back; the leftover file is named for whoever cleans up.
        this.logger.warn(`Withdrawn photo file ${file.provider}:${file.storage_key} was not removed: ${error instanceof Error ? error.message : "error"}`);
      }
    }
  }
}
