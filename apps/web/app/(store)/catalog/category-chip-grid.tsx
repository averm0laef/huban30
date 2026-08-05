import Link from "next/link";

import styles from "../_components/storefront.module.css";
import type { CatalogCategoryNode } from "../_lib/catalog-api";

/**
 * The child-category chips shown at every catalog level — top-level
 * categories under `/catalog`, or a category's own children under
 * `/catalog/[...slug]`. Renders nothing when there are none, so an empty
 * catalog (no 1C import yet) never shows a fabricated section.
 */
export function CategoryChipGrid({ basePath, nodes }: { basePath: string; nodes: CatalogCategoryNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <section className={styles.categoryChipSection} aria-label="Разделы каталога">
      <div className={styles.categoryChipGrid}>
        {nodes.map((node) => (
          <Link key={node.id} className={styles.categoryChip} href={`${basePath}/${encodeURIComponent(node.slug)}`}>
            <span>{node.name}</span>
            <span className={styles.categoryChipCount}>{node.productCount}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
