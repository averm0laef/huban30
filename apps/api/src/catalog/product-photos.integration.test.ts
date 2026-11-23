// Product photos the shop may show, on real PostgreSQL: where each came from, a pack attached by article, a
// takedown that stays down. Skipped unless CATALOG_SEARCH_DATABASE_URL points at a migrated database and ffmpeg is
// installed.

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import type { MalwareScannerService } from "../security/malware-scanner.service.js";
import type { MediaValidationService } from "../security/media-validation.service.js";
import { OneCExchangeImagesService } from "../one-c-exchange/one-c-exchange-images.service.js";
import type { OneCExchangeTempStorageService } from "../one-c-exchange/one-c-exchange-temp-storage.service.js";
import { ProductPhotoNormalizer } from "./product-photo-normalizer.js";
import { articlesFromFileName, ProductPhotosService } from "./product-photos.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const PREFIX = "photo-fixture:";
const PROVIDER = "photo-fixture";

function photo(colour: string): Buffer {
  return spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=${colour}:s=320x240`, "-frames:v", "1", "-f", "mjpeg", "pipe:1"]).stdout;
}

describe("the article a pack file is named after", () => {
  it("is the file name, and for a numbered picture also the name without the number", () => {
    expect(articlesFromFileName("W914-2.jpg")).toEqual(["W914-2"]);
    expect(articlesFromFileName("W914-2_2.JPG")).toEqual(["W914-2_2", "W914-2"]);
    expect(articlesFromFileName("C:\\pack\\OC 90 (3).webp")).toEqual(["OC 90 (3)", "OC 90"]);
    expect(articlesFromFileName("00-00009366.png")).toEqual(["00-00009366"]);
    expect(articlesFromFileName(".jpg")).toEqual([]);
  });
});

describe.skipIf(!url || !hasFfmpeg)("product photos with a known origin (real PostgreSQL)", () => {
  let database: DatabaseService;
  let photos: ProductPhotosService;
  let auth: AuthContext;
  const files = new Map<string, Buffer>();
  const ids = new Map<string, string>();
  const audited: string[] = [];

  const storage: StorageProvider = {
    name: PROVIDER,
    read: async (key) => files.get(key)!,
    remove: async (key) => { files.delete(key); },
    store: async (content, extension) => {
      const storageKey = `chat/2026-11/${randomUUID()}.${extension}`;
      files.set(storageKey, content);
      return { byteSize: content.length, storageKey };
    },
  };

  const remove = async () => {
    await database.query("DELETE FROM app.product_image_withdrawals WHERE product_external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.product_images WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.storage_objects WHERE provider=$1", [PROVIDER]);
    await database.query("DELETE FROM app.image_rights_sources WHERE name LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.inventory_balances WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.warehouses WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.users WHERE email=$1", ["photo-fixture@an30.test"]);
  };

  const imagesOf = async (key: string) => (await database.query<{ is_primary: boolean; source: string; uploaded_by: string | null }>(
    "SELECT source::text AS source,is_primary,uploaded_by FROM app.product_images WHERE product_id=$1 ORDER BY sort_order,created_at", [ids.get(key)],
  )).rows;

  /** The 1С exchange itself brings a picture: its own service, fed the file 1С uploaded in the session. */
  const fromOneC = async (key: string, content: Buffer, into = new ProductPhotoStorage(storage)) => {
    const exchange = new OneCExchangeImagesService(
      database,
      { readAssembled: async () => content } as unknown as OneCExchangeTempStorageService,
      into,
      { assertClean: async () => undefined } as unknown as MalwareScannerService,
      { assertValid: async () => undefined } as unknown as MediaValidationService,
    );
    const outcome = await exchange.attach({ path: "import_files/a.jpg", productExternalId: `${PREFIX}${key}`, sortOrder: 0 }, "one_c");
    const row = (await database.query<{ id: string }>(
      `SELECT image.id FROM app.product_images AS image JOIN app.storage_objects AS storage ON storage.id=image.storage_object_id
       WHERE image.product_id=$1 AND storage.sha256=$2`,
      [ids.get(key), createHash("sha256").update(content).digest()],
    )).rows[0];
    return { id: row?.id, outcome };
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    await remove();
    const user = (await database.query<{ id: string }>(
      "INSERT INTO app.users (email,display_name,status) VALUES ('photo-fixture@an30.test','Продавец','active') RETURNING id",
    )).rows[0]!.id;
    auth = { role: "admin", userId: user } as unknown as AuthContext;
    const warehouse = (await database.query<{ id: string }>("INSERT INTO app.warehouses (external_id,code,name) VALUES ($1,'PF','Склад') RETURNING id", [`${PREFIX}warehouse`])).rows[0]!.id;
    const products = [
      { key: "filter", sku: "PHFX-W914/2", name: "Фильтр масляный ФОТОФИКС W914/2", stock: 3 },
      { key: "lamp", sku: "PHFX-64210", name: "Лампа H7 ФОТОФИКС 64210", stock: 1 },
      { key: "lamp-twin", sku: "PHFX 64210", name: "Лампа H7 ФОТОФИКС 64210 (вторая карточка)", stock: 0 },
      { key: "belt", sku: "PHFX-6PK1200", name: "Ремень поликлиновой ФОТОФИКС 6PK1200", stock: 0 },
    ];
    for (const product of products) {
      const id = (await database.query<{ id: string }>(
        "INSERT INTO app.products (external_id,sku,name,slug) VALUES ($1,$2,$3,$4) RETURNING id",
        [`${PREFIX}${product.key}`, product.sku, product.name, `photo-fixture-${product.key}`],
      )).rows[0]!.id;
      ids.set(product.key, id);
      await database.query("INSERT INTO app.inventory_balances (product_id,warehouse_id,quantity_on_hand) VALUES ($1,$2,$3)", [id, warehouse, product.stock]);
    }
    photos = new ProductPhotosService(
      database,
      { record: async (event: { action: string }) => { audited.push(event.action); } } as unknown as AuditService,
      { assertClean: async () => undefined } as unknown as MalwareScannerService,
      { assertValid: async () => undefined } as unknown as MediaValidationService,
      new ProductPhotoNormalizer({ get: () => undefined } as unknown as ConfigService),
      new ProductPhotoStorage(storage),
    );
  }, 60_000);

  afterAll(async () => {
    if (database) await remove();
    await database?.onModuleDestroy?.();
  });

  it("queues what has no photo: what is on the shelf, unless asked for everything", async () => {
    const onShelf = (await photos.queue({ search: "ФОТОФИКС" })).items.map((item) => item.code);
    expect(onShelf).toEqual([`${PREFIX}lamp`, `${PREFIX}filter`]);
    const all = await photos.queue({ inStock: "false", search: "ФОТОФИКС" });
    expect(all.total).toBe(4);
    expect((await photos.queue({ search: "phfx w 914" })).items.map((item) => item.code)).toEqual([`${PREFIX}filter`]);
  });

  it("attaches the shop's own photo as the card's main picture and records who took it", async () => {
    const result = await photos.attach(ids.get("filter"), {}, { content: photo("red"), fileName: "IMG_0001.jpg" }, auth);
    expect(result).toMatchObject({ outcome: "attached", source: "own_photo" });
    expect(await imagesOf("filter")).toEqual([{ is_primary: true, source: "own_photo", uploaded_by: auth.userId }]);
    expect((await photos.queue({ search: "ФОТОФИКС" })).items.map((item) => item.code)).toEqual([`${PREFIX}lamp`]);
    expect(audited).toContain("catalog.product_photo.attached");
    // The same shot sent twice (a double tap, a retry on a bad connection) stays one photo.
    expect(await photos.attach(ids.get("filter"), {}, { content: photo("red"), fileName: "IMG_0001.jpg" }, auth)).toMatchObject({ outcome: "unchanged" });
    expect(await imagesOf("filter")).toHaveLength(1);
  });

  it("refuses what is not a photograph, and a product that does not exist", async () => {
    await expect(photos.attach(ids.get("belt"), {}, { content: Buffer.from("%PDF-1.7 not a photo"), fileName: "a.jpg" }, auth)).rejects.toThrow("JPEG");
    await expect(photos.attach(randomUUID(), {}, { content: photo("red"), fileName: "a.jpg" }, auth)).rejects.toThrow("Товар не найден");
    await expect(photos.attach(ids.get("belt"), {}, undefined, auth)).rejects.toThrow("Файл не передан");
    expect(await imagesOf("belt")).toEqual([]);
  });

  it("publishes a right holder's picture only under a recorded permission", async () => {
    await expect(photos.createRightsSource({ name: `${PREFIX}Завод`, basis: "" }, auth)).rejects.toThrow("на каком основании");
    await expect(photos.attachByFileName({ rightsSourceId: randomUUID() }, { content: photo("green"), fileName: "PHFX-6PK1200.jpg" }, auth)).rejects.toThrow("не найден");
    const { id } = await photos.createRightsSource({ name: `${PREFIX}Завод`, basis: "Письмо от 20.11.2026: разрешено размещать фото продукции" }, auth);
    await expect(photos.createRightsSource({ name: `${PREFIX}завод `, basis: "то же письмо" }, auth)).rejects.toThrow("уже записан");
    ids.set("source", id);

    const attached = await photos.attachByFileName({ rightsSourceId: id }, { content: photo("green"), fileName: "phfx 6pk1200.jpg" }, auth);
    expect(attached).toMatchObject({ outcome: "attached", source: "licensed", product: { code: `${PREFIX}belt` } });
    const second = await photos.attachByFileName({ rightsSourceId: id }, { content: photo("yellow"), fileName: "PHFX-6PK1200_2.jpg" }, auth);
    expect(second).toMatchObject({ article: "PHFX-6PK1200", outcome: "attached" });
    expect((await imagesOf("belt")).map((image) => [image.source, image.is_primary])).toEqual([["licensed", true], ["licensed", false]]);
    expect((await photos.rightsSources()).items.find((source) => source.id === id)).toMatchObject({ photos: 2, revokedAt: null });
  });

  it("leaves a file to a person when two cards answer to its article, or none does", async () => {
    const twins = await photos.attachByFileName({}, { content: photo("white"), fileName: "PHFX64210.jpg" }, auth);
    expect(twins.outcome).toBe("ambiguous");
    expect(twins.outcome === "ambiguous" ? twins.candidates.map((candidate) => candidate.code).sort() : []).toEqual([`${PREFIX}lamp`, `${PREFIX}lamp-twin`]);
    expect(await photos.attachByFileName({}, { content: photo("white"), fileName: "PHFX-NOSUCH-1.jpg" }, auth)).toMatchObject({ outcome: "not_found" });
    expect(await imagesOf("lamp")).toEqual([]);
    // The 1С code names exactly one card.
    expect(await photos.attachByFileName({}, { content: photo("white"), fileName: `${PREFIX}lamp.jpg` }, auth)).toMatchObject({ outcome: "attached", source: "own_photo" });
  });

  it("counts a picture the exchange brings as 1С's", async () => {
    const brought = await fromOneC("lamp-twin", photo("orange"));
    expect(brought.outcome).toBe("attached");
    expect(brought.id).toBeTruthy();
    expect(await imagesOf("lamp-twin")).toEqual([{ is_primary: true, source: "one_c", uploaded_by: null }]);
    const listed = (await photos.images({ search: "ФОТОФИКС", source: "one_c" })).items;
    expect(listed.map((image) => image.code)).toEqual([`${PREFIX}lamp-twin`]);
    expect(listed[0]!.url).toBe(`/api/v1/catalog/media/${brought.id}`);
  });

  it("takes a picture down for good: the file goes, the record stays, 1С cannot bring it back", async () => {
    const image = (await photos.images({ search: "ФОТОФИКС", source: "one_c" })).items[0]!;
    const before = files.size;
    await expect(photos.withdraw(image.id, { reason: "" }, auth)).rejects.toThrow("причину");
    expect(await photos.withdraw(image.id, { reason: "Претензия правообладателя от 23.11.2026" }, auth)).toEqual({ withdrawn: 1 });
    expect(await imagesOf("lamp-twin")).toEqual([]);
    expect(files.size).toBe(before - 1);
    const record = (await database.query<{ reason: string; source: string; withdrawn_by: string }>(
      "SELECT reason,source::text AS source,withdrawn_by FROM app.product_image_withdrawals WHERE product_external_id=$1", [`${PREFIX}lamp-twin`],
    )).rows;
    expect(record).toEqual([{ reason: "Претензия правообладателя от 23.11.2026", source: "one_c", withdrawn_by: auth.userId }]);
    await expect(photos.withdraw(image.id, { reason: "ещё раз" }, auth)).rejects.toThrow("Фото не найдено");

    // The next night's exchange sends the same file again: it is skipped, on this card and on any other, and the
    // file it brought is not kept.
    const kept = files.size;
    expect(await fromOneC("lamp-twin", photo("orange"))).toEqual({ id: undefined, outcome: "skipped" });
    expect(await fromOneC("lamp", photo("orange"))).toEqual({ id: undefined, outcome: "skipped" });
    expect(files.size).toBe(kept);
    // New photos have since moved to the bucket: the file is not put there either.
    const bucket = { ...storage, name: `${PROVIDER}-bucket`, store: vi.fn(storage.store) };
    expect(await fromOneC("lamp", photo("orange"), new ProductPhotoStorage(bucket, [storage]))).toEqual({ id: undefined, outcome: "skipped" });
    expect(bucket.store).not.toHaveBeenCalled();
    // A row written past both services is refused by the database itself.
    const direct = await database.query(
      `INSERT INTO app.product_images (product_id,storage_object_id,alt_text,sort_order,is_primary)
       SELECT $1,storage.id,'фото',9,false FROM app.storage_objects AS storage WHERE storage.provider=$2 AND storage.sha256=$3
       RETURNING id`,
      [ids.get("lamp"), PROVIDER, createHash("sha256").update(photo("orange")).digest()],
    );
    expect(direct.rowCount).toBe(0);
    expect(await imagesOf("lamp-twin")).toEqual([]);
  });

  it("gives the card its next picture when the main one is taken down, and refuses the same shot again", async () => {
    await photos.attach(ids.get("filter"), {}, { content: photo("purple"), fileName: "IMG_0002.jpg" }, auth);
    const main = (await photos.images({ search: "ФОТОФИКС W914", source: "own_photo" })).items.at(-1)!;
    await photos.withdraw(main.id, { reason: "В кадр попал чужой каталог" }, auth);
    expect(await imagesOf("filter")).toEqual([{ is_primary: true, source: "own_photo", uploaded_by: auth.userId }]);
    await expect(photos.attach(ids.get("filter"), {}, { content: photo("red"), fileName: "IMG_0001.jpg" }, auth)).rejects.toThrow("уже снимали");
  });

  it("takes down everything published under a permission when it ends, and accepts nothing more under it", async () => {
    const id = ids.get("source")!;
    expect(await photos.revokeRightsSource(id, { reason: "Завод отозвал разрешение" }, auth)).toEqual({ withdrawn: 2 });
    expect(await imagesOf("belt")).toEqual([]);
    expect((await photos.rightsSources()).items.find((source) => source.id === id)).toMatchObject({ photos: 0 });
    expect((await photos.rightsSources()).items.find((source) => source.id === id)!.revokedAt).not.toBeNull();
    await expect(photos.attachByFileName({ rightsSourceId: id }, { content: photo("pink"), fileName: "PHFX-6PK1200.jpg" }, auth)).rejects.toThrow("отозвано");
    const summary = await photos.summary();
    expect(summary.withdrawn).toBeGreaterThanOrEqual(4);
    expect(summary.withoutPhoto).toBeLessThan(summary.products);
  });
});
