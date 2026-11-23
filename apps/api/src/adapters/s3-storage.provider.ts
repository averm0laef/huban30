// Object storage for product photos (docs/PRODUCT_PHOTOS_S3.md): any
// S3-compatible bucket, so the photo base grows there and not on the VPS
// disk. The bucket stays private -- visitors get photos through the API,
// which re-checks size, type and SHA-256 of every object it serves.
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { StorageProvider, StoredObject, StoredObjectStream } from "./provider-contracts.js";

const SAFE_STORAGE_KEY = /^(?:catalog|chat|content)\/[0-9]{4}-[0-9]{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/u;
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
// Above the 10 MB a product photo may weigh; read() never buffers more.
const DEFAULT_MAX_READ_BYTES = 16 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export interface S3StorageSettings {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  maxAttempts?: number;
  maxReadBytes?: number;
  region: string;
  requestTimeoutMs?: number;
  secretAccessKey: string;
}

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly maxReadBytes: number;

  constructor(settings: S3StorageSettings) {
    this.bucket = settings.bucket;
    this.maxReadBytes = settings.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
    const requestTimeout = settings.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.client = new S3Client({
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      endpoint: settings.endpoint,
      // A photo over 2 MiB would otherwise wait for "100 Continue"; a gateway
      // that never sends it would use up the whole request timeout.
      expectContinueHeader: false,
      forcePathStyle: settings.forcePathStyle,
      maxAttempts: settings.maxAttempts ?? 3,
      region: settings.region,
      // The SDK's newer CRC32 trailers are an AWS extension that several
      // S3-compatible stores reject; integrity is checked by SHA-256 on read.
      requestChecksumCalculation: "WHEN_REQUIRED",
      // Without throwOnRequestTimeout the SDK only logs a warning and keeps
      // waiting, so a bucket that goes silent would hold the 1C import
      // forever; socketTimeout ends a download that stalls mid-body.
      requestHandler: {
        connectionTimeout: 5_000,
        requestTimeout,
        socketTimeout: requestTimeout,
        throwOnRequestTimeout: true,
      },
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async store(content: Buffer, extension: string): Promise<StoredObject> {
    if (!/^[a-z0-9]{2,5}$/u.test(extension)) throw new Error("Unsafe storage extension");
    const month = new Date().toISOString().slice(0, 7);
    const storageKey = `catalog/${month}/${randomUUID()}.${extension}`;
    await this.client.send(new PutObjectCommand({
      Body: content,
      Bucket: this.bucket,
      ContentLength: content.byteLength,
      ContentType: CONTENT_TYPES.get(extension) ?? "application/octet-stream",
      Key: storageKey,
    }));
    return { byteSize: content.byteLength, storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    const opened = await this.open(storageKey);
    if (opened.byteSize > this.maxReadBytes) {
      opened.content.destroy();
      throw new Error("Storage object is larger than the read limit");
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of opened.content) {
      received += (chunk as Buffer).byteLength;
      if (received > this.maxReadBytes) {
        opened.content.destroy();
        throw new Error("Storage object is larger than the read limit");
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async open(storageKey: string): Promise<StoredObjectStream> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }));
    const content = response.Body as Readable | undefined;
    if (!content || response.ContentLength === undefined) throw new Error("Storage object has no content");
    return { byteSize: response.ContentLength, content };
  }

  async remove(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }));
  }

  private key(storageKey: string): string {
    if (!SAFE_STORAGE_KEY.test(storageKey)) throw new Error("Unsafe storage key");
    return storageKey;
  }
}
