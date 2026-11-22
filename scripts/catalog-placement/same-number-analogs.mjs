// Which products a product card shows as «the same part» only because they share its number
// (step 0 of SHOP_OFFERS_SQL, apps/api/src/parts-finder/same-part-number.ts; docs/CATALOG_MATCHING.md).
// Reads a database holding the owner's catalogue (a rehearsal of the exchange: scripts/storefront-checks/README.md,
// «Где взять стенд с разделами») through the built API (corepack pnpm --filter @an30/api build). Only reads.
// Usage: DATABASE_URL=postgresql://localhost/an30_catalog_stand node scripts/catalog-placement/same-number-analogs.mjs [examples]
import { originalPartCode } from "../../apps/api/dist/catalog/catalog-original-numbers.js";
import { partTypeKey } from "../../apps/api/dist/catalog/catalog-part-dictionary.js";
import { DatabaseService } from "../../apps/api/dist/infrastructure/database.service.js";
import { PartsFinderShopService } from "../../apps/api/dist/parts-finder/parts-finder-shop.service.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to a database holding the catalogue (never the production one).");
  process.exit(1);
}
const examples = Number(process.argv[2] ?? 5);
const database = new DatabaseService({ get: () => "development", getOrThrow: () => url });
const shop = new PartsFinderShopService(database);

const { rows } = await database.query(`
  WITH RECURSIVE tree AS (
    SELECT id, slug::text AS root FROM app.categories WHERE parent_id IS NULL
    UNION ALL SELECT category.id, tree.root FROM app.categories AS category JOIN tree ON category.parent_id = tree.id
  ), shared AS (
    SELECT sku_normalized FROM app.products WHERE deleted_at IS NULL AND is_active AND sku_normalized <> ''
    GROUP BY sku_normalized HAVING count(*) > 1
  )
  SELECT product.id, product.sku::text AS sku, product.sku_normalized AS number, product.name, brand.name AS brand, tree.root
  FROM app.products AS product JOIN shared USING (sku_normalized)
  LEFT JOIN app.brands AS brand ON brand.id = product.brand_id
  LEFT JOIN tree ON tree.id = product.category_id
  WHERE product.deleted_at IS NULL AND product.is_active
  ORDER BY product.sku_normalized, product.name`);

const byId = new Map(rows.map((row) => [row.id, row]));
const byNumber = new Map();
for (const row of rows) byNumber.set(row.number, [...(byNumber.get(row.number) ?? []), row]);

const requests = rows.map((row) => ({ article: row.sku, brand: row.brand, productId: row.id }));
const offers = new Map();
for (let start = 0; start < requests.length; start += 400) {
  const batch = requests.slice(start, start + 400);
  const lookup = await shop.lookup(batch, 20);
  for (const request of batch) offers.set(request.productId, lookup.for(request).filter((offer) => offer.matchedVia === "exact" && offer.productId !== request.productId));
}

const QUEUE = new Set(["bez-kategorii", "ne-pokazyvat"]);
const apart = (a, b) => a.root !== b.root || QUEUE.has(a.root ?? "") || QUEUE.has(b.root ?? "");
const kind = (product) => partTypeKey(product.name);
const maker = (product) => product.brand?.toUpperCase() ?? null;
let mixed = 0;
let shownBefore = 0;
let kept = 0;
const legit = { maker: 0, original: 0 };
const wrong = [];
const dropped = [];
for (const [number, products] of byNumber) {
  for (const product of products) {
    const shownIds = new Set((offers.get(product.id) ?? []).map((offer) => offer.productId));
    for (const other of products) if (other !== product && !apart(product, other) && !shownIds.has(other.id)) dropped.push(`${number}: «${product.name}» ✗ «${other.name}»`);
  }
  if (products.some((a) => products.some((b) => a !== b && kind(a) !== kind(b)))) mixed += 1;
  if (products.some((a) => products.some((b) => a !== b && apart(a, b)))) shownBefore += 1;
  for (const product of products) {
    for (const offer of offers.get(product.id) ?? []) {
      const other = byId.get(offer.productId);
      if (!other) continue;
      if (!apart(product, other)) kept += 1;
      // Another section, but the same maker's part, or a vehicle maker's original number: one part filed twice.
      else if (maker(product) && maker(product) === maker(other)) legit.maker += 1;
      else if (originalPartCode(other.sku)) legit.original += 1;
      else wrong.push(`${number}: «${product.name}» → «${other.name}»`);
    }
  }
}
console.log(`numbers shared by several products: ${byNumber.size} (${rows.length} products); of them with products of different kinds: ${mixed}`);
console.log(`numbers whose products sit in different sections or the queue (a card used to show them all as the same part): ${shownBefore}`);
console.log(`same-part offers a card shows now: ${kept} in the same section; in another section ${legit.maker} of the same maker, ${legit.original} by a vehicle maker's original number`);
console.log(`offers of another section a card shows only because the number matches: ${wrong.length}`);
for (const line of wrong.slice(0, examples)) console.log(`  ${line}`);
console.log(`same-section products of the number a card no longer calls the same part (another maker, another kind, a short number): ${dropped.length}`);
for (const line of dropped.filter((_, index) => index % Math.max(1, Math.floor(dropped.length / examples)) === 0).slice(0, examples)) console.log(`  ${line}`);
await database.onModuleDestroy?.();
process.exit(wrong.length === 0 ? 0 : 1);
