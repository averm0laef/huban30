import type { CatalogCategoryNode } from "@an30/contracts";

export interface CategoryBreadcrumbEntry {
  name: string;
  path: string;
}

export interface CategoryLocation {
  ancestors: CatalogCategoryNode[];
  node: CatalogCategoryNode;
}

/**
 * Walks a slug path (e.g. `["zapchasti","kuzov","shchetki"]`) down from the
 * tree roots returned by `GET /catalog/categories/tree`. Returns `null` when
 * any segment fails to match, so the caller (`catalog/[...slug]/page.tsx`)
 * can render a real 404 instead of guessing at a fallback.
 */
export function resolveCategoryPath(
  tree: readonly CatalogCategoryNode[],
  slugs: readonly string[],
): CategoryLocation | null {
  if (slugs.length === 0) return null;
  const ancestors: CatalogCategoryNode[] = [];
  let level = tree;
  let node: CatalogCategoryNode | null = null;
  for (const [index, slug] of slugs.entries()) {
    const match = level.find((candidate) => candidate.slug === slug);
    if (!match) return null;
    if (index < slugs.length - 1) ancestors.push(match);
    node = match;
    level = match.children;
  }
  return node ? { ancestors, node } : null;
}

/** The `/catalog/...` URL for a category given its root-to-self slug chain. */
export function categoryPath(slugChain: readonly string[]): string {
  return `/catalog/${slugChain.map(encodeURIComponent).join("/")}`;
}

/**
 * Breadcrumb trail for a category level: Главная / Каталог / ...ancestors /
 * the category itself — each segment a link, matching the owner's reference
 * ("Каталог / запчасти / кузов / щетки").
 */
export function buildCategoryBreadcrumb(
  ancestors: readonly CatalogCategoryNode[],
  node: CatalogCategoryNode,
): CategoryBreadcrumbEntry[] {
  const trail: CategoryBreadcrumbEntry[] = [
    { name: "Главная", path: "/" },
    { name: "Каталог", path: "/catalog" },
  ];
  const chain = [...ancestors, node];
  const slugs: string[] = [];
  for (const category of chain) {
    slugs.push(category.slug);
    trail.push({ name: category.name, path: categoryPath(slugs) });
  }
  return trail;
}

/**
 * Depth-first search for a category anywhere in the tree by slug, returning
 * its root-to-self slug chain. Used to degrade a home-page tile link to a
 * real category URL once a matching category exists, and to fall back to
 * the legacy search link when it does not (see `home-sections.tsx`).
 */
export function findCategorySlugPath(
  tree: readonly CatalogCategoryNode[],
  slug: string,
): string[] | null {
  for (const node of tree) {
    if (node.slug === slug) return [node.slug];
    const nested = findCategorySlugPath(node.children, slug);
    if (nested) return [node.slug, ...nested];
  }
  return null;
}
