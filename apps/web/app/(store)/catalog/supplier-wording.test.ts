import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The owner does not want the under-order source named to customers (see
 * `SupplierResults`, `SupplierWaitlistDialog`, and the static catalog page
 * copy). This scans the actual shipped source of every customer-facing
 * catalog file for the supplier's name or the Russian word "поставщик"
 * used the way a shopper would read it. Only comments are stripped: a source
 * field in a browser request is visible in the network panel and must also
 * remain server-side.
 *
 * English identifiers like `SupplierResults` or `.supplierPartCard` are
 * untouched by design (the task says not to rename the adapter or its
 * module) — this only targets the Cyrillic word a shopper would actually
 * read, and the supplier's brand name in either script.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const CUSTOMER_FACING_FILES = [
  path.join("(index)", "page.tsx"),
  "catalog-search-panel.tsx",
  "catalog-filter-rail.tsx",
  "supplier-results.tsx",
  "supplier-waitlist-dialog.tsx",
  path.join("[...slug]", "page.tsx"),
];

function customerVisibleSource(relativePath: string): string {
  const raw = readFileSync(path.join(here, relativePath), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("catalog under-order copy never names the supplier", () => {
  it.each(CUSTOMER_FACING_FILES)("%s has no customer-facing supplier mention", (relativePath) => {
    const text = customerVisibleSource(relativePath);
    expect(text).not.toMatch(/rossko/i);
    expect(text).not.toMatch(/росско/i);
    expect(text).not.toMatch(/поставщик/i);
  });
});
