import { createHash } from "node:crypto";

import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import { PublicStorefrontService } from "./public-storefront.service.js";

const REQUEST_ID = "019bf9ea-0d3e-7def-8c9a-000000000001";
const IDEMPOTENCY_KEY = "019bf9ea-0d3e-7def-8c9a-000000000002";
const OBJECT_ID = "019bf9ea-0d3e-7def-8c9a-000000000003";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const contact = {
  consent: true,
  email: "user@example.test",
  idempotencyKey: IDEMPOTENCY_KEY,
  message: "Нужна помощь с подбором детали",
  name: "Антон Ермолаев",
  policyVersion: "contact-consent-v1",
  source: "expert_help",
};
const config = { getOrThrow: () => true } as unknown as ConfigService;

describe("PublicStorefrontService", () => {
  it("fails closed before collecting PII when legal documents are not approved", async () => {
    const database = { transaction: vi.fn() };
    const service = new PublicStorefrontService(
      { record: vi.fn() } as unknown as AuditService,
      { getOrThrow: () => false } as unknown as ConfigService,
      database as unknown as DatabaseService,
      {} as StorageProvider,
    );

    await expect(service.createContactRequest(contact, { ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("creates one contact request and keeps PII out of the outbox payload", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        created_at: new Date("2026-08-02T00:00:00.000Z"),
        id: REQUEST_ID,
        request_hash: Buffer.alloc(32),
        status: "new",
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    };
    const service = new PublicStorefrontService(
      audit as unknown as AuditService,
      config,
      database as unknown as DatabaseService,
      {} as StorageProvider,
    );

    await expect(service.createContactRequest(contact, { ipAddress: "127.0.0.1" }))
      .resolves.toMatchObject({ id: REQUEST_ID, replayed: false, status: "new" });

    const outboxPayload = String(clientQuery.mock.calls[1]?.[1]?.[1]);
    expect(outboxPayload).toContain(REQUEST_ID);
    expect(outboxPayload).not.toContain("user@example.test");
    expect(outboxPayload).not.toContain("Антон");
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it("rejects reuse of an idempotency key for a different request", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        created_at: new Date(),
        id: REQUEST_ID,
        request_hash: createHash("sha256").update("different").digest(),
        status: "new",
      }] });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    };
    const service = new PublicStorefrontService(
      { record: vi.fn() } as unknown as AuditService,
      config,
      database as unknown as DatabaseService,
      {} as StorageProvider,
    );

    await expect(service.createContactRequest(contact, { ipAddress: "127.0.0.1" }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("serves only bytes matching the stored image size, hash and MIME signature", async () => {
    const digest = createHash("sha256").update(PNG).digest();
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{
        byte_size: String(PNG.byteLength),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "chat/2026-08/image.png",
      }] }),
    };
    const storage = { name: "local", read: vi.fn().mockResolvedValue(PNG) };
    const service = new PublicStorefrontService(
      { record: vi.fn() } as unknown as AuditService,
      config,
      database as unknown as DatabaseService,
      storage as unknown as StorageProvider,
    );

    await expect(service.media(OBJECT_ID)).resolves.toEqual({
      content: PNG,
      etag: `"sha256-${digest.toString("base64url")}"`,
      mimeType: "image/png",
    });
    expect(String(database.query.mock.calls[0]?.[0])).toContain("EXISTS");
    expect(String(database.query.mock.calls[0]?.[0])).toContain("banner.is_active");
    expect(database.query.mock.calls[0]?.[1]).toEqual([OBJECT_ID, "local"]);
  });

  it("rejects oversized public media before reading it from storage", async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{
        byte_size: String(10 * 1024 * 1024 + 1),
        mime_type: "image/png",
        sha256: Buffer.alloc(32),
        storage_key: "content/2026-08/oversized.png",
      }] }),
    };
    const storage = { name: "local", read: vi.fn() };
    const service = new PublicStorefrontService(
      { record: vi.fn() } as unknown as AuditService,
      config,
      database as unknown as DatabaseService,
      storage as unknown as StorageProvider,
    );

    await expect(service.media(OBJECT_ID)).rejects.toThrow("Изображение недоступно");
    expect(storage.read).not.toHaveBeenCalled();
  });
});
