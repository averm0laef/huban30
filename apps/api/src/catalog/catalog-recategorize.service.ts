// Places products into the ONE storefront section tree (STOREFRONT_TAXONOMY
// in @an30/contracts). 1С groups never become public categories: each base's
// groups live in app.one_c_group_mappings (migration 0036) with an optional
// staff override, and decideStorefrontCategory (catalog-known-categories.ts)
// turns "staff mapping → group names → product name → «Без категории»" into
// a section. The CommerceML exchange uses the same placement per product,
// and recategorizeAll() re-applies it to everything already imported.
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { z } from "zod";

import { STOREFRONT_TAXONOMY } from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { AuditService } from "../security/audit.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";

import { DatabaseService } from "../infrastructure/database.service.js";
import { ONE_C_SOURCES, type OneCSource } from "../one-c-exchange/one-c-source.js";
import {
  decideStorefrontCategory,
  HIDDEN_CATEGORY_LABEL,
  HIDDEN_CATEGORY_SLUG,
  matchPlacementRule,
  storefrontParentSlug,
  STOREFRONT_CATEGORY_SLUGS,
  UNCATEGORIZED_CATEGORY_LABEL,
  UNCATEGORIZED_CATEGORY_SLUG,
  type CategoryDecisionSource,
  type PlacementRule,
} from "./catalog-known-categories.js";
import { partHeadNoun } from "./catalog-part-dictionary.js";
import { normalizeArticleNumber, normalizeBrand } from "./catalog-search-normalize.js";

const SECTION_LABELS: ReadonlyMap<string, string> = new Map([
  ...STOREFRONT_TAXONOMY.flatMap((section) => [
    [section.slug, section.label] as const,
    ...section.children.map((child) => [child.slug, `${section.label} → ${child.label}`] as const),
  ]),
  [UNCATEGORIZED_CATEGORY_SLUG, UNCATEGORIZED_CATEGORY_LABEL],
  // The hidden shelf: stored, never shown to customers (migration 0048).
  [HIDDEN_CATEGORY_SLUG, HIDDEN_CATEGORY_LABEL],
]);

const GroupMappingSchema = z.object({
  categorySlug: z.string().trim().min(1).max(120).nullable(),
  groupExternalId: z.string().trim().min(1).max(512),
  source: z.enum(["one_c", "one_c_secondary"]),
}).strict();

const word = z.string().trim().regex(/^[A-Za-zА-Яа-яЁё0-9]{2,40}$/u);
const PlacementRuleSchema = z.object({
  alsoWords: z.array(word).max(4).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  categorySlug: z.string().trim().min(1).max(120),
  note: z.string().trim().max(200).optional(),
  skuPrefix: z.string().trim().min(1).max(32).optional(),
  word: word.optional(),
}).strict();

const ProductCategorySchema = z.object({ categorySlug: z.string().trim().min(1).max(120).nullable() }).strict();

const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

type Executor = Pick<PoolClient, "query">;

interface GroupRow {
  manualSlug: string | null;
  name: string;
  parentExternalId: string | null;
}

export interface PlacementContext {
  /** Storefront slug → app.categories id (taxonomy rows only, never 1С-created ones). */
  categoryIds: ReadonlyMap<string, string>;
  /** Staff rules (app.catalog_placement_rules), most specific first. */
  rules: readonly PlacementRule[];
  /** source → 1С group external id → group. */
  groups: ReadonlyMap<OneCSource, ReadonlyMap<string, GroupRow>>;
}

export interface Placement {
  categoryId: string | null;
  /** The product named a 1С group this base never sent in a classifier. */
  danglingGroup: boolean;
  slug: string;
  source: CategoryDecisionSource;
}

const MAX_GROUP_DEPTH = 64;

export async function loadPlacementContext(executor: Executor, sources: readonly OneCSource[] = ONE_C_SOURCES): Promise<PlacementContext> {
  const categories = await executor.query<{ id: string; slug: string }>(
    `SELECT id, slug::text AS slug FROM app.categories
     WHERE slug::text = ANY($1::text[]) AND external_id IS NULL AND deleted_at IS NULL`,
    [STOREFRONT_CATEGORY_SLUGS],
  );
  const groupRows = await executor.query<{
    group_external_id: string; group_name: string; manual_slug: string | null;
    parent_group_external_id: string | null; source_key: OneCSource;
  }>(
    `SELECT mapping.source_key, mapping.group_external_id, mapping.group_name,
            mapping.parent_group_external_id, category.slug::text AS manual_slug
     FROM app.one_c_group_mappings AS mapping
     LEFT JOIN app.categories AS category ON category.id = mapping.category_id AND category.deleted_at IS NULL
     WHERE mapping.source_key = ANY($1::text[])`,
    [sources],
  );
  const groups = new Map<OneCSource, Map<string, GroupRow>>();
  for (const row of groupRows.rows) {
    const bySource = groups.get(row.source_key) ?? new Map<string, GroupRow>();
    bySource.set(row.group_external_id, {
      manualSlug: row.manual_slug, name: row.group_name, parentExternalId: row.parent_group_external_id,
    });
    groups.set(row.source_key, bySource);
  }
  const ruleRows = await executor.query<{ brand_key: string | null; head_stem: string | null; name_stems: string[]; sku_prefix: string | null; slug: string }>(
    `SELECT rule.head_stem, rule.name_stems, rule.brand_key, rule.sku_prefix, category.slug::text AS slug
     FROM app.catalog_placement_rules AS rule
     JOIN app.categories AS category ON category.id = rule.category_id AND category.deleted_at IS NULL
     WHERE rule.is_active
     -- The rule with more conditions is the more specific one; among equals the newer wins.
     ORDER BY (rule.head_stem IS NOT NULL)::int + (rule.brand_key IS NOT NULL)::int + (rule.sku_prefix IS NOT NULL)::int
              + cardinality(rule.name_stems) DESC, rule.created_at DESC`,
  );
  const rules = ruleRows.rows.map((row): PlacementRule => ({
    brandKey: row.brand_key, headStem: row.head_stem, nameStems: row.name_stems, skuPrefix: row.sku_prefix, slug: row.slug,
  }));
  return { categoryIds: new Map(categories.rows.map((row) => [row.slug, row.id])), groups, rules };
}

/** The group's own name first, then its parents' up to the root (cycle-safe). */
export function groupChain(groups: ReadonlyMap<string, GroupRow> | undefined, groupExternalId: string | null): { manualSlug: string | null; names: string[] } {
  const names: string[] = [];
  let manualSlug: string | null = null;
  const seen = new Set<string>();
  let current = groupExternalId;
  while (current && groups && !seen.has(current) && seen.size < MAX_GROUP_DEPTH) {
    seen.add(current);
    const group = groups.get(current);
    if (!group) break;
    names.push(group.name);
    // The nearest mapped group wins: a mapping on "Масла" covers its subgroups.
    manualSlug ??= group.manualSlug;
    current = group.parentExternalId;
  }
  return { manualSlug, names };
}

export function placeProduct(
  context: PlacementContext,
  input: { brandName?: string | null; groupExternalId: string | null; productName: string; sku?: string | null; source: OneCSource },
): Placement {
  const groups = context.groups.get(input.source);
  const chain = groupChain(groups, input.groupExternalId);
  const decision = decideStorefrontCategory({
    groupNames: chain.names, manualSlug: chain.manualSlug, productName: input.productName, sku: input.sku,
    ruleSlug: matchPlacementRule(context.rules, {
      brandKey: input.brandName ? normalizeBrand(input.brandName) : "",
      name: input.productName,
      skuNormalized: input.sku ? normalizeArticleNumber(input.sku) : "",
    }),
  });
  const categoryId = context.categoryIds.get(decision.slug) ?? context.categoryIds.get(UNCATEGORIZED_CATEGORY_SLUG) ?? null;
  return {
    categoryId,
    danglingGroup: input.groupExternalId !== null && !groups?.has(input.groupExternalId),
    slug: categoryId === null ? UNCATEGORIZED_CATEGORY_SLUG : decision.slug,
    source: decision.source,
  };
}

export interface RecategorizeReport {
  /** Empty categories created from 1С groups that were switched off. */
  deactivatedGroupCategories: number;
  moved: number;
  /** Section label → product count after the run (active products only). */
  perSection: Array<{ count: number; label: string; slug: string }>;
  total: number;
}

@Injectable()
export class CatalogRecategorizeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit?: AuditService,
    private readonly categoryTreeCache?: CatalogCategoryTreeCache,
  ) {}

  /** Storefront sections a 1С group can be pointed at, in tree order. */
  sections(): Array<{ label: string; slug: string }> {
    return [...SECTION_LABELS].map(([slug, label]) => ({ label, slug }));
  }

  /**
   * Every 1С group of both bases with its product count and where it goes:
   * "manual" when staff chose a section, "auto" when the group names decide,
   * "by_product_name" when neither does and each product's own name decides.
   */
  async listGroups(): Promise<Record<string, unknown>> {
    const context = await loadPlacementContext({ query: this.database.query.bind(this.database) } as Pick<PoolClient, "query">);
    const rows = (await this.database.query<{
      group_external_id: string; group_name: string; is_active: boolean; manual_slug: string | null;
      product_count: string; source_key: OneCSource; uncategorized_count: string;
    }>(
      `SELECT mapping.source_key, mapping.group_external_id, mapping.group_name, mapping.is_active,
              category.slug::text AS manual_slug,
              count(product.id) FILTER (WHERE product.is_active)::text AS product_count,
              count(product.id) FILTER (WHERE product.is_active AND current_category.slug = $1)::text AS uncategorized_count
       FROM app.one_c_group_mappings AS mapping
       LEFT JOIN app.categories AS category ON category.id = mapping.category_id
       LEFT JOIN app.products AS product ON product.one_c_source = mapping.source_key
         AND product.one_c_group_external_id = mapping.group_external_id AND product.deleted_at IS NULL
       LEFT JOIN app.categories AS current_category ON current_category.id = product.category_id
       GROUP BY mapping.source_key, mapping.group_external_id, mapping.group_name, mapping.is_active, category.slug
       ORDER BY mapping.source_key, count(product.id) FILTER (WHERE product.is_active) DESC, mapping.group_name`,
      [UNCATEGORIZED_CATEGORY_SLUG],
    )).rows;
    return {
      items: rows.map((row) => {
        const chain = groupChain(context.groups.get(row.source_key), row.group_external_id);
        const decision = decideStorefrontCategory({ groupNames: chain.names, manualSlug: chain.manualSlug, productName: "" });
        const mode = row.manual_slug ? "manual" : decision.source === "none" ? "by_product_name" : decision.source === "manual" ? "inherited" : "auto";
        return {
          groupExternalId: row.group_external_id,
          id: `${row.source_key}:${row.group_external_id}`,
          isActive: row.is_active,
          mode,
          name: row.group_name,
          path: [...chain.names].reverse().join(" / "),
          productCount: Number(row.product_count),
          section: mode === "by_product_name" ? null : { label: SECTION_LABELS.get(decision.slug) ?? decision.slug, slug: decision.slug },
          source: row.source_key,
          uncategorizedCount: Number(row.uncategorized_count),
        };
      }),
      sections: this.sections(),
    };
  }

  /** Points a 1С group at a storefront section (or back to automatic with null), then re-sorts the catalogue. */
  async setGroupMapping(rawInput: unknown, actor: AuthContext, ipAddress?: string): Promise<RecategorizeReport> {
    const parsed = GroupMappingSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException("Некорректная привязка группы 1С");
    const input = parsed.data;
    if (input.categorySlug !== null && !SECTION_LABELS.has(input.categorySlug)) {
      throw new BadRequestException("Такого раздела сайта нет");
    }
    await this.database.transaction(async (client) => {
      const categoryId = input.categorySlug === null ? null : (await client.query<{ id: string }>(
        "SELECT id FROM app.categories WHERE slug::text = $1 AND external_id IS NULL AND deleted_at IS NULL",
        [input.categorySlug],
      )).rows[0]?.id;
      if (categoryId === undefined) throw new BadRequestException("Раздел сайта ещё не создан: примените миграции");
      const updated = await client.query(
        `UPDATE app.one_c_group_mappings SET category_id = $3, updated_by = $4
         WHERE source_key = $1 AND group_external_id = $2`,
        [input.source, input.groupExternalId, categoryId, actor.userId],
      );
      if (!updated.rowCount) throw new NotFoundException("Группа 1С не найдена");
      await this.audit?.record({
        action: "catalog.one_c_group_mapped",
        actorRole: actor.role,
        actorUserId: actor.userId,
        afterState: { categorySlug: input.categorySlug },
        entityId: `${input.source}:${input.groupExternalId}`.slice(0, 200),
        entityType: "one_c_group_mapping",
        ipAddress,
      }, client);
    });
    return this.recategorizeAll();
  }

  /** Active products waiting in «Без категории», newest first, with their 1С group for context. */
  async listUncategorized(rawQuery: unknown): Promise<Record<string, unknown>> {
    const parsed = PageQuerySchema.safeParse(rawQuery ?? {});
    if (!parsed.success) throw new BadRequestException("Некорректные параметры списка");
    const { limit, offset } = parsed.data;
    const where = `FROM app.products AS product
       JOIN app.categories AS category ON category.id = product.category_id AND category.slug = $1
       LEFT JOIN app.one_c_group_mappings AS mapping ON mapping.source_key = product.one_c_source
         AND mapping.group_external_id = product.one_c_group_external_id
       WHERE product.is_active AND product.deleted_at IS NULL AND NOT product.is_demo`;
    const rows = (await this.database.query<{
      group_name: string | null; id: string; name: string; one_c_source: OneCSource; sku: string;
    }>(
      `SELECT product.id, product.sku::text AS sku, product.name, product.one_c_source, mapping.group_name
       ${where} ORDER BY product.updated_at DESC, product.id LIMIT $2 OFFSET $3`,
      [UNCATEGORIZED_CATEGORY_SLUG, limit, offset],
    )).rows;
    const total = Number((await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count ${where}`, [UNCATEGORIZED_CATEGORY_SLUG],
    )).rows[0]?.count ?? 0);
    return {
      items: rows.map((row) => ({ groupName: row.group_name, id: row.id, name: row.name, sku: row.sku, source: row.one_c_source })),
      limit,
      offset,
      total,
    };
  }

  /** What the queue «Без категории» mostly consists of: the leading nouns, most frequent first. */
  async uncategorizedSummary(): Promise<{ groups: Array<{ count: number; examples: string[]; head: string }>; total: number; unnamed: number }> {
    const rows = (await this.database.query<{ name: string }>(
      `SELECT product.name FROM app.products AS product
       JOIN app.categories AS category ON category.id = product.category_id AND category.slug = $1
       WHERE product.is_active AND product.deleted_at IS NULL AND NOT product.is_demo
       ORDER BY product.id LIMIT 60000`,
      [UNCATEGORIZED_CATEGORY_SLUG],
    )).rows;
    const groups = new Map<string, { count: number; examples: string[] }>();
    let unnamed = 0;
    for (const row of rows) {
      const head = partHeadNoun(row.name);
      if (!head) { unnamed += 1; continue; }
      // «гайка», «гайки», «гаек» are one word for this list.
      const key = head.length > 5 ? head.slice(0, head.length - 2) : head.slice(0, 4);
      const group = groups.get(key) ?? { count: 0, examples: [] };
      group.count += 1;
      if (group.examples.length < 3) group.examples.push(row.name.slice(0, 90));
      groups.set(key, group);
    }
    return {
      groups: [...groups.entries()].map(([head, group]) => ({ head, ...group })).sort((a, b) => b.count - a.count).slice(0, 40),
      total: rows.length,
      unnamed,
    };
  }

  async listRules() {
    const rows = (await this.database.query<{
      brand_key: string | null; created_at: Date; head_stem: string | null; id: string; name_stems: string[]; note: string | null; sku_prefix: string | null; slug: string;
    }>(
      `SELECT rule.id, rule.head_stem, rule.name_stems, rule.brand_key, rule.sku_prefix, rule.note, rule.created_at, category.slug::text AS slug
       FROM app.catalog_placement_rules AS rule JOIN app.categories AS category ON category.id = rule.category_id
       WHERE rule.is_active ORDER BY rule.created_at DESC LIMIT 500`,
    )).rows;
    return {
      rules: rows.map((row) => ({
        brandKey: row.brand_key, categoryLabel: SECTION_LABELS.get(row.slug) ?? row.slug, categorySlug: row.slug, createdAt: row.created_at.toISOString(),
        headStem: row.head_stem, id: row.id, nameStems: row.name_stems, note: row.note, skuPrefix: row.sku_prefix,
      })),
    };
  }

  /** «Название начинается со слова …» (+ бренд, + начало артикула) → раздел; then every product is re-sorted. */
  async addRule(rawInput: unknown, actor: AuthContext, ipAddress?: string): Promise<RecategorizeReport> {
    const parsed = PlacementRuleSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException("Проверьте правило: нужно слово, бренд или начало артикула и раздел");
    const input = parsed.data;
    const rule = {
      brandKey: input.brand ? normalizeBrand(input.brand) : null,
      headStem: input.word ? input.word.toLowerCase().replace(/ё/gu, "е") : null,
      nameStems: (input.alsoWords ?? []).map((word) => word.toLowerCase().replace(/ё/gu, "е")),
      skuPrefix: input.skuPrefix ? normalizeArticleNumber(input.skuPrefix) : null,
    };
    if (!rule.headStem && !rule.brandKey && !rule.skuPrefix && rule.nameStems.length === 0) {
      throw new BadRequestException("Укажите слово из названия, бренд или начало артикула");
    }
    await this.database.transaction(async (client) => {
      const category = (await client.query<{ id: string }>(
        "SELECT id FROM app.categories WHERE slug = $1 AND external_id IS NULL AND deleted_at IS NULL", [input.categorySlug],
      )).rows[0];
      if (!category || !STOREFRONT_CATEGORY_SLUGS.includes(input.categorySlug)) throw new BadRequestException("Такого раздела нет");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.catalog_placement_rules (head_stem, name_stems, brand_key, sku_prefix, category_id, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [rule.headStem, rule.nameStems, rule.brandKey, rule.skuPrefix, category.id, input.note ?? null, actor.userId],
      );
      await this.audit?.record({
        action: "catalog.placement_rule.created", actorRole: actor.role, actorUserId: actor.userId,
        afterState: { ...rule, categorySlug: input.categorySlug }, entityId: inserted.rows[0]!.id, entityType: "catalog_placement_rule",
        ...(ipAddress ? { ipAddress } : {}),
      }, client);
    });
    return this.recategorizeAll();
  }

  async removeRule(ruleId: string, actor: AuthContext, ipAddress?: string): Promise<RecategorizeReport> {
    if (!z.uuid().safeParse(ruleId).success) throw new NotFoundException("Правило не найдено");
    await this.database.transaction(async (client) => {
      const removed = await client.query("UPDATE app.catalog_placement_rules SET is_active = false WHERE id = $1 AND is_active", [ruleId]);
      if (removed.rowCount === 0) throw new NotFoundException("Правило не найдено");
      await this.audit?.record({
        action: "catalog.placement_rule.removed", actorRole: actor.role, actorUserId: actor.userId, entityId: ruleId, entityType: "catalog_placement_rule",
        ...(ipAddress ? { ipAddress } : {}),
      }, client);
    });
    return this.recategorizeAll();
  }

  /** A section chosen by hand for one product: it stays there through imports and re-sorting. `null` returns it to the rules. */
  async setProductCategory(productId: string, rawInput: unknown, actor: AuthContext, ipAddress?: string): Promise<{ categorySlug: string | null; pinned: boolean }> {
    const parsed = ProductCategorySchema.safeParse(rawInput);
    if (!parsed.success || !z.uuid().safeParse(productId).success) throw new BadRequestException("Выберите раздел");
    const slug = parsed.data.categorySlug;
    return this.database.transaction(async (client) => {
      const product = (await client.query<{ category_id: string | null }>(
        "SELECT category_id FROM app.products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [productId],
      )).rows[0];
      if (!product) throw new NotFoundException("Товар не найден");
      if (slug === null) {
        await client.query("UPDATE app.products SET category_pinned = false, updated_at = clock_timestamp() WHERE id = $1", [productId]);
      } else {
        const category = (await client.query<{ id: string }>(
          "SELECT id FROM app.categories WHERE slug = $1 AND external_id IS NULL AND deleted_at IS NULL", [slug],
        )).rows[0];
        if (!category || !STOREFRONT_CATEGORY_SLUGS.includes(slug)) throw new BadRequestException("Такого раздела нет");
        await client.query(
          "UPDATE app.products SET category_id = $2, category_pinned = true, updated_at = clock_timestamp() WHERE id = $1", [productId, category.id],
        );
      }
      await this.audit?.record({
        action: "catalog.product.category_set", actorRole: actor.role, actorUserId: actor.userId,
        afterState: { categorySlug: slug, pinned: slug !== null }, entityId: productId, entityType: "product",
        ...(ipAddress ? { ipAddress } : {}),
      }, client);
      this.categoryTreeCache?.invalidate();
      return { categorySlug: slug, pinned: slug !== null };
    });
  }

  /**
   * Re-applies placement to every non-demo product in one transaction.
   * Products imported from 1С (external_id set) follow the full rules. A
   * product someone created by hand keeps its section unless its own name
   * clearly points to a subsection of that same section. Categories that
   * earlier exchanges created from 1С groups and that end up empty are
   * deactivated, never deleted.
   */
  async recategorizeAll(): Promise<RecategorizeReport> {
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('an30-catalog-recategorize'))");
      const context = await loadPlacementContext(client);
      const slugById = new Map([...context.categoryIds].map(([slug, id]) => [id, slug]));
      const products = (await client.query<{
        brand_name: string | null; category_id: string | null; external_id: string | null; id: string; name: string;
        one_c_group_external_id: string | null; one_c_source: OneCSource; sku: string;
      }>(
        // A section chosen by hand for one product (category_pinned) is never re-sorted.
        `SELECT product.id, product.name, product.sku::text AS sku, product.external_id, product.category_id,
                product.one_c_source, product.one_c_group_external_id,
                (SELECT brand.name FROM app.brands AS brand WHERE brand.id = product.brand_id) AS brand_name
         FROM app.products AS product WHERE NOT product.is_demo AND product.deleted_at IS NULL AND NOT product.category_pinned
         ORDER BY product.id FOR UPDATE OF product`,
      )).rows;
      let moved = 0;
      for (const product of products) {
        const placement = placeProduct(context, {
          brandName: product.brand_name, groupExternalId: product.one_c_group_external_id, productName: product.name,
          sku: product.sku, source: product.one_c_source,
        });
        let target = placement.categoryId;
        const currentSlug = product.category_id ? slugById.get(product.category_id) : undefined;
        if (product.external_id === null && currentSlug && currentSlug !== UNCATEGORIZED_CATEGORY_SLUG) {
          // Hand-made product already in a storefront section: only refine it
          // within that section, never move it to another one.
          const sameSection = storefrontParentSlug(placement.slug) === storefrontParentSlug(currentSlug);
          const deeper = placement.slug !== storefrontParentSlug(placement.slug);
          target = sameSection && deeper ? placement.categoryId : product.category_id;
        } else if (product.external_id === null && placement.source === "none" && product.category_id && !currentSlug) {
          // Hand-made product in some other category we know nothing about: leave it.
          target = product.category_id;
        }
        if (target === product.category_id) continue;
        await client.query(
          "UPDATE app.products SET category_id = $2, updated_at = clock_timestamp() WHERE id = $1",
          [product.id, target],
        );
        moved += 1;
      }

      const deactivated = await client.query(
        `WITH RECURSIVE used AS (
           SELECT category.id, category.parent_id FROM app.categories AS category
           WHERE EXISTS (SELECT 1 FROM app.products AS product
                         WHERE product.category_id = category.id AND product.deleted_at IS NULL)
           UNION
           SELECT parent.id, parent.parent_id FROM app.categories AS parent JOIN used ON used.parent_id = parent.id
         )
         UPDATE app.categories SET is_active = false, updated_at = clock_timestamp()
         WHERE external_id IS NOT NULL AND is_active AND deleted_at IS NULL
           AND id NOT IN (SELECT id FROM used)`,
      );

      const perSection = (await client.query<{ count: string; label: string; slug: string }>(
        `SELECT category.slug::text AS slug, category.name AS label, count(product.id)::text AS count
         FROM app.categories AS category
         JOIN app.products AS product ON product.category_id = category.id
           AND product.is_active AND product.deleted_at IS NULL AND NOT product.is_demo
         GROUP BY category.slug, category.name, category.sort_order
         ORDER BY category.slug`,
      )).rows.map((row) => ({ count: Number(row.count), label: row.label, slug: row.slug }));

      this.categoryTreeCache?.invalidate();
      return {
        deactivatedGroupCategories: deactivated.rowCount ?? 0,
        moved,
        perSection,
        total: products.length,
      };
    });
  }
}
