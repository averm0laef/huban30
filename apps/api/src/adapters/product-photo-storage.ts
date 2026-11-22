// Where product photos live (docs/PRODUCT_PHOTOS_S3.md). New photos go to one
// storage -- the S3 bucket once PRODUCT_PHOTO_STORAGE=s3, the local disk
// otherwise -- while a photo is always read from the storage its
// storage_objects.provider names, so photos stored before a switch stay on
// the site. Chat attachments and banners keep using STORAGE_PROVIDER.
import type { ConfigService } from "@nestjs/config";

import type { StorageProvider } from "./provider-contracts.js";
import { S3StorageProvider } from "./s3-storage.provider.js";

export const PRODUCT_PHOTO_STORAGE = Symbol("PRODUCT_PHOTO_STORAGE");

export class ProductPhotoStorage {
  /** `storage_objects.provider` values a public product photo may carry. */
  readonly providerNames: readonly string[];
  private readonly providers: ReadonlyMap<string, StorageProvider>;

  constructor(
    /** New photos are written here. */
    readonly target: StorageProvider,
    readOnly: readonly StorageProvider[] = [],
  ) {
    this.providers = new Map([target, ...readOnly].map((provider) => [provider.name, provider]));
    this.providerNames = [...this.providers.keys()];
  }

  provider(name: string): StorageProvider | undefined {
    return this.providers.get(name);
  }
}

export function createProductPhotoStorage(config: ConfigService, local: StorageProvider): ProductPhotoStorage {
  if (config.get<string>("PRODUCT_PHOTO_STORAGE") !== "s3") return new ProductPhotoStorage(local);
  const s3 = new S3StorageProvider({
    accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
    bucket: config.getOrThrow<string>("S3_BUCKET"),
    endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
    forcePathStyle: config.getOrThrow<boolean>("S3_FORCE_PATH_STYLE"),
    region: config.getOrThrow<string>("S3_REGION"),
    secretAccessKey: config.getOrThrow<string>("S3_SECRET_ACCESS_KEY"),
  });
  return new ProductPhotoStorage(s3, [local]);
}
