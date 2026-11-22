"use client";

import { ChevronRight16Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useState } from "react";

import type { CatalogCategoryNode } from "../_lib/catalog-api";
import { categoryPath } from "../_lib/catalog-tree";
import { catalogPageHref, type CatalogPageQuery } from "./catalog-query";
import styles from "./catalog-filters.module.css";

interface CategoryTreeProps {
  /** Slug chain of the section being viewed; empty on the catalog root. */
  activePath: readonly string[];
  /** Called after a link is followed, so the mobile filter dialog can close. */
  onNavigate?: () => void;
  state: CatalogPageQuery;
  tree: CatalogCategoryNode[];
}

/**
 * The whole category tree in the filter rail. The branch of the section
 * being viewed is open, every other branch is folded behind its arrow, so
 * a deep 1С catalog stays one short list while the customer can still
 * jump sideways without climbing back to the root first.
 */
export function CategoryTree({ activePath, onNavigate, state, tree }: CategoryTreeProps) {
  if (tree.length === 0) return null;
  return (
    <ul className={styles.tree}>
      {tree.map((node) => (
        <CategoryTreeItem activePath={activePath} chain={[node.slug]} key={node.id} node={node} onNavigate={onNavigate} state={state} />
      ))}
    </ul>
  );
}

function CategoryTreeItem({ activePath, chain, node, onNavigate, state }: {
  activePath: readonly string[];
  chain: string[];
  node: CatalogCategoryNode;
  onNavigate?: () => void;
  state: CatalogPageQuery;
}) {
  const depth = chain.length;
  const onActiveBranch = chain.every((slug, index) => activePath[index] === slug);
  const isCurrent = onActiveBranch && activePath.length === depth;
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(onActiveBranch && hasChildren);
  const childListId = `category-tree-${node.id}`;

  return (
    <li>
      <div className={styles.treeRow} data-current={isCurrent || undefined}>
        {hasChildren ? (
          <button
            aria-controls={childListId}
            aria-expanded={open}
            aria-label={`${open ? "Свернуть" : "Показать"} подразделы: ${node.name}`}
            className={styles.treeToggle}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <ChevronRight16Regular aria-hidden="true" />
          </button>
        ) : <span aria-hidden="true" className={styles.treeSpacer} />}
        <Link
          aria-current={isCurrent ? "page" : undefined}
          className={styles.treeLink}
          href={catalogPageHref(categoryPath(chain), { ...state, page: 1 })}
          onClick={onNavigate}
        >
          <span className={styles.treeName}>{node.name}</span>
          <span className={styles.treeCount}>{node.productCount}</span>
        </Link>
      </div>
      {hasChildren && open ? (
        <ul className={styles.treeChildren} id={childListId}>
          {node.children.map((child) => (
            <CategoryTreeItem
              activePath={activePath}
              chain={[...chain, child.slug]}
              key={child.id}
              node={child}
              onNavigate={onNavigate}
              state={state}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
