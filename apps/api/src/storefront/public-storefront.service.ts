import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";

import { STORAGE_PROVIDER, type StorageProvider } from "../adapters/provider-contracts.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { etagMatches, withPublicMediaRead } from "../security/public-media.js";
import {
  ContactRequestSchema,
  PublicBannersQuerySchema,
  PublicContentSlugSchema,
  PublicObjectIdSchema,
  type ContactRequest,
} from "./storefront.schemas.js";

interface RequestMetadata {
  ipAddress: string;
  userAgent?: string;
}

interface SettingRow {
  key: string;
  value: unknown;
}

interface ContentRow {
  body: unknown;
  published_at: Date | null;
  seo_description: string | null;
  seo_title: string | null;
  slug: string;
  title: string;
  updated_at: Date;
  version: number;
}

interface BannerRow {
  body: string | null;
  ends_at: Date | null;
  id: string;
  image_object_id: string | null;
  starts_at: Date | null;
  target_url: string | null;
  title: string;
}

interface PublicMediaRow {
  byte_size: string;
  mime_type: string;
  sha256: Buffer;
  storage_key: string;
}

interface ContactRow {
  created_at: Date;
  id: string;
  request_hash: Buffer;
  status: string;
}

const MAX_PUBLIC_MEDIA_BYTES = 10 * 1024 * 1024;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

function safeTargetUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : null;
}

function requestHash(body: ContactRequest): Buffer {
  return createHash("sha256").update(JSON.stringify({
    consent: body.consent,
    email: body.email ?? null,
    message: body.message,
    name: body.name,
    phone: body.phone ?? null,
    policyVersion: body.policyVersion,
    source: body.source,
  })).digest();
}

@Injectable()
export class PublicStorefrontService {
  private readonly legalDocumentsApproved: boolean;

  constructor(
    private readonly audit: AuditService,
    config: ConfigService,
    private readonly database: DatabaseService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    this.legalDocumentsApproved = config.getOrThrow<boolean>("LEGAL_DOCUMENTS_APPROVED");
  }

  async settings() {
    const rows = (await this.database.query<SettingRow>(
      "SELECT key,value FROM app.site_settings WHERE is_public ORDER BY key",
    )).rows;
    return { settings: Object.fromEntries(rows.map((row) => [row.key, row.value])) };
  }

  async content(slugInput: string) {
    const slug = parse(PublicContentSlugSchema, slugInput);
    const row = (await this.database.query<ContentRow>(
      `SELECT slug::text,title,body,seo_title,seo_description,version,published_at,updated_at
       FROM app.content_pages
       WHERE slug=$1 AND is_published AND published_at IS NOT NULL
         AND published_at<=clock_timestamp() AND deleted_at IS NULL`,
      [slug],
    )).rows[0];
    if (!row) throw new NotFoundException("Страница не найдена");
    return {
      body: row.body,
      publishedAt: row.published_at?.toISOString() ?? null,
      seo: { description: row.seo_description, title: row.seo_title },
      slug: row.slug,
      title: row.title,
      updatedAt: row.updated_at.toISOString(),
      version: row.version,
    };
  }

  async banners(input: unknown) {
    const query = parse(PublicBannersQuerySchema, input);
    const rows = (await this.database.query<BannerRow>(
      `SELECT id,title,body,image_object_id,target_url,starts_at,ends_at
       FROM app.banners
       WHERE placement=$1 AND is_active AND deleted_at IS NULL
         AND (starts_at IS NULL OR starts_at<=clock_timestamp())
         AND (ends_at IS NULL OR ends_at>clock_timestamp())
       ORDER BY sort_order,created_at,id LIMIT 20`,
      [query.placement],
    )).rows;
    return {
      items: rows.map((row) => ({
        body: row.body,
        endsAt: row.ends_at?.toISOString() ?? null,
        id: row.id,
        imageUrl: row.image_object_id ? `/api/v1/public/media/${row.image_object_id}` : null,
        startsAt: row.starts_at?.toISOString() ?? null,
        targetUrl: safeTargetUrl(row.target_url),
        title: row.title,
      })),
    };
  }

  async media(objectIdInput: string, ifNoneMatch?: string) {
    const objectId = parse(PublicObjectIdSchema, objectIdInput);
    const row = (await this.database.query<PublicMediaRow>(
      `SELECT storage.storage_key,storage.mime_type,storage.byte_size::text,storage.sha256
       FROM app.storage_objects AS storage
       WHERE storage.id=$1 AND storage.provider=$2
         AND storage.status='available' AND storage.deleted_at IS NULL
         AND storage.mime_type IN ('image/avif','image/jpeg','image/png','image/webp')
         AND EXISTS (
           SELECT 1 FROM app.banners AS banner
           WHERE banner.image_object_id=storage.id AND banner.is_active AND banner.deleted_at IS NULL
             AND (banner.starts_at IS NULL OR banner.starts_at<=clock_timestamp())
             AND (banner.ends_at IS NULL OR banner.ends_at>clock_timestamp())
         )`,
      [objectId, this.storage.name],
    )).rows[0];
    if (!row) throw new NotFoundException("Изображение не найдено");
    const expectedSize = Number(row.byte_size);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1
      || expectedSize > MAX_PUBLIC_MEDIA_BYTES || row.sha256.length !== 32) {
      throw new NotFoundException("Изображение недоступно");
    }

    const etag = `"sha256-${row.sha256.toString("base64url")}"`;
    if (etagMatches(ifNoneMatch, etag)) {
      return { content: null, etag, mimeType: row.mime_type };
    }

    return withPublicMediaRead(async () => {
      let content: Buffer;
      try {
        content = await this.storage.read(row.storage_key);
      } catch {
        throw new NotFoundException("Изображение не найдено");
      }
      if (content.byteLength !== expectedSize) {
        throw new InternalServerErrorException("Размер изображения не совпадает");
      }
      const digest = createHash("sha256").update(content).digest();
      if (!digest.equals(row.sha256)) {
        throw new InternalServerErrorException("Контрольная сумма изображения не совпадает");
      }
      const detected = await fileTypeFromBuffer(content);
      if (!detected || detected.mime !== row.mime_type) {
        throw new InternalServerErrorException("Сигнатура изображения не совпадает");
      }
      return { content, etag, mimeType: row.mime_type };
    });
  }

  async createContactRequest(input: unknown, metadata: RequestMetadata) {
    if (!this.legalDocumentsApproved) {
      throw new ServiceUnavailableException(
        "Приём персональных данных откроется после публикации утверждённых документов",
      );
    }
    const body = parse(ContactRequestSchema, input);
    const hash = requestHash(body);
    return this.database.transaction(async (client) => {
      const inserted = (await client.query<ContactRow>(
        `INSERT INTO app.contact_requests
           (idempotency_key,request_hash,source,customer_name,customer_email,customer_phone,message,
            consent_at,consent_policy_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),$8)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id,status,request_hash,created_at`,
        [
          body.idempotencyKey,
          hash,
          body.source,
          body.name,
          body.email ?? null,
          body.phone ?? null,
          body.message,
          body.policyVersion,
        ],
      )).rows[0];
      if (!inserted) {
        const existing = (await client.query<ContactRow>(
          `SELECT id,status,request_hash,created_at FROM app.contact_requests
           WHERE idempotency_key=$1`,
          [body.idempotencyKey],
        )).rows[0];
        if (!existing) throw new ConflictException("Не удалось проверить повтор запроса");
        if (!existing.request_hash.equals(hash)) {
          throw new ConflictException("Этот ключ уже использован для другого обращения");
        }
        return this.contactView(existing, true);
      }

      await client.query(
        `INSERT INTO app.outbox_events (topic,aggregate_type,aggregate_id,payload)
         VALUES ('contact.staff.notify','contact_request',$1,$2::jsonb)`,
        [inserted.id, JSON.stringify({ requestId: inserted.id, source: body.source })],
      );
      await this.audit.record({
        action: "contact.request.created",
        entityId: inserted.id,
        entityType: "contact_request",
        ipAddress: metadata.ipAddress,
        metadata: { source: body.source },
        userAgent: metadata.userAgent,
      }, client);
      return this.contactView(inserted, false);
    });
  }

  private contactView(row: ContactRow, replayed: boolean) {
    return {
      createdAt: row.created_at.toISOString(),
      id: row.id,
      message: "Обращение принято. Мы свяжемся с вами по указанным контактам",
      replayed,
      status: row.status,
    };
  }
}
