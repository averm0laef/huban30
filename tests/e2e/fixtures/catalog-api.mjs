import { readFileSync } from "node:fs";
import { createServer } from "node:http";

function id(number) {
  return `01800000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const category = (number, name, slug, children = []) => ({
  children, description: null, id: id(number), name, productCount: 12, slug, sortOrder: number,
});
const filters = category(1, "Фильтры", "filtry", [category(2, "Масляные фильтры", "maslyanye-filtry")]);
const tree = [filters, ...[
  ["Тормозная система", "tormoznaya-sistema"], ["Подвеска", "podveska"], ["Антифриз", "antifriz"],
  ["Аккумуляторы", "akkumulyatory"], ["Шины", "shiny"], ["Крепёж", "krepezh"], ["Свет", "svet"],
  ["Щётки", "shchetki"], ["Двигатель", "dvigatel"], ["Трансмиссия", "transmissiya"],
  ["Охлаждение", "ohlazhdenie"], ["Моторные масла", "motornye-masla"], ["Автохимия", "avtohimiya"],
].map(([name, slug], index) => category(index + 3, name, slug,
  index === 0 ? [category(30, "Тормозные колодки", "tormoznye-kolodki")]
    : index === 1 ? [category(31, "Амортизаторы", "amortizatory")]
      : []))];
const { id: categoryId, name: categoryName, slug: categorySlug } = filters;
const brand = { id: id(90), name: "MANN-FILTER", slug: "mann-filter" };
const photo = readFileSync(new URL("../../../apps/web/public/categories/maslyanye-filtry.webp", import.meta.url));
const image = {
  altText: "Фото тестового фильтра",
  byteSize: photo.length,
  id: id(161),
  isPrimary: true,
  mimeType: "image/webp",
  sortOrder: 0,
  url: `/api/v1/catalog/media/${id(161)}`,
};
const items = Array.from({ length: 12 }, (_, index) => ({
  availableQuantity: 8,
  brand,
  category: { id: categoryId, name: categoryName, slug: categorySlug },
  createdAt: "2026-11-25T00:00:00.000Z",
  id: id(100 + index),
  matchedVia: "query",
  name: `Фильтр масляный MANN W 914/${index + 2}`,
  priceKopeks: 75000,
  primaryImage: index === 0 ? image : null,
  sku: `W 914/${index + 2}`,
  slug: `fixture-filter-${index}`,
  updatedAt: "2026-11-25T00:00:00.000Z",
}));

const server = createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (json, status = 200) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(json));
  };

  if (pathname === "/health") return send({ ok: true });
  if (pathname === "/api/v1/catalog/categories/tree") return send({ items: tree });
  if (pathname === "/api/v1/catalog/categories") return send({ items: tree });
  if (pathname === "/api/v1/catalog/brands") return send({ items: [{ ...brand, productCount: items.length }] });
  if (pathname === "/api/v1/catalog/vehicle-kinds") return send({ items: [] });
  if (pathname === "/api/v1/catalog/featured") return send({ items, selection: "available_recent" });
  if (pathname === image.url) {
    res.writeHead(200, { "content-type": image.mimeType, "content-length": photo.length });
    return res.end(photo);
  }
  if (pathname === "/api/v1/catalog/products") {
    const limit = Number(searchParams.get("limit") ?? 24);
    const offset = Number(searchParams.get("offset") ?? 0);
    return send({ items: items.slice(offset, offset + limit), limit, matchMode: "all", offset, total: items.length });
  }
  if (pathname.startsWith("/api/v1/catalog/products/")) {
    const key = pathname.split("/").at(-1);
    const product = items.find((item) => item.slug === key || item.id === key);
    if (product) return send({ ...product, attributes: {}, description: null, images: product.primaryImage ? [product.primaryImage] : [] });
  }
  if (pathname === "/api/v1/parts-finder/status") return send({ catalog: "umapi", enabled: true });
  if (pathname === "/api/v1/umapi/status") return send({ enabled: true, photos: false });
  if (pathname === "/api/v1/auth/session") return send({ error: "unauthorized" }, 401);
  return send({ error: "fixture_not_found" }, 404);
});

server.listen(3302, "127.0.0.1");
