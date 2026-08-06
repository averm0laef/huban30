import { createHash } from "node:crypto";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogPublicController } from "./catalog-public.controller.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { normalizeArticleNumber } from "./catalog-search-normalize.js";

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
    new CatalogCategoryTreeCache(),
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
    // The category filter matches the category itself and every descendant
    // (category_subtree), not only an exact slug match — a search scoped to
    // "Кузов" must also surface products filed under "Кузов / Щётки".
    expect(itemsSql).toContain("category_subtree");
    expect(itemsSql).toContain("category.id IN (SELECT id FROM category_subtree)");
    expect(itemsParameters).toEqual([
      "фильтр",
      "фильтр",
      "filters",
      ["ngk"],
      100000,
      200000,
      "in_stock",
      normalizeArticleNumber("фильтр"),
      "local",
      12,
      24,
      ["image/avif", "image/jpeg", "image/png", "image/webp"],
    ]);
  });

  it("ranks an exact normalised article match before a prefix match before fuzzy name relevance", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await service.products({ q: "w914-2" });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    // Rank order lives in ORDER BY. The same LIKE also appears earlier in the
    // WHERE clause, so searching the whole statement would measure the filter
    // rather than the ranking and read the tiers as inverted.
    const ranking = sql.slice(sql.lastIndexOf("ORDER BY"));
    const exactTier = ranking.indexOf("product.sku_normalized=$8");
    const prefixTier = ranking.indexOf("product.sku_normalized LIKE $8");
    const fuzzyTier = ranking.indexOf("similarity(product.name");
    const nameTiebreak = ranking.indexOf("lower(product.name) ASC");
    expect(exactTier).toBeGreaterThan(-1);
    expect(prefixTier).toBeGreaterThan(exactTier);
    expect(fuzzyTier).toBeGreaterThan(prefixTier);
    expect(nameTiebreak).toBeGreaterThan(fuzzyTier);
    expect(parameters[7]).toBe(normalizeArticleNumber("w914-2"));
    expect(parameters[7]).toBe("W9142");
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

  it("assembles and caches the category tree, hiding an inactive subtree", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          description: null,
          id: "parts",
          is_active: true,
          name: "Запчасти",
          parent_id: null,
          product_count: "1",
          slug: "zapchasti",
          sort_order: 0,
        },
        {
          description: null,
          id: "body",
          is_active: true,
          name: "Кузов",
          parent_id: "parts",
          product_count: "2",
          slug: "kuzov",
          sort_order: 0,
        },
        {
          description: null,
          id: "electric",
          is_active: false,
          name: "Электрика",
          parent_id: null,
          product_count: "9",
          slug: "elektrika",
          sort_order: 1,
        },
      ],
    });

    const first = await service.categoryTree();
    expect(first.items).toMatchObject([
      { id: "parts", productCount: 3, slug: "zapchasti", children: [{ id: "body", slug: "kuzov" }] },
    ]);
    expect(first.items.map((item) => item.id)).not.toContain("electric");
    expect(query.mock.calls[0]?.[0]).toContain("category.deleted_at IS NULL");

    // A second call must not hit the database again — the tree is cached
    // until CatalogApplyService invalidates it on the next 1C import.
    const second = await service.categoryTree();
    expect(second).toEqual(first);
    expect(query).toHaveBeenCalledTimes(1);
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
