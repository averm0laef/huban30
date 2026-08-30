import { createHash } from "node:crypto";

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";

import {
  CatalogFeaturedQuerySchema,
  CatalogImageIdentifierSchema,
  CatalogProductIdentifierSchema,
  CatalogProductsQuerySchema,
  type CatalogProductsQuery,
} from "@an30/contracts";

import { STORAGE_PROVIDER, type StorageProvider } from "../adapters/provider-contracts.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import {
  etagMatches,
  withPublicCatalogQuery,
  withPublicMediaRead,
} from "../security/public-media.js";
import { buildCategoryTree } from "./catalog-category-tree.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { alternateSearchQueries, foldYo, normalizeArticleNumber } from "./catalog-search-normalize.js";
import { VISIBLE_CATEGORIES_CTE, visibleCategoriesWithSubtreeCte } from "./catalog-visibility.sql.js";

const PUBLIC_IMAGE_MIME_TYPES = ["image/avif", "image/jpeg", "image/png", "image/webp"] as const;
const MAX_PUBLIC_IMAGE_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface CategoryRow {
  description: string | null;
  id: string;
  name: string;
  parent_id: string | null;
  product_count: string;
  slug: string;
  sort_order: number;
}

interface CategoryTreeQueryRow extends CategoryRow {
  is_active: boolean;
}

interface BrandRow {
  id: string;
  name: string;
  product_count: string;
  slug: string;
}

interface ProductRow {
  available_quantity: string;
  brand_id: string | null;
  brand_name: string | null;
  brand_slug: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  created_at: Date;
  id: string;
  name: string;
  price_kopeks: string | null;
  primary_image_alt_text: string | null;
  primary_image_byte_size: string | null;
  primary_image_id: string | null;
  primary_image_is_primary: boolean | null;
  primary_image_mime_type: string | null;
  sku: string;
  slug: string;
  updated_at: Date;
}

interface ProductDetailRow extends ProductRow {
  description: string | null;
  public_attributes: Record<string, unknown>;
}

interface ProductImageRow {
  alt_text: string;
  byte_size: string;
  id: string;
  is_primary: boolean;
  mime_type: string;
  sort_order: number;
}

interface MediaRow {
  byte_size: string;
  mime_type: string;
  sha256: Buffer;
  storage_key: string;
}

const PUBLIC_PRODUCT_FROM = `FROM app.products AS product
  LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
  LEFT JOIN app.categories AS category ON category.id=product.category_id
  LEFT JOIN app.current_product_prices AS price
    ON price.product_id=product.id AND price.currency='RUB'
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(balance.quantity_on_hand-balance.quantity_reserved),0)::bigint
      AS available_quantity
    FROM app.inventory_balances AS balance
    JOIN app.warehouses AS warehouse ON warehouse.id=balance.warehouse_id
    WHERE balance.product_id=product.id
      AND warehouse.is_active AND warehouse.deleted_at IS NULL
  ) AS stock ON true`;

// $8 is the query normalised into an article key (see catalog-search-normalize.ts):
// case-folded, Cyrillic/Latin-homoglyph-folded, punctuation-stripped, compared
// against the generated app.products.sku_normalized column (migration 0016).
// This is what lets "W 914/2", "w914-2" and a Cyrillic-"С"-for-Latin-"C" typo
// all find the same part regardless of how 1C or the customer formatted it —
// it subsumes (and replaces) a plain case-insensitive sku prefix check.
// The trigram similarity() fallback on the name only ever matters once every
// exact/prefix article and substring/full-text branch above it has already
// failed, so a fuzzy name hit can add recall but can never hide a real match.
//
// cross_equivalents (see ARTICLE_CROSS_EQUIVALENTS_CTE) widens this one step
// further: every *confirmed* app.article_crosses equivalent of $8, so a
// search for an OEM number also finds the shop's own product listed only
// under an aftermarket number, and vice versa. It is a CTE joined into the
// same statement rather than a second query — see that constant's comment.
//
// $9 is alternateSearchQueries($1) (catalog-search-normalize.ts): 0-2 extra
// Cyrillic candidate strings recovering a query typed in Latin by mistake --
// a phonetic transliteration ("filtr" -> "филтр") and a keyboard-layout swap
// ("abkmnh" -> "фильтр"), see that function's doc for why both are needed
// and why they are computed in TypeScript once per request rather than as
// SQL. Matched exactly the same three ways ($1 already is above: substring,
// trigram, full-text) against each candidate via unnest, so this is still
// one statement, not a second query — same length>=3 low-precision guard
// applies to each candidate individually (see MIN_ALTERNATE_QUERY_LENGTH).
//
// $1, $2 and every $9 candidate are already ё/Ё-folded (foldYo, applied in
// products() below) by the time they reach this statement, and compared
// against product.name_folded / product.search_text_folded rather than the
// raw name/search_text columns — two generated columns migration 0025 adds,
// folded the identical way (app.fold_yo). Almost no customer types ё, so
// without folding both sides a product name stored with a ё (as 1C exports
// it) would be unreachable by the near-universal plain spelling — see that
// migration's comment.
//
// The extra to_tsvector('russian', ...) branch below is additive real
// (Snowball) stemming — PostgreSQL's built-in 'russian' text-search config,
// no extension needed — recovering *regular* Russian word-form variation
// ("фильтры" now finds "Фильтр ...") the 'simple' branch above it cannot,
// since 'simple' never stems. It does not recover every word form: see
// migration 0025's comment and catalog-public.service.test.ts for
// "щёток" -> "щётка", a deliberate, documented gap (an epenthetic vowel, not
// a suffix, so there is nothing for a suffix-stripping stemmer to strip).
const PUBLIC_PRODUCT_FILTERS = `product.is_active AND product.deleted_at IS NULL
  AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
  AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
  AND ($1::text IS NULL
    OR ($8<>'' AND product.sku_normalized LIKE $8 || '%')
    OR (product.sku_normalized<>'' AND EXISTS (
      SELECT 1 FROM cross_equivalents
      WHERE cross_equivalents.article=product.sku_normalized
        AND cross_equivalents.brand=app.normalize_brand(brand.name)
    ))
    OR (length($1)>=3 AND product.name_folded ILIKE '%' || $2 || '%' ESCAPE '\\')
    OR (length($1)>=3 AND similarity(product.name_folded, $1) > 0.25)
    OR to_tsvector('simple',product.search_text_folded)
      @@ websearch_to_tsquery('simple',$1)
    OR to_tsvector('russian',product.search_text_folded)
      @@ websearch_to_tsquery('russian',$1)
    OR (length($1)>=3 AND EXISTS (
      SELECT 1 FROM unnest($9::text[]) AS alt_query
      WHERE length(alt_query)>=3
        AND (product.name_folded ILIKE '%' || alt_query || '%' ESCAPE '\\'
          OR similarity(product.name_folded, alt_query) > 0.25
          OR to_tsvector('simple',product.search_text_folded)
            @@ websearch_to_tsquery('simple', alt_query))
    )))
  AND ($3::text IS NULL OR category.id IN (SELECT id FROM category_subtree))
  AND (cardinality($4::text[])=0 OR brand.slug::text=ANY($4::text[]))
  AND ($5::bigint IS NULL OR price.amount_kopeks >= $5)
  AND ($6::bigint IS NULL OR price.amount_kopeks <= $6)
  AND ($7::text='all' OR ($7='in_stock' AND stock.available_quantity>0)
    OR ($7='out_of_stock' AND stock.available_quantity=0))`;

// Every *confirmed* article-cross equivalent of the normalised query article
// ($8), read back in both stored directions (see migration 0018's
// table-level comment for why app.article_crosses stores one row per pair
// and is queried both ways instead of storing two mirrored rows). Spliced
// onto visibleCategoriesWithSubtreeCte's WITH clause as one more CTE (that
// function already returns a complete, unterminated-by-comma WITH clause) so
// this costs zero extra round trips — not a second query per search.
//
// The target brand travels with the target article: article numbers are not
// globally unique across manufacturers, and docs/CATALOG_MATCHING.md defines
// identity as normalised article + normalised brand. The product-side EXISTS
// therefore checks both fields; matching only article could return an
// unrelated Bosch OC90 for a confirmed MAHLE OC90 cross.
//
// Only status='confirmed' rows ever reach here — this is the actual
// enforcement point for the correctness bar in docs/CATALOG_MATCHING.md and
// this feature's own safety requirement: a cross weak enough to need human
// review (see article_crosses.status) must never silently widen a
// customer's search to a different part than the one they typed. $8='' (no
// article-shaped query) naturally yields zero rows here too, since
// app.article_crosses.article_a/article_b can never be '' (CHECK
// constraint) — no extra guard needed.
const ARTICLE_CROSS_EQUIVALENTS_CTE = `cross_equivalents AS (
  SELECT article_b AS article,brand_b AS brand FROM app.article_crosses
    WHERE article_a=$8 AND status='confirmed'
  UNION
  SELECT article_a AS article,brand_a AS brand FROM app.article_crosses
    WHERE article_b=$8 AND status='confirmed'
)`;

const PRODUCT_SELECT = `SELECT product.id,product.sku::text,product.name,product.slug::text,
  product.created_at,product.updated_at,price.amount_kopeks::text AS price_kopeks,
  stock.available_quantity::text,brand.id AS brand_id,brand.name AS brand_name,
  brand.slug::text AS brand_slug,category.id AS category_id,category.name AS category_name,
  category.slug::text AS category_slug`;

function safeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InternalServerErrorException(`Некорректное числовое значение каталога: ${label}`);
  }
  return parsed;
}

function escapeLike(value: string | undefined): string | null {
  return value ? value.replace(/[\\%_]/gu, (character) => `\\${character}`) : null;
}

@Injectable()
export class CatalogPublicService {
  constructor(
    private readonly categoryTreeCache: CatalogCategoryTreeCache,
    private readonly database: DatabaseService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async categories() {
    const result = await this.database.query<CategoryRow>(
      `${VISIBLE_CATEGORIES_CTE}
       SELECT category.id,category.parent_id,category.name,category.slug::text,
              category.description,category.sort_order,COALESCE(products.product_count,0)::text
                AS product_count
       FROM app.categories AS category
       LEFT JOIN LATERAL (
         SELECT count(*)::bigint AS product_count
         FROM app.products AS product
         LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
         WHERE product.category_id=category.id AND product.is_active AND product.deleted_at IS NULL
           AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
       ) AS products ON true
       WHERE category.id IN (SELECT id FROM visible_categories)
       ORDER BY category.sort_order,lower(category.name),category.id`,
    );
    return {
      items: result.rows.map((row) => ({
        description: row.description,
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        productCount: safeInteger(row.product_count, "category product count"),
        slug: row.slug,
        sortOrder: row.sort_order,
      })),
    };
  }

  /**
   * The full public category tree, nested with roll-up product counts —
   * `/catalog` browses its top level, `/catalog/[...slug]` walks down it.
   * Categories only change on a 1C batch apply/rollback (see
   * CatalogApplyService), so the assembled tree is cached until then instead
   * of being rebuilt on every request.
   */
  async categoryTree() {
    const cached = this.categoryTreeCache.read();
    if (cached) return { items: cached };
    const result = await this.database.query<CategoryTreeQueryRow>(
      `SELECT category.id,category.parent_id,category.name,category.slug::text,
              category.description,category.sort_order,category.is_active,
              COALESCE(products.product_count,0)::text AS product_count
       FROM app.categories AS category
       LEFT JOIN LATERAL (
         SELECT count(*)::bigint AS product_count
         FROM app.products AS product
         LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
         WHERE product.category_id=category.id AND product.is_active AND product.deleted_at IS NULL
           AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
       ) AS products ON true
       WHERE category.deleted_at IS NULL
       ORDER BY category.sort_order,lower(category.name),category.id`,
    );
    const items = buildCategoryTree(result.rows.map((row) => ({
      description: row.description,
      id: row.id,
      isActive: row.is_active,
      name: row.name,
      parentId: row.parent_id,
      productCount: safeInteger(row.product_count, "category product count"),
      slug: row.slug,
      sortOrder: row.sort_order,
    })));
    this.categoryTreeCache.write(items);
    return { items };
  }

  async brands() {
    const result = await this.database.query<BrandRow>(
      `${VISIBLE_CATEGORIES_CTE}
       SELECT brand.id,brand.name,brand.slug::text,COALESCE(products.product_count,0)::text
                AS product_count
       FROM app.brands AS brand
       LEFT JOIN LATERAL (
         SELECT count(*)::bigint AS product_count
         FROM app.products AS product
         LEFT JOIN app.categories AS category ON category.id=product.category_id
         WHERE product.brand_id=brand.id AND product.is_active AND product.deleted_at IS NULL
           AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
       ) AS products ON true
       WHERE brand.is_active AND brand.deleted_at IS NULL AND products.product_count>0
       ORDER BY lower(brand.name),brand.id`,
    );
    return {
      items: result.rows
        .map((row) => ({
          id: row.id,
          name: row.name,
          productCount: safeInteger(row.product_count, "brand product count"),
          slug: row.slug,
        }))
        .filter((brand) => brand.productCount > 0),
    };
  }

  async products(rawQuery: unknown) {
    const parsed = CatalogProductsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_catalog_query", issues: parsed.error.issues });
    }
    const query = parsed.data;
    // $1/$2 are ё/Ё-folded (foldYo) before they ever reach SQL, matching the
    // fold app.fold_yo applies when building product.name_folded/
    // .search_text_folded (migration 0025) — see PUBLIC_PRODUCT_FILTERS' own
    // comment for why both sides must agree. normalizeArticleNumber ($8
    // below) is computed from the un-folded query.q on purpose: article
    // matching has its own, separate Cyrillic/Latin homoglyph fold and does
    // not need (or want) the ё fold layered on top of it.
    const foldedQuery = query.q ? foldYo(query.q) : null;
    const values = [
      foldedQuery,
      escapeLike(foldedQuery ?? undefined),
      query.category ?? null,
      query.brand,
      query.minPriceKopeks ?? null,
      query.maxPriceKopeks ?? null,
      query.availability,
      // Empty (not null) when there is no query, so the SQL side can compare
      // with a plain <>'' guard instead of a three-valued NULL check.
      query.q ? normalizeArticleNumber(query.q) : "",
      // Escaped the same way $2 is, and ё/Ё-folded the same way $1 is, since
      // these feed the same folded-column ILIKE/trigram/full-text branches —
      // see PUBLIC_PRODUCT_FILTERS' $9 comment.
      query.q ? alternateSearchQueries(query.q).map((candidate) => {
        const foldedCandidate = foldYo(candidate);
        return escapeLike(foldedCandidate) ?? foldedCandidate;
      }) : [],
    ];
    const order = this.productOrder(query);
    return withPublicCatalogQuery(() => this.database.transaction(async (client) => {
      await client.query("SET LOCAL statement_timeout='2500ms'");
      const items = await client.query<ProductRow & { is_cross_match: boolean; total_count: string }>(
        `${visibleCategoriesWithSubtreeCte("$3")}, ${ARTICLE_CROSS_EQUIVALENTS_CTE}
         ${PRODUCT_SELECT},count(*) OVER()::text AS total_count,
                (NOT ($8<>'' AND product.sku_normalized LIKE $8 || '%')
                  AND product.sku_normalized<>'' AND EXISTS (
                  SELECT 1 FROM cross_equivalents
                  WHERE cross_equivalents.article=product.sku_normalized
                    AND cross_equivalents.brand=app.normalize_brand(brand.name)
                )) AS is_cross_match,
                primary_image.id AS primary_image_id,
                primary_image.alt_text AS primary_image_alt_text,
                primary_image.is_primary AS primary_image_is_primary,
                primary_image.mime_type AS primary_image_mime_type,
                primary_image.byte_size::text AS primary_image_byte_size
         ${PUBLIC_PRODUCT_FROM}
         LEFT JOIN LATERAL (
           SELECT image.id,image.alt_text,image.is_primary,storage.mime_type,storage.byte_size
           FROM app.product_images AS image
           JOIN app.storage_objects AS storage ON storage.id=image.storage_object_id
           WHERE image.product_id=product.id AND storage.provider=$10
             AND storage.status='available' AND storage.deleted_at IS NULL
             AND storage.mime_type=ANY($13::text[])
           ORDER BY image.is_primary DESC,image.sort_order,image.created_at,image.id LIMIT 1
         ) AS primary_image ON true
         WHERE ${PUBLIC_PRODUCT_FILTERS}
         ORDER BY ${order},product.id
         LIMIT $11 OFFSET $12`,
        [...values, this.storage.name, query.limit, query.offset, [...PUBLIC_IMAGE_MIME_TYPES]],
      );
      const fallbackCount = items.rows.length === 0 && query.offset > 0
        ? await client.query<{ count: string }>(
        `${visibleCategoriesWithSubtreeCte("$3")}, ${ARTICLE_CROSS_EQUIVALENTS_CTE}
         SELECT count(*)::text AS count ${PUBLIC_PRODUCT_FROM}
         WHERE ${PUBLIC_PRODUCT_FILTERS}`,
        values,
      )
        : null;
      return {
        items: items.rows.map((row) => this.productSummary(row, row.is_cross_match ? "cross" : "query")),
        limit: query.limit,
        offset: query.offset,
        total: safeInteger(
          items.rows[0]?.total_count ?? fallbackCount?.rows[0]?.count ?? "0",
          "product count",
        ),
      };
    }));
  }

  async product(idOrSlug: string) {
    const parsed = CatalogProductIdentifierSchema.safeParse(idOrSlug);
    if (!parsed.success) throw new BadRequestException("Некорректный идентификатор товара");
    const byId = UUID_PATTERN.test(parsed.data);
    const result = await this.database.query<ProductDetailRow>(
      `${VISIBLE_CATEGORIES_CTE}
       ${PRODUCT_SELECT},product.description,product.public_attributes,
              NULL::uuid AS primary_image_id,NULL::text AS primary_image_alt_text,
              NULL::boolean AS primary_image_is_primary,NULL::text AS primary_image_mime_type,
              NULL::text AS primary_image_byte_size
       ${PUBLIC_PRODUCT_FROM}
       WHERE product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         AND ${byId ? "product.id=$1::uuid" : "product.slug::text=$1"}
       LIMIT 1`,
      [parsed.data],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Товар не найден");
    const images = await this.database.query<ProductImageRow>(
      `SELECT image.id,image.alt_text,image.sort_order,image.is_primary,
              storage.mime_type,storage.byte_size::text
       FROM app.product_images AS image
       JOIN app.storage_objects AS storage ON storage.id=image.storage_object_id
       WHERE image.product_id=$1 AND storage.provider=$2
         AND storage.status='available' AND storage.deleted_at IS NULL
         AND storage.mime_type=ANY($3::text[])
       ORDER BY image.is_primary DESC,image.sort_order,image.created_at,image.id`,
      [row.id, this.storage.name, [...PUBLIC_IMAGE_MIME_TYPES]],
    );
    const imageViews = images.rows.map((image) => this.imageView(image));
    return {
      ...this.productSummary(row),
      attributes: row.public_attributes,
      description: row.description,
      images: imageViews,
      primaryImage: imageViews[0] ?? null,
    };
  }

  async featured(rawQuery: unknown) {
    const parsed = CatalogFeaturedQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_featured_query", issues: parsed.error.issues });
    }
    const result = await this.database.query<ProductRow>(
      `${VISIBLE_CATEGORIES_CTE}
       ${PRODUCT_SELECT},primary_image.id AS primary_image_id,
              primary_image.alt_text AS primary_image_alt_text,
              primary_image.is_primary AS primary_image_is_primary,
              primary_image.mime_type AS primary_image_mime_type,
              primary_image.byte_size::text AS primary_image_byte_size
       ${PUBLIC_PRODUCT_FROM}
       LEFT JOIN LATERAL (
         SELECT image.id,image.alt_text,image.is_primary,storage.mime_type,storage.byte_size
         FROM app.product_images AS image
         JOIN app.storage_objects AS storage ON storage.id=image.storage_object_id
         WHERE image.product_id=product.id AND storage.provider=$1
           AND storage.status='available' AND storage.deleted_at IS NULL
           AND storage.mime_type=ANY($3::text[])
         ORDER BY image.is_primary DESC,image.sort_order,image.created_at,image.id LIMIT 1
       ) AS primary_image ON true
       WHERE product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         AND price.amount_kopeks IS NOT NULL AND stock.available_quantity>0
       ORDER BY product.updated_at DESC,product.id LIMIT $2`,
      [this.storage.name, parsed.data.limit, [...PUBLIC_IMAGE_MIME_TYPES]],
    );
    return {
      items: result.rows.map((row) => this.productSummary(row)),
      selection: "available_recent" as const,
    };
  }

  async media(imageId: string, ifNoneMatch?: string) {
    const parsed = CatalogImageIdentifierSchema.safeParse(imageId);
    if (!parsed.success) {
      throw new BadRequestException("Некорректный идентификатор изображения");
    }
    const media = (await this.database.query<MediaRow>(
      `${VISIBLE_CATEGORIES_CTE}
       SELECT storage.storage_key,storage.mime_type,storage.byte_size::text,storage.sha256
       FROM app.product_images AS image
       JOIN app.products AS product ON product.id=image.product_id
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       JOIN app.storage_objects AS storage ON storage.id=image.storage_object_id
       WHERE image.id=$1 AND storage.provider=$2
         AND product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         AND storage.status='available' AND storage.deleted_at IS NULL
         AND storage.mime_type=ANY($3::text[])
       LIMIT 1`,
      [parsed.data, this.storage.name, [...PUBLIC_IMAGE_MIME_TYPES]],
    )).rows[0];
    if (!media) throw new NotFoundException("Изображение не найдено");

    const expectedSize = safeInteger(media.byte_size, "image byte size");
    if (expectedSize < 1 || expectedSize > MAX_PUBLIC_IMAGE_BYTES || media.sha256.length !== 32) {
      throw new NotFoundException("Изображение недоступно");
    }

    const etag = `"sha256-${media.sha256.toString("base64url")}"`;
    if (etagMatches(ifNoneMatch, etag)) {
      return { content: null, etag, mimeType: media.mime_type };
    }

    return withPublicMediaRead(async () => {
      let content: Buffer;
      try {
        content = await this.storage.read(media.storage_key);
      } catch {
        throw new NotFoundException("Изображение не найдено");
      }
      const detected = await fileTypeFromBuffer(content);
      const digest = createHash("sha256").update(content).digest();
      if (content.length !== expectedSize || detected?.mime !== media.mime_type || !digest.equals(media.sha256)) {
        throw new NotFoundException("Изображение повреждено");
      }
      return { content, etag, mimeType: media.mime_type };
    });
  }

  private imageView(image: ProductImageRow) {
    return {
      altText: image.alt_text,
      byteSize: safeInteger(image.byte_size, "image byte size"),
      id: image.id,
      isPrimary: image.is_primary,
      mimeType: image.mime_type,
      sortOrder: image.sort_order,
      url: `/api/v1/catalog/media/${image.id}`,
    };
  }

  private productSummary(row: ProductRow, matchedVia: "cross" | "query" = "query") {
    const image = row.primary_image_id && row.primary_image_alt_text
      && row.primary_image_mime_type && row.primary_image_byte_size
      ? this.imageView({
          alt_text: row.primary_image_alt_text,
          byte_size: row.primary_image_byte_size,
          id: row.primary_image_id,
          is_primary: row.primary_image_is_primary ?? false,
          mime_type: row.primary_image_mime_type,
          sort_order: 0,
        })
      : null;
    return {
      availableQuantity: safeInteger(row.available_quantity, "available quantity"),
      brand: row.brand_id ? { id: row.brand_id, name: row.brand_name!, slug: row.brand_slug! } : null,
      category: row.category_id
        ? { id: row.category_id, name: row.category_name!, slug: row.category_slug! }
        : null,
      createdAt: row.created_at.toISOString(),
      id: row.id,
      matchedVia,
      name: row.name,
      priceKopeks: row.price_kopeks === null ? null : safeInteger(row.price_kopeks, "price"),
      primaryImage: image,
      sku: row.sku,
      slug: row.slug,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private productOrder(query: CatalogProductsQuery): string {
    switch (query.sort) {
      case "newest": return "product.created_at DESC";
      case "name": return "lower(product.name) ASC";
      case "price_asc": return "price.amount_kopeks ASC NULLS LAST";
      case "price_desc": return "price.amount_kopeks DESC NULLS LAST";
      // Ranking never lets a fuzzy match outrank an exact one: an exact
      // normalised-article match is tier 1, a confirmed cross-equivalent
      // article is tier 2 (still an exact identity match, just under a
      // different known-equivalent number — see ARTICLE_CROSS_EQUIVALENTS_CTE),
      // a plain prefix match is tier 3 (all insensitive to case, W/w, "-"/"
      // "/"/" and the Cyrillic homoglyphs a customer's keyboard can
      // substitute — see catalog-search-normalize.ts), and only once none of
      // those apply does trigram/full-text relevance on the product name
      // decide the order.
      case "relevance": return query.q
        ? `($8<>'' AND product.sku_normalized=$8) DESC,
           (product.sku_normalized<>'' AND EXISTS (
             SELECT 1 FROM cross_equivalents
             WHERE cross_equivalents.article=product.sku_normalized
               AND cross_equivalents.brand=app.normalize_brand(brand.name)
           )) DESC,
           ($8<>'' AND product.sku_normalized LIKE $8 || '%') DESC,
           GREATEST(
             similarity(product.name_folded, $1),
             ts_rank_cd(to_tsvector('simple',product.search_text_folded),
               websearch_to_tsquery('simple',$1)),
             -- Real (Snowball) Russian stemming via PostgreSQL's built-in
             -- 'russian' text-search config — see PUBLIC_PRODUCT_FILTERS'
             -- comment for what this does and does not recover. Exactly as
             -- much of a fuzzy, last-resort signal as the other two terms
             -- here, never a promotion over a real article/prefix match.
             ts_rank_cd(to_tsvector('russian',product.search_text_folded),
               websearch_to_tsquery('russian',$1)),
             -- A Latin-transliteration/layout-swap recovery (see $9's comment
             -- on PUBLIC_PRODUCT_FILTERS) is exactly as much of a fuzzy,
             -- last-resort signal as the others above, never a promotion over
             -- a real article/prefix match — folded into the same
             -- GREATEST(), not a new tier.
             COALESCE((
               SELECT max(similarity(product.name_folded, alt_query))
               FROM unnest($9::text[]) AS alt_query WHERE length(alt_query)>=3
             ), 0)
           ) DESC,
           lower(product.name) ASC`
        : "product.updated_at DESC";
    }
  }
}
