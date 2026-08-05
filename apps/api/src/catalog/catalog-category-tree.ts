/**
 * Pure assembly of the public category tree from a flat row set.
 *
 * Kept free of any database or NestJS dependency so the visibility and
 * roll-up rules can be unit tested directly (see
 * `catalog-category-tree.test.ts`) without a database. The visibility rule
 * mirrors `VISIBLE_CATEGORIES_CTE` in `catalog-visibility.sql.ts`: a category
 * is public only when it and every one of its ancestors, up to a root, are
 * active — soft-deleted categories must never be passed in (the caller
 * queries `WHERE deleted_at IS NULL`), and a category whose parent is
 * missing from the row set (deleted) or inactive hides the entire subtree
 * beneath it, cycles included.
 */

export interface CategoryTreeRow {
  description: string | null;
  id: string;
  isActive: boolean;
  name: string;
  parentId: string | null;
  productCount: number;
  slug: string;
  sortOrder: number;
}

export interface CategoryTreeNode {
  children: CategoryTreeNode[];
  description: string | null;
  id: string;
  name: string;
  /** Own direct product count plus the roll-up of every descendant. */
  productCount: number;
  slug: string;
  sortOrder: number;
}

function isVisible(
  id: string,
  byId: Map<string, CategoryTreeRow>,
  memo: Map<string, boolean>,
  visiting: Set<string>,
): boolean {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const row = byId.get(id);
  if (!row || !row.isActive) {
    memo.set(id, false);
    return false;
  }
  if (row.parentId === null) {
    memo.set(id, true);
    return true;
  }
  if (visiting.has(id)) {
    // Cycle: this chain never reaches a root, so treat it as invisible —
    // matches VISIBLE_CATEGORIES_CTE's `bool_or(parent_id IS NULL)` clause.
    memo.set(id, false);
    return false;
  }
  visiting.add(id);
  const parentVisible = isVisible(row.parentId, byId, memo, visiting);
  visiting.delete(id);
  memo.set(id, parentVisible);
  return parentVisible;
}

function sortSiblings(rows: CategoryTreeRow[]): CategoryTreeRow[] {
  return [...rows].sort((left, right) => (
    left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name, "ru")
    || left.id.localeCompare(right.id)
  ));
}

/** Builds the nested, visibility-filtered category tree with roll-up counts. */
export function buildCategoryTree(rows: CategoryTreeRow[]): CategoryTreeNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();

  const childrenByParent = new Map<string, CategoryTreeRow[]>();
  for (const row of rows) {
    if (!isVisible(row.id, byId, memo, visiting)) continue;
    const key = row.parentId ?? "";
    const siblings = childrenByParent.get(key);
    if (siblings) siblings.push(row);
    else childrenByParent.set(key, [row]);
  }

  function assemble(row: CategoryTreeRow): CategoryTreeNode {
    const children = sortSiblings(childrenByParent.get(row.id) ?? []).map(assemble);
    const productCount = row.productCount
      + children.reduce((sum, child) => sum + child.productCount, 0);
    return {
      children,
      description: row.description,
      id: row.id,
      name: row.name,
      productCount,
      slug: row.slug,
      sortOrder: row.sortOrder,
    };
  }

  return sortSiblings(childrenByParent.get("") ?? []).map(assemble);
}

/** A resolved category level: the matched node plus its ordered ancestors. */
export interface CategoryTreeLocation {
  ancestors: CategoryTreeNode[];
  node: CategoryTreeNode;
}

/**
 * Walks a slug path (for example `["zapchasti","kuzov","shchetki"]`) down
 * from the tree roots, returning the matched node and its ancestor chain, or
 * `null` when any segment fails to match — the caller renders a 404 in that
 * case rather than guessing.
 */
export function resolveCategoryPath(
  tree: CategoryTreeNode[],
  slugs: readonly string[],
): CategoryTreeLocation | null {
  if (slugs.length === 0) return null;
  const ancestors: CategoryTreeNode[] = [];
  let level = tree;
  let node: CategoryTreeNode | null = null;
  for (const [index, slug] of slugs.entries()) {
    const match = level.find((candidate) => candidate.slug === slug);
    if (!match) return null;
    if (index < slugs.length - 1) ancestors.push(match);
    node = match;
    level = match.children;
  }
  return node ? { ancestors, node } : null;
}
