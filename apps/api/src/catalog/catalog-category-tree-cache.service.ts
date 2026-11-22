import { Injectable } from "@nestjs/common";

import type { CategoryTreeNode } from "./catalog-category-tree.js";

// Categories only ever change in bulk, on a 1C batch apply/rollback — see
// CatalogApplyService, which calls invalidate() once the transaction that
// changed them commits. The TTL below is only a safety net in case an
// invalidation call is ever missed; it is not the primary cache-busting path.
const SAFETY_NET_TTL_MS = 5 * 60_000;
// The first page of a section without filters: the same for every visitor, but
// it carries stock and prices, which a checkout reservation also changes.
const FIRST_PAGE_TTL_MS = 30_000;
const FIRST_PAGES_KEPT = 200;

interface CacheEntry {
  expiresAt: number;
  value: CategoryTreeNode[];
}

@Injectable()
export class CatalogCategoryTreeCache {
  private entry: CacheEntry | null = null;
  private readonly firstPages = new Map<string, { expiresAt: number; value: unknown }>();

  read(): CategoryTreeNode[] | null {
    if (!this.entry || this.entry.expiresAt <= Date.now()) return null;
    return this.entry.value;
  }

  write(value: CategoryTreeNode[]): void {
    this.entry = { expiresAt: Date.now() + SAFETY_NET_TTL_MS, value };
  }

  /** A section's unfiltered first page (CatalogPublicService.products), dropped with the tree on every exchange. */
  readFirstPage(key: string): unknown {
    const kept = this.firstPages.get(key);
    if (!kept) return null;
    if (kept.expiresAt > Date.now()) return kept.value;
    this.firstPages.delete(key);
    return null;
  }

  writeFirstPage(key: string, value: unknown): void {
    this.firstPages.delete(key);
    if (this.firstPages.size >= FIRST_PAGES_KEPT) this.firstPages.delete(this.firstPages.keys().next().value!);
    this.firstPages.set(key, { expiresAt: Date.now() + FIRST_PAGE_TTL_MS, value });
  }

  invalidate(): void {
    this.entry = null;
    this.firstPages.clear();
  }
}
