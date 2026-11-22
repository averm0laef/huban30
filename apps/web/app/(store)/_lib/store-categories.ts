import { storefrontSectionImage, type CatalogCategoryNode } from "@an30/contracts";

import { catalogSearchHref } from "./catalog-search-url";
import { categoryPath } from "./catalog-tree";

interface CategoryTile {
  key: string;
  label: string;
  query: string;
}

export const categoryTiles: CategoryTile[] = [
  { key: "motornye-masla", label: "Моторные масла", query: "моторное масло" },
  { key: "filtry", label: "Фильтры", query: "фильтр" },
  { key: "tormoznaya-sistema", label: "Тормозная система", query: "тормоз" },
  { key: "akkumulyatory", label: "Аккумуляторы", query: "аккумулятор" },
  { key: "transmissionnye-masla", label: "Трансмиссионные масла", query: "трансмиссионное масло" },
  { key: "antifriz", label: "Антифриз", query: "антифриз" },
  { key: "avtolampy", label: "Автолампы", query: "лампа" },
  { key: "shchetki", label: "Щётки стеклоочистителя", query: "щетки" },
  { key: "gidravlicheskaya-zhidkost", label: "Гидравлическая жидкость", query: "гидравлическая жидкость" },
  { key: "avtohimiya", label: "Автохимия", query: "автохимия" },
  { key: "instrumenty", label: "Инструменты", query: "инструмент" },
  { key: "tehosmotr", label: "Товары для техосмотра", query: "техосмотр" },
];

export const featuredCategoryKeys = new Set([
  "motornye-masla", "filtry", "tormoznaya-sistema", "akkumulyatory",
  "avtolampy", "shchetki", "avtohimiya", "instrumenty",
]);

/** The staff's queue of goods that have no section yet (app.categories, migration 0024). */
const UNSORTED_SECTION_SLUG = "bez-kategorii";

/**
 * The name a customer sees for a section. The queue is «Без категории» for the staff, who empty it; a customer
 * reads the same shelf as «Другие товары».
 */
export function publicSectionName(section: { name: string; slug: string }): string {
  return section.slug === UNSORTED_SECTION_SLUG ? "Другие товары" : section.name;
}

export interface CatalogSectionTile {
  href: string;
  /** Null when the section has no picture: the tile shows the neutral placeholder. */
  image: string | null;
  key: string;
  label: string;
}

/**
 * The tiles of /catalog: every section the catalogue holds, in the catalogue's own order, the goods without a
 * section last. When the catalogue did not answer, the main sections as searches, so the page is never bare.
 */
export function catalogSectionTiles(tree: readonly CatalogCategoryNode[]): CatalogSectionTile[] {
  if (tree.length === 0) {
    return categoryTiles.filter(({ key }) => featuredCategoryKeys.has(key))
      .map(({ key, label, query }) => ({ href: catalogSearchHref(query), image: `/categories/${key}.webp`, key, label }));
  }
  const tiles = tree.map((node): CatalogSectionTile => {
    const image = storefrontSectionImage(node.slug);
    return { href: categoryPath([node.slug]), image: image ? `/categories/${image}.webp` : null, key: node.slug, label: publicSectionName(node) };
  });
  return [...tiles.filter(({ key }) => key !== UNSORTED_SECTION_SLUG), ...tiles.filter(({ key }) => key === UNSORTED_SECTION_SLUG)];
}

export interface CatalogMenuSection extends CatalogSectionTile {
  children: Array<{ href: string; key: string; label: string }>;
}

/**
 * The catalogue menu of the header and of the phone drawer: every section the catalogue holds with its
 * subsections, the goods without a section last. Empty when the catalogue did not answer — the menu then stays a
 * plain link to /catalog. Only what the menu shows is kept: the list travels to the browser with every page.
 */
export function catalogMenuSections(tree: readonly CatalogCategoryNode[]): CatalogMenuSection[] {
  if (tree.length === 0) return [];
  const children = new Map(tree.map((node) => [node.slug, node.children.map((child) => ({
    href: categoryPath([node.slug, child.slug]), key: child.slug, label: publicSectionName(child),
  }))]));
  return catalogSectionTiles(tree).map((tile) => ({ ...tile, children: children.get(tile.key) ?? [] }));
}

/**
 * The sections the phone drawer lists: the catalogue's own menu, or — when the catalogue did not answer — the
 * main sections as searches. A page /catalog/<section> exists only for a section the catalogue holds.
 */
export function catalogDrawerSections(menu: CatalogMenuSection[]): CatalogMenuSection[] {
  return menu.length > 0 ? menu : catalogSectionTiles([]).map((tile) => ({ ...tile, children: [] }));
}

/**
 * A link to a section named in the page itself (the footer): the section's page when the catalogue holds it, a
 * search by the section's word when it does not, the whole catalogue for a section there is no word for.
 */
export function sectionLink(menu: readonly CatalogMenuSection[], key: string): string {
  const section = menu.find((item) => item.key === key);
  if (section) return section.href;
  const tile = categoryTiles.find((item) => item.key === key);
  return tile ? catalogSearchHref(tile.query) : "/catalog";
}

export function catalogCategoryPhoto(category: { slug: string; name?: string | null } | null | undefined, ancestors: readonly string[] = []): string | null {
  if (!category && ancestors.length === 0) return null;
  // Sections and subsections of the storefront tree carry their own picture.
  const fromTaxonomy = category ? storefrontSectionImage(category.slug) : null;
  if (fromTaxonomy) return `/categories/${fromTaxonomy}.webp`;
  const name = category?.name?.toLowerCase().replace(/ё/gu, "е").trim();
  const ownTile = categoryTiles.find(tile => tile.key === category?.slug || tile.label.toLowerCase().replace(/ё/gu, "е") === name);
  const parent = [...ancestors].reverse().find(slug => categoryTiles.some(tile => tile.key === slug));
  const key = ownTile?.key ?? parent;
  return key ? `/categories/${key}.webp` : null;
}
