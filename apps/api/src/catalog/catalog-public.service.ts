import { createHash } from "node:crypto";

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";

import {
  CatalogFeaturedQuerySchema,
  CatalogImageIdentifierSchema,
  CatalogProductIdentifierSchema,
  CatalogProductsQuerySchema,
  publicProductName,
  CATALOG_SITEMAP_PART_SIZE,
  CatalogSitemapQuerySchema,
  type CatalogProductsQuery,
  CATALOG_VEHICLE_KINDS,
  type CatalogVehicleKind,
} from "@an30/contracts";

import { PRODUCT_PHOTO_STORAGE, type ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import {
  etagMatches,
  withPublicCatalogQuery,
  withPublicMediaRead,
} from "../security/public-media.js";
import { buildCategoryTree } from "./catalog-category-tree.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { originalNumbersIn } from "./catalog-original-numbers.js";
import { packLabel, packOf, partSpecs, specLabels, type ProductPack } from "./catalog-part-specs.js";
import { alternateSearchQueries, catalogPartsAlias, foldYo } from "./catalog-search-normalize.js";
import { catalogSearchIdentity } from "./catalog-search-identity.js";
import {
  catalogSearchCte,
  catalogSearchFilter,
  catalogSearchRelevanceOrder,
  CROSS_MATCH,
  type CatalogSearchInput,
  escapeLike,
  NAME_ORDER,
  SqlParameters,
} from "./catalog-search-sql.js";
import { searchTokenPlan } from "./catalog-search-tokens.js";
import {
  catalogSearchIsFreeText,
  CATALOG_SEARCH_ENGINE,
  type CatalogSearchEngine,
  catalogSearchEngineFromEnvironment,
} from "./catalog-search-engine.js";
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
  catalogue_image?: string | null;
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
  provider: string;
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

// The search WHERE/ORDER BY are generated per request in
// catalog-search-sql.ts (index-friendly, one OR-group per query word); see
// that file and catalog-search-tokens.ts for how a query is matched.

const PRODUCT_SELECT = `SELECT product.id,product.sku::text,product.name,product.slug::text,
  product.created_at,product.updated_at,price.amount_kopeks::text AS price_kopeks,
  stock.available_quantity::text,brand.id AS brand_id,brand.name AS brand_name,
  brand.slug::text AS brand_slug,category.id AS category_id,category.name AS category_name,
  category.slug::text AS category_slug,
  (SELECT card.photos[1] FROM app.product_catalogue_cards AS card
   WHERE card.product_id=product.id AND card.product_sku=product.sku) AS catalogue_image`;

/** How often app.product_popularity is brought up to date. */
const POPULARITY_REFRESH_MS = 15 * 60_000;

function safeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InternalServerErrorException(`Некорректное числовое значение каталога: ${label}`);
  }
  return parsed;
}

/**
 * A pasted article often carries a tab, a line break or a non-breaking
 * space ("W914\t2" from a spreadsheet). The contract rejects control
 * characters, which used to turn such a search into an error page; read
 * them as the spaces they stand for instead.
 */
function withSingleLineSearchText(rawQuery: unknown): unknown {
  if (!rawQuery || typeof rawQuery !== "object" || typeof (rawQuery as { q?: unknown }).q !== "string") return rawQuery;
  const q = (rawQuery as { q: string }).q.replace(/[\s\u0000-\u001f\u007f]+/gu, " ").trim();
  return { ...(rawQuery as Record<string, unknown>), q };
}

/**
 * The key of a section's first page without a search or filters — what every visitor opening the section asks
 * for, kept for half a minute (CatalogCategoryTreeCache.readFirstPage); null for anything else.
 */
function firstPageKey(query: CatalogProductsQuery): string | null {
  if (query.q || query.brand.length > 0 || query.availability !== "all" || query.offset !== 0) return null;
  // Kept pages are few and the same for everyone: a list narrowed by vehicle kind or ordered by a number that
  // changes through the day (popularity) is read every time.
  if (query.vehicleKind || query.sort === "popular") return null;
  if (query.minPriceKopeks !== undefined || query.maxPriceKopeks !== undefined) return null;
  return JSON.stringify([query.category ?? "", query.sort, query.limit]);
}

@Injectable()
export class CatalogPublicService {
  private readonly engine: CatalogSearchEngine | null;

  constructor(
    private readonly categoryTreeCache: CatalogCategoryTreeCache,
    private readonly database: DatabaseService,
    @Inject(PRODUCT_PHOTO_STORAGE) private readonly photos: ProductPhotoStorage,
    // Optional external search engine (docs/SEARCH_ENGINE.md). Not
    // registered by default: then SEARCH_ENGINE in the environment decides,
    // and with it unset PostgreSQL alone answers every search.
    @Optional() @Inject(CATALOG_SEARCH_ENGINE) engine?: CatalogSearchEngine | null,
  ) {
    this.engine = engine === undefined ? catalogSearchEngineFromEnvironment(process.env) : engine;
  }

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
       ORDER BY category.sort_order,lower(category.name) COLLATE app.russian_names,category.id`,
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
       ORDER BY category.sort_order,lower(category.name) COLLATE app.russian_names,category.id`,
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

  /**
   * Brands for the filter rail. With a category slug, only brands that
   * actually have products in that section (and its subsections) are
   * returned, with counts for that section — never brands with zero hits.
   */
  async brands(rawCategory?: unknown) {
    const category = typeof rawCategory === "string" && rawCategory.length <= 180
      && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(rawCategory)
      ? rawCategory
      : null;
    const result = await this.database.query<BrandRow>(
      `${visibleCategoriesWithSubtreeCte("$1")}
       SELECT brand.id,brand.name,brand.slug::text,COALESCE(products.product_count,0)::text
                AS product_count
       FROM app.brands AS brand
       LEFT JOIN LATERAL (
         SELECT count(*)::bigint AS product_count
         FROM app.products AS product
         LEFT JOIN app.categories AS category ON category.id=product.category_id
         WHERE product.brand_id=brand.id AND product.is_active AND product.deleted_at IS NULL
           AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
           AND ($1::text IS NULL OR category.id IN (SELECT id FROM category_subtree))
       ) AS products ON true
       WHERE brand.is_active AND brand.deleted_at IS NULL AND products.product_count>0
       ORDER BY lower(brand.name) COLLATE app.russian_names,brand.id`,
      [category],
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
    const parsed = CatalogProductsQuerySchema.safeParse(withSingleLineSearchText(rawQuery));
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_catalog_query", issues: parsed.error.issues });
    }
    const query = parsed.data;
    const firstPage = firstPageKey(query);
    if (firstPage) {
      const kept = this.categoryTreeCache.readFirstPage(firstPage);
      if (kept) return kept as Awaited<ReturnType<CatalogPublicService["searchProducts"]>>;
      const page = await this.searchProducts(query);
      this.categoryTreeCache.writeFirstPage(firstPage, page);
      return page;
    }
    return this.searchProducts(query);
  }

  private async searchProducts(query: CatalogProductsQuery) {
    // Free text is ё/Ё-folded before it reaches SQL, matching app.fold_yo on
    // the stored name_folded/search_text_folded columns (migration 0025).
    // The article key has its own homoglyph fold (normalizeArticleNumber).
    const partsAlias = query.q ? catalogPartsAlias(query.q) : undefined;
    const alternates = query.q ? alternateSearchQueries(foldYo(query.q)) : [];
    if (partsAlias) alternates.unshift(partsAlias);
    const input: CatalogSearchInput = {
      alternates: alternates.map(foldYo),
      folded: query.q ? foldYo(query.q) : null,
      identity: catalogSearchIdentity(query.q),
      plan: query.q ? searchTokenPlan(query.q) : { alternatives: [], leads: [], words: [] },
      query,
    };
    if (query.sort === "popular") this.refreshPopularity();
    // The engine's index knows neither the vehicle kind nor the popularity: PostgreSQL answers those lists.
    const engineCanAnswer = !query.vehicleKind && query.sort !== "popular";
    if (this.engine && engineCanAnswer && input.folded !== null && catalogSearchIsFreeText(input)) {
      const viaEngine = await withPublicCatalogQuery(() => this.productsFromEngine(this.engine!, input));
      if (viaEngine) return viaEngine;
    }
    return withPublicCatalogQuery(() => this.database.transaction(async (client) => {
      await client.query("SET LOCAL statement_timeout='2500ms'");
      await client.query("SET LOCAL pg_trgm.similarity_threshold=0.25");
      const strict = await this.productPage(client, input, false);
      // Nothing matched every word: show what matches any of them, or is
      // close to the whole query, instead of an empty page, and say so
      // (matchMode "any"). A concrete part number is never relaxed.
      if (!input.identity.articleOnly && strict.total === 0 && input.plan.words.length >= 1) {
        const relaxed = await this.productPage(client, input, true);
        if (relaxed.total > 0) return { ...relaxed, matchMode: "any" as const };
      }
      return { ...strict, matchMode: "all" as const };
    }));
  }

  private popularityRefreshedAt = 0;

  /**
   * app.product_popularity is a stored count (migration 0053). It is brought up to date at most once in
   * POPULARITY_REFRESH_MS, in the background: the list that asked for it does not wait, the next one reads it fresh.
   */
  private refreshPopularity(): void {
    const now = Date.now();
    if (now - this.popularityRefreshedAt < POPULARITY_REFRESH_MS) return;
    this.popularityRefreshedAt = now;
    void this.database.query("SELECT app.refresh_product_popularity()").catch(() => {
      // Another API process is refreshing it, or the database is busy: the stored count stays as it was.
      this.popularityRefreshedAt = 0;
    });
  }

  /**
   * How many public products are for each kind of vehicle, in the whole catalogue or in one section with its
   * subsections; a kind with no products is left out, so the storefront never offers an empty list.
   */
  async vehicleKinds(rawCategory?: unknown) {
    const category = typeof rawCategory === "string" && rawCategory.length <= 180
      && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(rawCategory)
      ? rawCategory
      : null;
    const result = await this.database.query<{ kind: CatalogVehicleKind; product_count: string }>(
      `${visibleCategoriesWithSubtreeCte("$1")}
       SELECT product.vehicle_kind AS kind,count(*)::text AS product_count
       FROM app.products AS product
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       WHERE product.vehicle_kind IS NOT NULL AND product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         AND ($1::text IS NULL OR category.id IN (SELECT id FROM category_subtree))
       GROUP BY product.vehicle_kind`,
      [category],
    );
    const counts = new Map(result.rows.map((row) => [row.kind, safeInteger(row.product_count, "vehicle kind product count")]));
    return {
      items: CATALOG_VEHICLE_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0)
        .map((kind) => ({ kind, productCount: counts.get(kind)! })),
    };
  }

  /**
   * The same product in other packs: «Масло Totachi 5W-30 1 л» beside «… 4 л» and «… 20 л». Same maker, same
   * section and the very same name once the pack and the article are taken out of it — a different viscosity or line is another
   * product, not another pack. Smallest pack first.
   */
  private async packSizes(row: ProductDetailRow) {
    const own = packOf(row.name, row.sku);
    if (!own) return [];
    const result = await this.database.query<ProductRow>(
      `${VISIBLE_CATEGORIES_CTE}
       ${PRODUCT_SELECT},NULL::uuid AS primary_image_id,NULL::text AS primary_image_alt_text,
              NULL::boolean AS primary_image_is_primary,NULL::text AS primary_image_mime_type,
              NULL::text AS primary_image_byte_size
       ${PUBLIC_PRODUCT_FROM}
       WHERE product.is_active AND product.deleted_at IS NULL AND product.id<>$1
         AND product.brand_id IS NOT DISTINCT FROM $2::uuid AND product.category_id IS NOT DISTINCT FROM $3::uuid
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         AND product.name_folded % $4
       ORDER BY similarity(product.name_folded,$4) DESC,product.id LIMIT 60`,
      [row.id, row.brand_id, row.category_id, foldYo(row.name)],
    );
    const packs = new Map<string, { pack: ProductPack; row: ProductRow }>();
    for (const candidate of result.rows) {
      const pack = packOf(candidate.name, candidate.sku);
      if (!pack || pack.key !== own.key || (pack.unit === own.unit && pack.amount === own.amount)) continue;
      const size = `${pack.unit}:${pack.amount}`;
      const kept = packs.get(size);
      // Two cards of one pack (the owner's base has such doubles): the one that can be bought stands for it.
      if (!kept || (Number(kept.row.available_quantity) <= 0 && Number(candidate.available_quantity) > 0)) packs.set(size, { pack, row: candidate });
    }
    return [...packs.values()]
      .sort((left, right) => left.pack.unit.localeCompare(right.pack.unit) || left.pack.amount - right.pack.amount)
      .slice(0, 12)
      .map(({ pack, row: candidate }) => {
        const summary = this.productSummary(candidate);
        return {
          availableQuantity: summary.availableQuantity, label: packLabel(pack), name: summary.name,
          priceKopeks: summary.priceKopeks, slug: summary.slug,
        };
      });
  }

  /**
   * Free-text search through the external engine: ranked ids from the
   * engine, rows (price, stock, image, visibility) from PostgreSQL in that
   * order. Null when the engine cannot answer, so PostgreSQL does.
   */
  private async productsFromEngine(engine: CatalogSearchEngine, input: CatalogSearchInput) {
    let matchMode: "all" | "any" = "all";
    let found = await engine.search(input, false);
    if (found && found.total === 0 && !input.identity.articleOnly) {
      const relaxed = await engine.search(input, true);
      if (relaxed === null) return null;
      if (relaxed.total > 0) {
        found = relaxed;
        matchMode = "any";
      }
    }
    if (!found) return null;
    const p = new SqlParameters();
    const ids = p.add(found.ids);
    const rows = found.ids.length === 0 ? [] : (await this.database.query<ProductRow>(
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
         WHERE image.product_id=product.id AND storage.provider=ANY(${p.add([...this.photos.providerNames])}::text[])
           AND storage.status='available' AND storage.deleted_at IS NULL
           AND storage.mime_type=ANY(${p.add([...PUBLIC_IMAGE_MIME_TYPES])}::text[])
         ORDER BY image.is_primary DESC,image.sort_order,image.created_at,image.id LIMIT 1
       ) AS primary_image ON true
       WHERE product.id=ANY(${ids}::uuid[])
         AND product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
       ORDER BY array_position(${ids}::uuid[],product.id)`,
      p.values,
    )).rows;
    return {
      items: rows.map((row) => this.productSummary(row)),
      limit: input.query.limit,
      matchMode,
      offset: input.query.offset,
      // A product hidden after it was indexed is dropped from the page above
      // and from the count; the indexer removes it from the engine shortly.
      total: Math.max(0, found.total - (found.ids.length - rows.length)),
    };
  }

  private async productPage(client: { query: DatabaseService["query"] }, input: CatalogSearchInput, matchAny: boolean) {
    const { query } = input;
    // Candidates for a typo, for the trigram index; how close the word has to be is decided in wordConditions.
    await client.query("SET LOCAL pg_trgm.word_similarity_threshold=0.4");
    const p = new SqlParameters();
    const cte = catalogSearchCte(p, input, visibleCategoriesWithSubtreeCte);
    const where = catalogSearchFilter(p, input, matchAny);
    const { join, order } = this.productOrder(p, input, cte.article);
    const items = await client.query<ProductRow & { is_cross_match: boolean; total_count: string }>(
      `${cte.sql}
       ${PRODUCT_SELECT},count(*) OVER()::text AS total_count,
              (NOT (${cte.article}<>'' AND product.sku_normalized LIKE ${p.add(`${escapeLike(input.identity.article)}%`)}) AND ${CROSS_MATCH}) AS is_cross_match,
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
         WHERE image.product_id=product.id AND storage.provider=ANY(${p.add([...this.photos.providerNames])}::text[])
           AND storage.status='available' AND storage.deleted_at IS NULL
           AND storage.mime_type=ANY(${p.add([...PUBLIC_IMAGE_MIME_TYPES])}::text[])
         ORDER BY image.is_primary DESC,image.sort_order,image.created_at,image.id LIMIT 1
       ) AS primary_image ON true
       ${join}
       WHERE ${where}
       ORDER BY ${order},product.id
       LIMIT ${p.add(query.limit)} OFFSET ${p.add(query.offset)}`,
      p.values,
    );
    let total = items.rows[0]?.total_count;
    if (total === undefined && query.offset > 0) {
      const count = new SqlParameters();
      const countCte = catalogSearchCte(count, input, visibleCategoriesWithSubtreeCte);
      const countWhere = catalogSearchFilter(count, input, matchAny);
      total = (await client.query<{ count: string }>(
        `${countCte.sql}
         SELECT count(*)::text AS count ${PUBLIC_PRODUCT_FROM}
         WHERE ${countWhere}`,
        count.values,
      )).rows[0]?.count;
    }
    return {
      items: items.rows.map((row) => this.productSummary(row, row.is_cross_match ? "cross" : "query")),
      limit: query.limit,
      offset: query.offset,
      total: safeInteger(total ?? "0", "product count"),
    };
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
    if (!row) {
      const movedTo = byId ? null : await this.currentSlug(parsed.data);
      throw new NotFoundException(movedTo ? { message: "Товар не найден", movedTo, statusCode: 404 } : "Товар не найден");
    }
    const images = await this.database.query<ProductImageRow>(
      `SELECT image.id,image.alt_text,image.sort_order,image.is_primary,
              storage.mime_type,storage.byte_size::text
       FROM app.product_images AS image
       JOIN app.storage_objects AS storage ON storage.id=image.storage_object_id
       WHERE image.product_id=$1 AND storage.provider=ANY($2::text[])
         AND storage.status='available' AND storage.deleted_at IS NULL
         AND storage.mime_type=ANY($3::text[])
       ORDER BY image.is_primary DESC,image.sort_order,image.created_at,image.id`,
      [row.id, [...this.photos.providerNames], [...PUBLIC_IMAGE_MIME_TYPES]],
    );
    const imageViews = images.rows.map((image) => this.imageView(image));
    const packSizes = await this.packSizes(row);
    // Asked last and read leniently: the maker's card is an extra, never a reason for the page to fail.
    const card = await Promise.resolve(this.database.query<{ article: string; brand: string; photos: string[]; specs: Array<{ label: string; value: string }>; title: string | null }>(
      `SELECT catalogue_article AS article,catalogue_brand AS brand,photos,specs,title FROM app.product_catalogue_cards
       WHERE product_id=$1 AND product_sku=$2`,
      [row.id, row.sku],
    )).catch(() => null);
    return {
      ...this.productSummary(row),
      catalogueCard: card?.rows?.[0] ?? null,
      attributes: row.public_attributes,
      description: row.description,
      // What the name says plainly of the part, and the vehicle maker's numbers it carries (docs/CATALOG_MATCHING.md).
      features: specLabels(partSpecs(row.name)).map(([label, value]) => ({ label, value })),
      images: imageViews,
      originalNumbers: originalNumbersIn(row.name, row.sku),
      packSizes,
      primaryImage: imageViews[0] ?? null,
    };
  }

  /**
   * The address of today of a product that had `slug` before a rename in 1С (migration 0051), when the product is
   * still for sale; the storefront answers the old address with a permanent redirect.
   */
  private async currentSlug(slug: string): Promise<string | null> {
    const result = await this.database.query<{ slug: string }>(
      `${VISIBLE_CATEGORIES_CTE}
       SELECT product.slug::text AS slug
       FROM app.product_slug_history AS history
       JOIN app.products AS product ON product.id=history.product_id
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       WHERE history.slug=$1 AND product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))`,
      [slug],
    );
    return result.rows[0]?.slug ?? null;
  }

  /**
   * One part of the site map (app/(store)/catalog/product/sitemap.ts on the storefront): the slugs of public products
   * in the order of their ids, and how many public products there are, so the storefront knows how many parts to list.
   * The same visibility as every public read: the hidden shelf and inactive sections never reach a search engine.
   */
  async sitemapProducts(rawQuery: unknown) {
    const parsed = CatalogSitemapQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_sitemap_query", issues: parsed.error.issues });
    }
    const result = await this.database.query<{ items: Array<{ slug: string; updated_at: string }>; total: string }>(
      `${VISIBLE_CATEGORIES_CTE}, listed AS (
         SELECT product.id,product.slug::text AS slug,product.updated_at
         FROM app.products AS product
         LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
         LEFT JOIN app.categories AS category ON category.id=product.category_id
         WHERE product.is_active AND product.deleted_at IS NULL
           AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
           AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
       )
       SELECT (SELECT count(*) FROM listed)::text AS total,
              COALESCE((SELECT json_agg(json_build_object('slug',page.slug,'updated_at',page.updated_at) ORDER BY page.id)
                        FROM (SELECT * FROM listed ORDER BY listed.id LIMIT $1 OFFSET $2) AS page),'[]'::json) AS items`,
      [CATALOG_SITEMAP_PART_SIZE, parsed.data.part * CATALOG_SITEMAP_PART_SIZE],
    );
    const row = result.rows[0];
    return {
      items: (row?.items ?? []).map((item) => ({ slug: item.slug, updatedAt: new Date(item.updated_at).toISOString() })),
      partSize: CATALOG_SITEMAP_PART_SIZE,
      total: safeInteger(row?.total ?? "0", "sitemap product count"),
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
         WHERE image.product_id=product.id AND storage.provider=ANY($1::text[])
           AND storage.status='available' AND storage.deleted_at IS NULL
           AND storage.mime_type=ANY($3::text[])
         ORDER BY image.is_primary DESC,image.sort_order,image.created_at,image.id LIMIT 1
       ) AS primary_image ON true
       WHERE product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         AND price.amount_kopeks IS NOT NULL AND stock.available_quantity>0
       ORDER BY product.updated_at DESC,product.id LIMIT $2`,
      [[...this.photos.providerNames], parsed.data.limit, [...PUBLIC_IMAGE_MIME_TYPES]],
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
       SELECT storage.provider,storage.storage_key,storage.mime_type,storage.byte_size::text,storage.sha256
       FROM app.product_images AS image
       JOIN app.products AS product ON product.id=image.product_id
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       JOIN app.storage_objects AS storage ON storage.id=image.storage_object_id
       WHERE image.id=$1 AND storage.provider=ANY($2::text[])
         AND product.is_active AND product.deleted_at IS NULL
         AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))
         AND storage.status='available' AND storage.deleted_at IS NULL
         AND storage.mime_type=ANY($3::text[])
       LIMIT 1`,
      [parsed.data, [...this.photos.providerNames], [...PUBLIC_IMAGE_MIME_TYPES]],
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
        const storage = this.photos.provider(media.provider);
        if (!storage) throw new Error("Unknown photo storage");
        content = await storage.read(media.storage_key);
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
      // Without the staff's notes typed into the name in 1С («(Ш)», «+++», the shelf box): product-name.ts.
      name: publicProductName(row.name, row.sku),
      priceKopeks: row.price_kopeks === null ? null : safeInteger(row.price_kopeks, "price"),
      primaryImage: image,
      catalogueImage: row.catalogue_image ?? null,
      sku: row.sku,
      slug: row.slug,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private productOrder(p: SqlParameters, input: CatalogSearchInput, article: string): { join: string; order: string } {
    switch (input.query.sort) {
      case "newest": return { join: "", order: "product.created_at DESC" };
      case "name": return { join: "", order: NAME_ORDER };
      case "price_asc": return { join: "", order: "price.amount_kopeks ASC NULLS LAST" };
      case "price_desc": return { join: "", order: "price.amount_kopeks DESC NULLS LAST" };
      // Ranking never lets a fuzzy match outrank an exact one: an exact
      // normalised-article match, then a confirmed cross-equivalent, then an
      // article prefix, and only then text relevance (catalog-search-sql.ts).
      case "popular": return {
        join: "LEFT JOIN app.product_popularity AS popularity ON popularity.product_id=product.id",
        // Among products nobody has chosen yet, what can be bought today stands first.
        order: `COALESCE(popularity.score,0) DESC,(stock.available_quantity>0) DESC,(price.amount_kopeks IS NOT NULL) DESC,${NAME_ORDER}`,
      };
      case "relevance": return input.folded !== null
        ? catalogSearchRelevanceOrder(p, input, article)
        // Browsing a section: what can be bought today first, then priced
        // items, then alphabetical — never "last touched by the import".
        : { join: "", order: `(stock.available_quantity>0) DESC,(price.amount_kopeks IS NOT NULL) DESC,${NAME_ORDER}` };
    }
  }


}
