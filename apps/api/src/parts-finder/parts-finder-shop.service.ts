import { Injectable } from "@nestjs/common";

import { normalizeArticleNumber, normalizeBrand, publicProductName, type ShopOffer } from "@an30/contracts";

import { originalPartCode } from "../catalog/catalog-original-numbers.js";
import { partTypeKey } from "../catalog/catalog-part-dictionary.js";
import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { sameNumberIsSamePart, sectionFromRoot, sideFromName, type PartSide } from "./same-part-number.js";

export interface ShopOfferRequest {
  article: string;
  brand?: string | null;
  /** What the requested part is called (a parts catalogue's description): tells the kind of part. */
  name?: string | null;
  /** Our product the request is about (its card): its own brand, section and name decide, not what the page sent. */
  productId?: string | null;
}

interface OfferRow {
  asked_brand: string | null;
  asked_known: boolean;
  asked_name: string | null;
  asked_root: string | null;
  available_quantity: string;
  brand_name: string | null;
  name: string;
  offered_brand: string | null;
  offered_root: string | null;
  price_kopeks: string | null;
  product_id: string;
  req_idx: number;
  sku: string;
  slug: string;
  via: number;
}

// One response never asks for more distinct parts than this (FAPI caps a
// card at 100 analogs; a vehicle list at 120 parts).
const MAX_REQUESTS = 500;
// The second step through a shared original number is for what a customer
// asks about (an article, a car's part list), not for a 500-part card.
const DEEP_LOOKUP_MAX_REQUESTS = 150;
// Products sharing one number that step 0 hands to sameNumberIsSamePart: the
// owner's base has at most a handful per number.
const SAME_NUMBER_CANDIDATES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * One batched lookup of АН-30 products for many (article, brand) pairs
 * (docs/CATALOG_MATCHING.md). A brand is compared by its identity
 * (app.canonical_brand: «MANN» = «MANN-FILTER», Toyota = Lexus), never by
 * spelling. Steps, weakest last:
 *  0 `exact`    product.sku_normalized equals the article. A number alone is
 *               not an identity: every candidate comes back with its brand and
 *               section, and sameNumberIsSamePart (same-part-number.ts) keeps
 *               only the requested part itself;
 *  1 `cross`    one confirmed pair of app.article_crosses, either direction;
 *  2 `possible` two confirmed pairs that meet in a vehicle maker's own
 *               number (X → OE ← Y): the parts replace the same original,
 *               which may still be two applications of it;
 *  3 `possible` one pair a single source asserted (not rejected by staff).
 * The cross target brand must be the product's brand; when the request names
 * a brand, the pair's near side must carry it too. A request about one of our
 * products (`product_id`) takes that product's brand. Step 2 runs only when
 * `$3` is true (small requests): it multiplies rows.
 * Ranking per part: step, same brand, in stock, priced, name; steps 1–3 are
 * cut at `$2` per part here, step 0 after the check.
 * Only active, non-deleted, publicly visible products.
 */
export const SHOP_OFFERS_SQL = `${VISIBLE_CATEGORIES_CTE},
category_root AS (
  SELECT ancestry.origin_id AS id,root.slug::text AS slug
  FROM category_ancestry AS ancestry JOIN app.categories AS root ON root.id=ancestry.current_id
  WHERE ancestry.parent_id IS NULL
), requested AS (
  SELECT request.idx,request.article,
         CASE WHEN asked.id IS NULL THEN request.brand ELSE COALESCE(asked_brand.name,'') END AS brand,
         asked.id IS NOT NULL AS asked_known,asked.name AS asked_name,asked_root.slug AS asked_root
  FROM jsonb_to_recordset($1::jsonb) AS request(idx int,article text,brand text,product_id uuid)
  LEFT JOIN app.products AS asked ON asked.id=request.product_id AND asked.deleted_at IS NULL
  LEFT JOIN app.brands AS asked_brand ON asked_brand.id=asked.brand_id
  LEFT JOIN category_root AS asked_root ON asked_root.id=asked.category_id
  WHERE request.article<>''
), hop1 AS (
  SELECT requested.idx AS req_idx,cross_pair.article_b AS article,
         cross_pair.brand_b AS brand,cross_pair.status,(cross_pair.relation='oe_b') AS is_oe
  FROM requested JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_a=requested.article AND cross_pair.status<>'rejected'
   AND (requested.brand='' OR app.canonical_brand(cross_pair.brand_a)=app.canonical_brand(requested.brand))
  UNION ALL
  SELECT requested.idx,cross_pair.article_a,cross_pair.brand_a,cross_pair.status,
         (cross_pair.relation='oe_a')
  FROM requested JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_b=requested.article AND cross_pair.status<>'rejected'
   AND (requested.brand='' OR app.canonical_brand(cross_pair.brand_b)=app.canonical_brand(requested.brand))
), hop2 AS (
  SELECT hop1.req_idx,cross_pair.article_b AS article,cross_pair.brand_b AS brand
  FROM hop1 JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_a=hop1.article AND app.canonical_brand(cross_pair.brand_a)=app.canonical_brand(hop1.brand)
   AND cross_pair.status='confirmed' AND cross_pair.relation='oe_a'
  WHERE $3::boolean AND hop1.status='confirmed' AND hop1.is_oe
  UNION ALL
  SELECT hop1.req_idx,cross_pair.article_a,cross_pair.brand_a
  FROM hop1 JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_b=hop1.article AND app.canonical_brand(cross_pair.brand_b)=app.canonical_brand(hop1.brand)
   AND cross_pair.status='confirmed' AND cross_pair.relation='oe_b'
  WHERE $3::boolean AND hop1.status='confirmed' AND hop1.is_oe
), equivalents AS (
  SELECT requested.idx AS req_idx,requested.article AS article,''::text AS brand,0 AS via
  FROM requested
  UNION ALL
  SELECT req_idx,article,brand,CASE WHEN status='confirmed' THEN 1 ELSE 3 END FROM hop1
  UNION ALL
  SELECT req_idx,article,brand,2 FROM hop2
), matches AS (
  -- A product sharing the number may also be a confirmed cross: it keeps both rows, in case the number is not enough.
  SELECT DISTINCT ON (equivalents.req_idx,product.id,equivalents.via=0)
         equivalents.req_idx,equivalents.via,product.id AS product_id,
         product.slug::text AS slug,product.name,product.sku::text AS sku,brand.name AS brand_name,
         NULLIF(app.canonical_brand(brand.name),'') AS offered_brand,offered_root.slug AS offered_root,
         price.amount_kopeks AS price_kopeks,GREATEST(stock.available_quantity,0) AS available_quantity,
         (requested.brand<>'' AND app.canonical_brand(brand.name)=app.canonical_brand(requested.brand)) AS same_brand
  FROM equivalents
  JOIN requested ON requested.idx=equivalents.req_idx
  JOIN app.products AS product ON product.sku_normalized=equivalents.article
  LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
  LEFT JOIN app.categories AS category ON category.id=product.category_id
  LEFT JOIN category_root AS offered_root ON offered_root.id=product.category_id
  LEFT JOIN app.current_product_prices AS price
    ON price.product_id=product.id AND price.currency='RUB'
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(balance.quantity_on_hand-balance.quantity_reserved),0)::bigint AS available_quantity
    FROM app.inventory_balances AS balance
    JOIN app.warehouses AS warehouse ON warehouse.id=balance.warehouse_id
    WHERE balance.product_id=product.id AND warehouse.is_active AND warehouse.deleted_at IS NULL
  ) AS stock ON true
  WHERE product.sku_normalized<>''
    AND product.is_active AND product.deleted_at IS NULL
    AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
    AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
    AND (equivalents.via=0 OR (brand.id IS NOT NULL AND app.canonical_brand(brand.name)=app.canonical_brand(equivalents.brand)))
  ORDER BY equivalents.req_idx,product.id,equivalents.via=0,equivalents.via
), ranked AS (
  SELECT matches.*,row_number() OVER (
    PARTITION BY req_idx,via=0
    ORDER BY via,same_brand DESC,(available_quantity>0) DESC,(price_kopeks IS NULL),name,product_id
  ) AS position,row_number() OVER (
    PARTITION BY req_idx
    ORDER BY via,same_brand DESC,(available_quantity>0) DESC,(price_kopeks IS NULL),name,product_id
  ) AS rank
  FROM matches
)
SELECT ranked.req_idx,ranked.via,ranked.product_id,ranked.slug,ranked.name,ranked.sku,ranked.brand_name,
       ranked.offered_brand,ranked.offered_root,
       NULLIF(app.canonical_brand(requested.brand),'') AS asked_brand,requested.asked_known,requested.asked_name,requested.asked_root,
       ranked.price_kopeks::text AS price_kopeks,ranked.available_quantity::text AS available_quantity
FROM ranked JOIN requested ON requested.idx=ranked.req_idx
WHERE ranked.position<=CASE WHEN ranked.via=0 THEN ${SAME_NUMBER_CANDIDATES} ELSE $2 END
ORDER BY ranked.req_idx,ranked.rank`;

export function articleKey(article: string): string {
  return normalizeArticleNumber(article);
}

export function brandKey(brand: string | null | undefined): string {
  return brand ? normalizeBrand(brand) : "";
}

function requestKey(request: ShopOfferRequest): string {
  const productId = request.productId && UUID.test(request.productId) ? request.productId.toLowerCase() : "";
  return [articleKey(request.article), brandKey(request.brand), productId, request.name?.trim() ?? ""].join("\u0000");
}

function safeInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Offers grouped per requested (article, brand) pair. */
export class ShopOfferLookup {
  constructor(private readonly offers: ReadonlyMap<string, ShopOffer[]>) {}

  for(request: ShopOfferRequest): ShopOffer[] {
    return [...(this.offers.get(requestKey(request)) ?? [])];
  }
}

@Injectable()
export class PartsFinderShopService {
  constructor(private readonly database: DatabaseService) {}

  /** One SQL query for every pair, whatever the number of parts in the response. */
  async lookup(requests: readonly ShopOfferRequest[], perPart: number): Promise<ShopOfferLookup> {
    const pending = new Map<string, { brand: string; idx: number; name: string; product_id: string | null; article: string }>();
    for (const request of requests) {
      const article = articleKey(request.article);
      if (!article || article.length > 64) continue;
      const key = requestKey(request);
      if (pending.has(key)) continue;
      const productId = request.productId && UUID.test(request.productId) ? request.productId : null;
      pending.set(key, { article, brand: brandKey(request.brand), idx: pending.size, name: request.name?.trim() ?? "", product_id: productId });
      if (pending.size >= MAX_REQUESTS) break;
    }
    if (pending.size === 0) return new ShopOfferLookup(new Map());
    const byIdx = [...pending.entries()];
    const result = await this.database.query<OfferRow>(SHOP_OFFERS_SQL, [
      JSON.stringify(byIdx.map(([, { article, brand, idx, product_id }]) => ({ article, brand, idx, product_id }))),
      perPart,
      pending.size <= DEEP_LOOKUP_MAX_REQUESTS,
    ]);
    const offers = new Map<string, ShopOffer[]>();
    const asked = new Map<number, PartSide | null>();
    for (const row of result.rows) {
      const [key, request] = byIdx[row.req_idx] ?? [];
      if (!key || !request) continue;
      if (row.via === 0) {
        if (!asked.has(row.req_idx)) asked.set(row.req_idx, askedSide(row, request.name));
        const offered: PartSide = {
          brand: row.offered_brand, originalNumber: originalPartCode(row.sku) !== null, section: sectionFromRoot(row.offered_root), type: partTypeKey(row.name),
        };
        // The product the request is about is always itself.
        if (row.product_id !== request.product_id && !sameNumberIsSamePart(request.article, asked.get(row.req_idx)!, offered)) continue;
      }
      const list = offers.get(key) ?? [];
      if (list.length >= perPart || list.some((offer) => offer.productId === row.product_id)) continue;
      list.push({
        availableQuantity: safeInteger(row.available_quantity) ?? 0,
        brand: row.brand_name,
        matchedVia: row.via === 0 ? "exact" : row.via === 1 ? "cross" : "possible",
        // Without the staff's notes typed into the name in 1С («(Ш)», «+++», the shelf box): product-name.ts.
        name: publicProductName(row.name),
        priceKopeks: safeInteger(row.price_kopeks),
        productId: row.product_id,
        sku: row.sku,
        slug: row.slug,
      });
      offers.set(key, list);
    }
    return new ShopOfferLookup(offers);
  }
}

/** What the request says of the part besides its number; null when it says nothing (a customer typed only the number). */
function askedSide(row: OfferRow, name: string): PartSide | null {
  if (row.asked_known) return { brand: row.asked_brand, section: sectionFromRoot(row.asked_root), type: row.asked_name ? partTypeKey(row.asked_name) : null };
  if (name) return sideFromName(row.asked_brand, name);
  return row.asked_brand ? { brand: row.asked_brand, section: null, type: null } : null;
}
