import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { createProductPhotoStorage, ProductPhotoStorage } from "./product-photo-storage.js";
import type { StorageProvider } from "./provider-contracts.js";

function provider(name: string): StorageProvider {
  return { name, read: async () => Buffer.alloc(0), remove: async () => undefined, store: async () => ({ byteSize: 0, storageKey: "" }) };
}

describe("ProductPhotoStorage", () => {
  it("writes new photos to the target and reads from every storage a photo may already be in", () => {
    const s3 = provider("s3");
    const local = provider("local");
    const photos = new ProductPhotoStorage(s3, [local]);

    expect(photos.target).toBe(s3);
    expect(photos.providerNames).toEqual(["s3", "local"]);
    expect(photos.provider("local")).toBe(local);
    expect(photos.provider("s3")).toBe(s3);
    expect(photos.provider("ftp")).toBeUndefined();
  });

  it("keeps photos on the local disk unless S3 is switched on", () => {
    const local = provider("local");
    const photos = createProductPhotoStorage(new ConfigService({ PRODUCT_PHOTO_STORAGE: "local" }), local);

    expect(photos.target).toBe(local);
    expect(photos.providerNames).toEqual(["local"]);
  });

  it("with S3 switched on sends new photos to the bucket and still reads the ones left on the disk", () => {
    const local = provider("local");
    const photos = createProductPhotoStorage(new ConfigService({
      PRODUCT_PHOTO_STORAGE: "s3",
      S3_ACCESS_KEY_ID: "FAKEACCESSKEYID",
      S3_BUCKET: "an30-photos",
      S3_ENDPOINT: "https://s3.example.test",
      S3_FORCE_PATH_STYLE: true,
      S3_REGION: "ru-1",
      S3_SECRET_ACCESS_KEY: "fake-secret-access-key-0123456789",
    }), local);

    expect(photos.target.name).toBe("s3");
    expect(photos.providerNames).toEqual(["s3", "local"]);
    expect(photos.provider("local")).toBe(local);
  });

  it("after new photos are switched back to the disk still reads the ones already in the bucket", () => {
    const local = provider("local");
    const photos = createProductPhotoStorage(new ConfigService({
      PRODUCT_PHOTO_STORAGE: "local",
      S3_ACCESS_KEY_ID: "FAKEACCESSKEYID",
      S3_BUCKET: "an30-photos",
      S3_ENDPOINT: "https://s3.example.test",
      S3_FORCE_PATH_STYLE: true,
      S3_REGION: "ru-1",
      S3_SECRET_ACCESS_KEY: "fake-secret-access-key-0123456789",
    }), local);

    expect(photos.target).toBe(local);
    expect(photos.providerNames).toEqual(["local", "s3"]);
    expect(photos.provider("s3")?.name).toBe("s3");
  });
});
