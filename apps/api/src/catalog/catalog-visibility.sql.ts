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
