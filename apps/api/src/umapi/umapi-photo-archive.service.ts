import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";

import { ProductPhotoNormalizer } from "../catalog/product-photo-normalizer.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { MalwareScannerService } from "../security/malware-scanner.service.js";
import { MediaValidationService } from "../security/media-validation.service.js";
import type { UmapiMedia } from "./umapi-normalize.js";
import type { UmapiPart } from "./umapi.service.js";
import { UmapiGateway } from "./umapi.gateway.js";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_JPEG_BYTES = 4 * 1024 * 1024;
const PhotoQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  search: z.string().trim().max(160).default(""),
});

const CURRENT_PHOTOS = `FROM app.umapi_product_photos AS photo
  JOIN app.products AS product ON product.id=photo.product_id AND product.sku=photo.product_sku
    AND product.is_active AND product.deleted_at IS NULL
  JOIN app.brands AS brand ON brand.id=product.brand_id AND brand.name=photo.product_brand
    AND brand.is_active AND brand.deleted_at IS NULL`;

export function mediaUrlInCatalogue(value: string, mediaBase: string): string | null {
  try {
    const base = new URL(mediaBase);
    const target = new URL(value);
    const path = base.pathname.replace(/\/+$/u, "") + "/";
    const safeProtocol = base.protocol === "https:"
      || (base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
    return safeProtocol && target.origin === base.origin && target.pathname.startsWith(path)
      && !target.username && !target.password && !target.hash ? target.href : null;
  } catch {
    return null;
  }
}

export function cataloguePhotoUrls(media: UmapiMedia[], mediaBase: string): string[] {
  const photos = new Set<string>();
  for (const { file, supId } of media) {
    const segments = file.split("/");
    if (segments.some((part) => part === "." || part === ".." || part.includes("\\"))) continue;
    const supplierPath = supId === null ? "" : `${supId}/`;
    const explicitUrl = /^[a-z][a-z0-9+.-]*:/iu.test(file);
    const url = mediaUrlInCatalogue(explicitUrl ? file : `${mediaBase}/${supplierPath}${segments.map(encodeURIComponent).join("/")}`, mediaBase);
    if (url) photos.add(url);
  }
  return [...photos];
}

async function readPhoto(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  const input = response.body?.getReader();
  if (!input) throw new Error("empty response");
  try {
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error("media unavailable or too large");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await input.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > MAX_FILE_BYTES) throw new Error("media too large");
      chunks.push(value);
    }
  } finally {
    await input.cancel().catch(() => undefined);
  }
}

@Injectable()
export class UmapiPhotoArchiveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly gateway: UmapiGateway,
    private readonly malware: MalwareScannerService,
    private readonly validation: MediaValidationService,
    private readonly normalizer: ProductPhotoNormalizer,
  ) {}

  async remember(product: { brand: string; id: string; sku: string }, part: UmapiPart, urls: string[]): Promise<void> {
    await this.database.query(
      `INSERT INTO app.umapi_product_photos
        (product_id, product_sku, product_brand, catalogue_article_id, catalogue_article, catalogue_brand, media_url)
       SELECT $1, $2, $3, $4, $5, $6, media_url FROM unnest($7::text[]) AS urls(media_url)
       ON CONFLICT (product_id, product_sku, product_brand, catalogue_article_id, media_url)
       DO UPDATE SET seen_at=clock_timestamp()`,
      [product.id, product.sku, product.brand, part.artId, part.article, part.brand, urls],
    );
  }

  async list(input: unknown) {
    const parsed = PhotoQuery.safeParse(input);
    if (!parsed.success) throw new BadRequestException("Проверьте параметры списка фото");
    const { limit, offset, search } = parsed.data;
    const where = `WHERE ($1 = '' OR strpos(lower(product.name), lower($1)) > 0
      OR strpos(lower(product.sku), lower($1)) > 0 OR strpos(lower(product.external_id), lower($1)) > 0)`;
    const [items, count] = await Promise.all([
      this.database.query<{
        id: string; article: string; brand: string; sku: string; name: string; externalId: string | null;
        source: string; saved: boolean; oneCSource: string;
      }>(
        `SELECT photo.id, photo.catalogue_article AS article, photo.catalogue_brand AS brand,
          product.sku, product.name, product.external_id AS "externalId", product.one_c_source AS "oneCSource",
          photo.media_url AS source, photo.saved_at IS NOT NULL AS saved
         ${CURRENT_PHOTOS} ${where} ORDER BY photo.seen_at DESC, photo.id LIMIT $2 OFFSET $3`,
        [search, limit, offset],
      ),
      this.database.query<{ total: string }>(`SELECT count(*)::text AS total ${CURRENT_PHOTOS} ${where}`, [search]),
    ]);
    const base = this.gateway.mediaBaseUrl;
    return {
      items: items.rows.map(({ source, ...item }) => ({ ...item, source: base ? mediaUrlInCatalogue(source, base) : null })),
      limit, offset, total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async save(id: string) {
    const current = (await this.database.query<{ saved: boolean; url: string }>(
      `SELECT photo.saved_at IS NOT NULL AS saved, photo.media_url AS url ${CURRENT_PHOTOS} WHERE photo.id=$1`, [id],
    )).rows[0];
    if (!current) throw new NotFoundException("Фото не найдено для текущего артикула");
    if (current.saved) return { saved: true };
    const base = this.gateway.mediaBaseUrl;
    const url = base && mediaUrlInCatalogue(current.url, base);
    if (!url) throw new BadGatewayException("Адрес фото UMAPI недоступен");
    let jpeg: Buffer;
    try {
      const raw = await readPhoto(url);
      const type = await fileTypeFromBuffer(raw);
      if (!type || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type.mime)) throw new Error("invalid image type");
      await this.malware.assertClean(raw);
      await this.validation.assertValid(raw, type.mime);
      jpeg = await this.normalizer.normalize(raw);
      if (jpeg.length > MAX_JPEG_BYTES || jpeg.length === 0) throw new Error("invalid jpeg size");
    } catch {
      throw new BadGatewayException("Не удалось сохранить фото UMAPI. Проверьте оригинал и повторите попытку.");
    }
    const updated = await this.database.query(
      `UPDATE app.umapi_product_photos SET jpeg=COALESCE(jpeg,$2), saved_at=COALESCE(saved_at,clock_timestamp())
       WHERE id=$1 AND id IN (SELECT photo.id ${CURRENT_PHOTOS} WHERE photo.id=$1)`,
      [id, jpeg],
    );
    if (updated.rowCount !== 1) throw new NotFoundException("Товар изменился. Запросите фото ещё раз.");
    return { saved: true };
  }

  async file(id: string) {
    const row = (await this.database.query<{ jpeg: Buffer; code: string | null; sku: string }>(
      `SELECT photo.jpeg, product.external_id AS code, product.sku ${CURRENT_PHOTOS}
       WHERE photo.id=$1 AND photo.saved_at IS NOT NULL`, [id],
    )).rows[0];
    if (!row) throw new NotFoundException("Сохранённое фото не найдено");
    const code = (row.code || row.sku).replace(/[^a-z0-9_-]+/giu, "-").slice(0, 100) || "part";
    return { bytes: row.jpeg, name: `${code}-an30-umapi-${id.slice(0, 8)}.jpg` };
  }
}
