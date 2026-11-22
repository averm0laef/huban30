import { STOREFRONT_TAXONOMY, type CatalogCategoryNode } from "@an30/contracts";

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

/**
 * A section of the shop's own taxonomy by its path, as a node with nothing in it. The public tree lists only the
 * sections that have products, so a section that has none yet — the target of a link from /podbor, of a
 * bookmark — would otherwise be a missing page. Only the taxonomy's own places count (a subsection under its own
 * section); the staff's shelves are not part of the taxonomy and stay closed.
 */
export function resolveTaxonomyPath(slugs: readonly string[]): CategoryLocation | null {
  const [sectionSlug, childSlug, ...deeper] = slugs;
  if (!sectionSlug || deeper.length > 0) return null;
  const section = STOREFRONT_TAXONOMY.find((entry) => entry.slug === sectionSlug);
  if (!section) return null;
  const empty = (slug: string, name: string): CatalogCategoryNode => ({
    children: [], description: null, id: `taxonomy:${slug}`, name, productCount: 0, slug, sortOrder: 0,
  });
  if (childSlug === undefined) return { ancestors: [], node: empty(section.slug, section.label) };
  const child = section.children.find((entry) => entry.slug === childSlug);
  return child ? { ancestors: [empty(section.slug, section.label)], node: empty(child.slug, child.label) } : null;
}

/** The `/catalog/...` URL for a category given its root-to-self slug chain. */
export function categoryPath(slugChain: readonly string[]): string {
  return `/catalog/${slugChain.map(encodeURIComponent).join("/")}`;
}

export interface CategoryParentLink {
  name: string;
  path: string;
}

/**
 * "Up" target for `CatalogFilterRail` on a category page: the immediate
 * parent category, or the catalog root once there is no parent left. Lets a
 * customer climb back out of a deep category without returning to the site
 * home page, which the breadcrumb above the page title also does — this is
 * the same move, surfaced inside the rail itself, next to the "down into
 * children" chips, so both directions live in one place.
 */
export function resolveParentLink(ancestors: readonly CatalogCategoryNode[]): CategoryParentLink {
  const parent = ancestors.at(-1);
  if (!parent) return { name: "Все категории", path: "/catalog" };
  return { name: parent.name, path: categoryPath(ancestors.map((entry) => entry.slug)) };
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
