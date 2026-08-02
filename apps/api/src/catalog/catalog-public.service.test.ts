import { createHash } from "node:crypto";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogPublicController } from "./catalog-public.controller.js";
import { CatalogPublicService } from "./catalog-public.service.js";

const PRODUCT_ID = "019bf9ea-0d3e-7def-9c9a-000000000010";
const IMAGE_ID = "019bf9ea-0d3e-7def-8c9a-000000000011";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    available_quantity: "7",
    brand_id: "019bf9ea-0d3e-7def-8c9a-000000000020",
    brand_name: "NGK",
    brand_slug: "ngk",
    category_id: "019bf9ea-0d3e-7def-8c9a-000000000030",
    category_name: "Фильтры",
    category_slug: "filters",
    created_at: new Date("2026-08-01T01:00:00.000Z"),
    id: PRODUCT_ID,
    name: "Фильтр масляный",
    price_kopeks: "125000",
    primary_image_alt_text: null,
    primary_image_byte_size: null,
    primary_image_id: null,
    primary_image_is_primary: null,
    primary_image_mime_type: null,
    sku: "FILTER-1",
    slug: "oil-filter-1",
    total_count: "1",
    updated_at: new Date("2026-08-02T01:00:00.000Z"),
    ...overrides,
  };
}

describe("CatalogPublicService", () => {
  const query = vi.fn();
  const read = vi.fn();
  const storage: StorageProvider = {
    name: "local",
    read,
    remove: vi.fn(),
    store: vi.fn(),
  };
  const database = {
    query,
    transaction: async <T>(work: (client: { query: typeof query }) => Promise<T>) => work({
      query: vi.fn((text: string, values?: unknown[]) => (
        text.startsWith("SET LOCAL") ? Promise.resolve({ rows: [] }) : query(text, values)
      )),
    }),
  };
  const service = new CatalogPublicService(
    database as unknown as DatabaseService,
    storage,
  );

  beforeEach(() => {
    query.mockReset();
    read.mockReset();
  });

  it("rejects malformed catalog filters before querying PostgreSQL", async () => {
    await expect(service.products({ minPriceKopeks: "200", maxPriceKopeks: "100" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.products({ brand: ["ngk", "ngk"] }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("applies server-side filters and returns deterministic pagination", async () => {
    query
      .mockResolvedValueOnce({ rows: [productRow()] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });

    await expect(service.products({
      availability: "in_stock",
      brand: "ngk",
      category: "filters",
      limit: "12",
      maxPriceKopeks: "200000",
      minPriceKopeks: "100000",
      offset: "24",
      q: "фильтр",
      sort: "price_asc",
    })).resolves.toMatchObject({
      items: [{
        availableQuantity: 7,
        name: "Фильтр масляный",
        priceKopeks: 125000,
        primaryImage: null,
      }],
      limit: 12,
      offset: 24,
      total: 1,
    });

    const [itemsSql, itemsParameters] = query.mock.calls[0] as [string, unknown[]];
    expect(itemsSql).toContain("warehouse.is_active");
    expect(itemsSql).toContain("storage.status='available'");
    expect(itemsSql).toContain("price.amount_kopeks ASC NULLS LAST");
    expect(itemsParameters).toEqual([
      "фильтр",
      "фильтр",
      "filters",
      ["ngk"],
      100000,
      200000,
      "in_stock",
      "local",
      12,
      24,
      ["image/avif", "image/jpeg", "image/png", "image/webp"],
    ]);
  });

  it("escapes SQL LIKE wildcards without changing full-text search input", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await service.products({ q: "100%_" });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ESCAPE '\\'");
    expect(parameters[0]).toBe("100%_");
    expect(parameters[1]).toBe("100\\%\\_");
  });

  it("returns only active category and brand projections", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          description: "Расходные материалы",
          id: "019bf9ea-0d3e-7def-8c9a-000000000030",
          name: "Фильтры",
          parent_id: null,
          product_count: "4",
          slug: "filters",
          sort_order: 10,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "019bf9ea-0d3e-7def-8c9a-000000000020",
          name: "NGK",
          product_count: "3",
          slug: "ngk",
        }],
      });

    await expect(service.categories()).resolves.toMatchObject({
      items: [{ productCount: 4, slug: "filters" }],
    });
    await expect(service.brands()).resolves.toMatchObject({
      items: [{ productCount: 3, slug: "ngk" }],
    });
    expect(query.mock.calls[0]?.[0]).toContain("category.is_active");
    expect(query.mock.calls[1]?.[0]).toContain("brand.is_active");
  });

  it("returns detail images in primary-first order without exposing storage keys", async () => {
    query
      .mockResolvedValueOnce({
        rows: [productRow({ public_attributes: { thread: "M20" }, description: "Описание" })],
      })
      .mockResolvedValueOnce({
        rows: [{
          alt_text: "Фильтр",
          byte_size: String(PNG.length),
          id: IMAGE_ID,
          is_primary: true,
          mime_type: "image/png",
          sort_order: 0,
        }],
      });

    const result = await service.product("oil-filter-1");
    expect(result).toMatchObject({
      attributes: { thread: "M20" },
      description: "Описание",
      images: [{ id: IMAGE_ID, isPrimary: true, url: `/api/v1/catalog/media/${IMAGE_ID}` }],
      primaryImage: { id: IMAGE_ID },
    });
    expect(JSON.stringify(result)).not.toContain("storage_key");
    expect(query.mock.calls[0]?.[0]).toContain("product.slug::text=$1");
    expect(query.mock.calls[0]?.[0]).toContain("product.public_attributes");
    expect(query.mock.calls[0]?.[0]).not.toContain("product.attributes");
  });

  it("selects featured products only when price and active-warehouse stock are present", async () => {
    query.mockResolvedValueOnce({ rows: [productRow()] });
    const result = await service.featured({ limit: "6" });
    expect(result).toMatchObject({ selection: "available_recent", items: [{ id: PRODUCT_ID }] });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("price.amount_kopeks IS NOT NULL");
    expect(sql).toContain("stock.available_quantity>0");
    expect(sql).toContain("product.updated_at DESC");
    expect(parameters[1]).toBe(6);
  });

  it("serves only verified public product image bytes with a content ETag", async () => {
    const digest = createHash("sha256").update(PNG).digest();
    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(PNG.length),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "chat/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    read.mockResolvedValueOnce(PNG);

    await expect(service.media(IMAGE_ID)).resolves.toEqual({
      content: PNG,
      etag: `"sha256-${digest.toString("base64url")}"`,
      mimeType: "image/png",
    });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM app.product_images");
    expect(sql).toContain("product.is_active");
    expect(sql).toContain("storage.status='available'");
    expect(parameters[1]).toBe("local");
  });

  it("does not return missing or corrupt media", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);

    const digest = createHash("sha256").update(PNG).digest();
    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(PNG.length),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "chat/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    read.mockResolvedValueOnce(Buffer.from("not an image"));
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);

    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(PNG.length),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "catalog/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    read.mockRejectedValueOnce(new Error("unsupported storage namespace"));
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);

    read.mockClear();
    query.mockResolvedValueOnce({
      rows: [{
        byte_size: String(10 * 1024 * 1024 + 1),
        mime_type: "image/png",
        sha256: digest,
        storage_key: "catalog/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.png",
      }],
    });
    await expect(service.media(IMAGE_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("CatalogPublicController media headers", () => {
  it("supports weak conditional ETags and preserves safe cache headers on 304", async () => {
    const media = {
      content: null,
      etag: '"sha256-content"',
      mimeType: "image/png",
    };
    const catalog = { media: vi.fn().mockResolvedValue(media) };
    const rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
    const headers = new Map<string, string>();
    const reply = {
      header: vi.fn((name: string, value: string) => {
        headers.set(name, value);
        return reply;
      }),
      send: vi.fn(),
      status: vi.fn(() => reply),
    };
    const controller = new CatalogPublicController(
      catalog as unknown as CatalogPublicService,
      rateLimit as never,
    );

    await controller.media(
      IMAGE_ID,
      'W/"sha256-content", "another"',
      { ip: "127.0.0.1" } as never,
      reply as never,
    );

    expect(rateLimit.consume).toHaveBeenCalledWith("catalog-media", "127.0.0.1", 120, 60);
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(headers.get("ETag")).toBe(media.etag);
    expect(headers.get("Cache-Control")).toContain("stale-while-revalidate");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(reply.send).toHaveBeenCalledWith();
  });
});
