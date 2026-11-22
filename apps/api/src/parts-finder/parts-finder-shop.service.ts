import { Injectable } from "@nestjs/common";

import { normalizeArticleNumber, normalizeBrand, publicProductName, type ShopOffer } from "@an30/contracts";

import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";
import { DatabaseService } from "../infrastructure/database.service.js";

export interface ShopOfferRequest {
  article: string;
  brand?: string | null;
}

interface OfferRow {
  available_quantity: string;
  brand_name: string | null;
  name: string;
  price_kopeks: string | null;
  product_id: string;
  req_article: string;
  req_brand: string;
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

/**
 * One batched lookup of АН-30 products for many (article, brand) pairs
 * (docs/CATALOG_MATCHING.md). A brand is compared by its identity
 * (app.canonical_brand: «MANN» = «MANN-FILTER», Toyota = Lexus), never by
 * spelling. Steps, weakest last:
 *  0 `exact`    product.sku_normalized equals the article (any brand, the
 *               same brand ranked first — a number alone is not an identity);
 *  1 `cross`    one confirmed pair of app.article_crosses, either direction;
 *  2 `possible` two confirmed pairs that meet in a vehicle maker's own
 *               number (X → OE ← Y): the parts replace the same original,
 *               which may still be two applications of it;
 *  3 `possible` one pair a single source asserted (not rejected by staff).
 * The cross target brand must be the product's brand; when the request names
 * a brand, the pair's near side must carry it too. Step 2 runs only when
 * `$3` is true (small requests): it multiplies rows.
 * Ranking per part: step, same brand, in stock, priced, name.
 * Only active, non-deleted, publicly visible products.
 */
export const SHOP_OFFERS_SQL = `${VISIBLE_CATEGORIES_CTE},
requested AS (
  SELECT DISTINCT article,brand FROM jsonb_to_recordset($1::jsonb) AS request(article text,brand text)
  WHERE article<>''
), hop1 AS (
  SELECT requested.article AS req_article,requested.brand AS req_brand,cross_pair.article_b AS article,
         cross_pair.brand_b AS brand,cross_pair.status,(cross_pair.relation='oe_b') AS is_oe
  FROM requested JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_a=requested.article AND cross_pair.status<>'rejected'
   AND (requested.brand='' OR app.canonical_brand(cross_pair.brand_a)=app.canonical_brand(requested.brand))
  UNION ALL
  SELECT requested.article,requested.brand,cross_pair.article_a,cross_pair.brand_a,cross_pair.status,
         (cross_pair.relation='oe_a')
  FROM requested JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_b=requested.article AND cross_pair.status<>'rejected'
   AND (requested.brand='' OR app.canonical_brand(cross_pair.brand_b)=app.canonical_brand(requested.brand))
), hop2 AS (
  SELECT hop1.req_article,hop1.req_brand,cross_pair.article_b AS article,cross_pair.brand_b AS brand
  FROM hop1 JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_a=hop1.article AND app.canonical_brand(cross_pair.brand_a)=app.canonical_brand(hop1.brand)
   AND cross_pair.status='confirmed' AND cross_pair.relation='oe_a'
  WHERE $3::boolean AND hop1.status='confirmed' AND hop1.is_oe
  UNION ALL
  SELECT hop1.req_article,hop1.req_brand,cross_pair.article_a,cross_pair.brand_a
  FROM hop1 JOIN app.article_crosses AS cross_pair
    ON cross_pair.article_b=hop1.article AND app.canonical_brand(cross_pair.brand_b)=app.canonical_brand(hop1.brand)
   AND cross_pair.status='confirmed' AND cross_pair.relation='oe_b'
  WHERE $3::boolean AND hop1.status='confirmed' AND hop1.is_oe
), equivalents AS (
  SELECT requested.article AS req_article,requested.brand AS req_brand,requested.article AS article,
         ''::text AS brand,0 AS via
  FROM requested
  UNION ALL
  SELECT req_article,req_brand,article,brand,CASE WHEN status='confirmed' THEN 1 ELSE 3 END FROM hop1
  UNION ALL
  SELECT req_article,req_brand,article,brand,2 FROM hop2
), matches AS (
  SELECT DISTINCT ON (equivalents.req_article,equivalents.req_brand,product.id)
         equivalents.req_article,equivalents.req_brand,equivalents.via,product.id AS product_id,
         product.slug::text AS slug,product.name,product.sku::text AS sku,brand.name AS brand_name,
         price.amount_kopeks AS price_kopeks,GREATEST(stock.available_quantity,0) AS available_quantity,
         (equivalents.req_brand<>'' AND app.canonical_brand(brand.name)=app.canonical_brand(equivalents.req_brand)) AS same_brand
  FROM equivalents
  JOIN app.products AS product ON product.sku_normalized=equivalents.article
  LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
  LEFT JOIN app.categories AS category ON category.id=product.category_id
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
  ORDER BY equivalents.req_article,equivalents.req_brand,product.id,equivalents.via
), ranked AS (
  SELECT matches.*,row_number() OVER (
    PARTITION BY req_article,req_brand
    ORDER BY via,same_brand DESC,(available_quantity>0) DESC,(price_kopeks IS NULL),name,product_id
  ) AS position
  FROM matches
)
SELECT req_article,req_brand,via,product_id,slug,name,sku,brand_name,
       price_kopeks::text AS price_kopeks,available_quantity::text AS available_quantity
FROM ranked WHERE position<=$2
ORDER BY req_article,req_brand,position`;

export function articleKey(article: string): string {
  return normalizeArticleNumber(article);
}

export function brandKey(brand: string | null | undefined): string {
  return brand ? normalizeBrand(brand) : "";
}

function lookupKey(article: string, brand: string): string {
  return `${article}\u0000${brand}`;
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
    return [...(this.offers.get(lookupKey(articleKey(request.article), brandKey(request.brand))) ?? [])];
  }
}

@Injectable()
export class PartsFinderShopService {
  constructor(private readonly database: DatabaseService) {}

  /** One SQL query for every pair, whatever the number of parts in the response. */
  async lookup(requests: readonly ShopOfferRequest[], perPart: number): Promise<ShopOfferLookup> {
    const pairs = new Map<string, { article: string; brand: string }>();
    for (const request of requests) {
      const article = articleKey(request.article);
      if (!article || article.length > 64) continue;
      const brand = brandKey(request.brand);
      pairs.set(lookupKey(article, brand), { article, brand });
      if (pairs.size >= MAX_REQUESTS) break;
    }
    if (pairs.size === 0) return new ShopOfferLookup(new Map());
    const result = await this.database.query<OfferRow>(SHOP_OFFERS_SQL, [JSON.stringify([...pairs.values()]), perPart, pairs.size <= DEEP_LOOKUP_MAX_REQUESTS]);
    const offers = new Map<string, ShopOffer[]>();
    for (const row of result.rows) {
      const key = lookupKey(row.req_article, row.req_brand);
      const list = offers.get(key) ?? [];
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
