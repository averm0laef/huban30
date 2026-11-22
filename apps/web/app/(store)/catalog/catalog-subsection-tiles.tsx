import { existsSync } from "node:fs";
import path from "node:path";

import Image from "next/image";
import Link from "next/link";

import { storefrontSectionImage } from "@an30/contracts";

import type { CatalogCategoryNode } from "../_lib/catalog-api";
import { catalogProductCount } from "./catalog-query";
import styles from "./catalog-layout.module.css";

const publicDir = path.join(process.cwd(), "public");
const imageCache = new Map<string, boolean>();

function hasImage(file: string): boolean {
  // Only "found" is remembered, so a picture added later shows up without a restart.
  if (imageCache.get(file)) return true;
  const found = existsSync(path.join(publicDir, "categories", `${file}.webp`));
  if (found) imageCache.set(file, true);
  return found;
}

function tileImage(slug: string, parentSlug: string): string {
  const own = storefrontSectionImage(slug);
  if (own && hasImage(own)) return `/categories/${own}.webp`;
  const parent = storefrontSectionImage(parentSlug);
  return parent && hasImage(parent) ? `/categories/${parent}.webp` : "/catalog/no-photo.webp";
}

/**
 * A section's subsections as picture tiles, the way large parts retailers lay
 * out «Масла и жидкости» → моторное, трансмиссионное, антифриз… A tile with
 * no products yet still opens its page (which offers the supplier search and
 * a specialist), so the structure stays visible while the catalog fills up.
 */
export function CatalogSubsectionTiles({ basePath, nodes, parentSlug, query }: {
  basePath: string;
  nodes: CatalogCategoryNode[];
  parentSlug: string;
  /** Current filters as a query string ("?availability=in_stock"), kept on the links. */
  query?: string;
}) {
  if (nodes.length === 0) return null;
  return (
    <nav aria-label="Подразделы" className={styles.subsectionTiles}>
      {nodes.map((node) => {
        const image = tileImage(node.slug, parentSlug);
        return (
          <Link className={styles.subsectionTile} href={`${basePath}/${encodeURIComponent(node.slug)}${query ?? ""}`} key={node.id}>
            <span className={styles.subsectionImage}>
              <Image alt="" height={120} sizes="(max-width: 670px) 96px, 120px" src={image} width={120} />
            </span>
            <span className={styles.subsectionName}>{node.name}</span>
            <span className={styles.subsectionCount}>
              {node.productCount > 0 ? catalogProductCount(node.productCount) : "Пока нет товаров"}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
