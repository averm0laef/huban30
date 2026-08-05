// Cycle-safe publication policy: a category is public only when its complete
// ancestor chain reaches a root and every node in that chain is active.
export const VISIBLE_CATEGORIES_CTE = `WITH RECURSIVE category_ancestry AS (
  SELECT category.id AS origin_id,category.id AS current_id,category.parent_id,
         category.is_active,category.deleted_at,ARRAY[category.id]::uuid[] AS path
  FROM app.categories AS category
  UNION ALL
  SELECT ancestry.origin_id,parent.id,parent.parent_id,parent.is_active,parent.deleted_at,
         ancestry.path || parent.id
  FROM category_ancestry AS ancestry
  JOIN app.categories AS parent ON parent.id=ancestry.parent_id
  WHERE NOT parent.id=ANY(ancestry.path)
), visible_categories AS (
  SELECT origin_id AS id
  FROM category_ancestry
  GROUP BY origin_id
  HAVING bool_and(is_active AND deleted_at IS NULL) AND bool_or(parent_id IS NULL)
)`;

/**
 * Same cycle-safe visibility policy as {@link VISIBLE_CATEGORIES_CTE}, plus a
 * `category_subtree` CTE that resolves to the given category (by slug) and
 * every one of its descendants — reusing the same `category_ancestry` rows,
 * since "origin X descends from category T" is exactly "T appears as
 * `current_id` in one of X's ancestry rows" (X's own row, where
 * `current_id=origin_id`, covers the self case).
 *
 * This is a function rather than a shared constant because the slug lookup
 * needs a bound query parameter placeholder (`$3` in catalog-public.service's
 * product search), and `VISIBLE_CATEGORIES_CTE` above is also reused by
 * queries that have no such parameter at all — appending `category_subtree`
 * to that shared constant would break those call sites.
 */
export function visibleCategoriesWithSubtreeCte(categorySlugParam: string): string {
  return `WITH RECURSIVE category_ancestry AS (
  SELECT category.id AS origin_id,category.id AS current_id,category.parent_id,
         category.is_active,category.deleted_at,ARRAY[category.id]::uuid[] AS path
  FROM app.categories AS category
  UNION ALL
  SELECT ancestry.origin_id,parent.id,parent.parent_id,parent.is_active,parent.deleted_at,
         ancestry.path || parent.id
  FROM category_ancestry AS ancestry
  JOIN app.categories AS parent ON parent.id=ancestry.parent_id
  WHERE NOT parent.id=ANY(ancestry.path)
), visible_categories AS (
  SELECT origin_id AS id
  FROM category_ancestry
  GROUP BY origin_id
  HAVING bool_and(is_active AND deleted_at IS NULL) AND bool_or(parent_id IS NULL)
), category_subtree AS (
  SELECT ancestry.origin_id AS id
  FROM category_ancestry AS ancestry
  JOIN app.categories AS subtree_root ON subtree_root.id=ancestry.current_id
  WHERE ${categorySlugParam}::text IS NOT NULL AND subtree_root.slug::text=${categorySlugParam}
)`;
}
