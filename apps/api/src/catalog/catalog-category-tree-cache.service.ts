import { Injectable } from "@nestjs/common";

import type { CategoryTreeNode } from "./catalog-category-tree.js";

// Categories only ever change in bulk, on a 1C batch apply/rollback — see
// CatalogApplyService, which calls invalidate() once the transaction that
// changed them commits. The TTL below is only a safety net in case an
// invalidation call is ever missed; it is not the primary cache-busting path.
const SAFETY_NET_TTL_MS = 5 * 60_000;

interface CacheEntry {
  expiresAt: number;
  value: CategoryTreeNode[];
}

@Injectable()
export class CatalogCategoryTreeCache {
  private entry: CacheEntry | null = null;

  read(): CategoryTreeNode[] | null {
    if (!this.entry || this.entry.expiresAt <= Date.now()) return null;
    return this.entry.value;
  }

  write(value: CategoryTreeNode[]): void {
    this.entry = { expiresAt: Date.now() + SAFETY_NET_TTL_MS, value };
  }

  invalidate(): void {
    this.entry = null;
  }
}
