import { describe, expect, it, vi } from "vitest";

import { productSitemapPaths, readSitemapPart, sitemapPartIds } from "./product-sitemap";

describe("the site map of products, in parts", () => {
  it("has as many parts as the catalogue needs, and always the first one", () => {
    expect(sitemapPartIds(42_723, 10_000)).toEqual([{ id: "0" }, { id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }]);
    expect(sitemapPartIds(10_000, 10_000)).toEqual([{ id: "0" }]);
    expect(sitemapPartIds(0, 10_000)).toEqual([{ id: "0" }]);
    expect(sitemapPartIds(5_000_000, 10_000)).toHaveLength(100);
  });

  it("names every part in robots.txt", () => {
    expect(productSitemapPaths(25_000, 10_000)).toEqual(["/catalog/product/sitemap/0.xml", "/catalog/product/sitemap/1.xml", "/catalog/product/sitemap/2.xml"]);
  });

  it("reads one part from the API, and an empty part when the API cannot answer", async () => {
    const body = { items: [{ slug: "lampa-osram-3930", updatedAt: "2026-11-22T10:00:00.000Z" }], partSize: 10_000, total: 42_723 };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    expect(await readSitemapPart("http://api:4000", 3, fetchImpl)).toEqual(body);
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api:4000/api/v1/catalog/sitemap/products?part=3");
    const failing = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await readSitemapPart("http://api:4000", 0, failing)).toEqual({ items: [], partSize: 10_000, total: 0 });
    const broken = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    expect(await readSitemapPart("http://api:4000", 0, broken)).toEqual({ items: [], partSize: 10_000, total: 0 });
  });
});
