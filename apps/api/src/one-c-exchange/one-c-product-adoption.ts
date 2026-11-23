// A catalogue loaded before the exchange (the owner's list export) knows every product by its 1С code, while the
// exchange names the same product by the identifier 1С gives it. Without this step the first full exchange would
// find none of its products on the site, add them all again and hide the loaded ones — with their sections chosen by
// staff, photos, page addresses, views and wishlists. Here the products of a file are paired with the ones already on
// the site, so the exchange carries on in the same rows.

import type { OneCCatalogRow } from "@an30/contracts";

import { sourceExternalId, type OneCSource } from "./one-c-source.js";

type ProductRow = Extract<OneCCatalogRow, { entityType: "product" }>;

export interface ProductAdoptionPlan {
  /** A file product and the identifier a product loaded under its 1С code has on the site. */
  byCode: { codeExternalId: string; externalId: string }[];
  /** File products that carry no code: they can only be recognised by their article and name. */
  byName: { externalId: string; name: string; sku: string }[];
}

/**
 * Picks the file products that can be told apart without doubt: a code (or, without a code, an article with a name)
 * that one product of the file has and no other. A code that is itself the identifier of a file product is left
 * alone: that product is already on the site under it.
 */
export function planProductAdoption(rows: readonly OneCCatalogRow[], source: OneCSource): ProductAdoptionPlan {
  const products = rows.filter((row): row is ProductRow => row.entityType === "product");
  const identifiers = new Set(products.map((row) => row.externalId));
  const identifierUses = new Map<string, number>();
  for (const row of products) identifierUses.set(row.externalId, (identifierUses.get(row.externalId) ?? 0) + 1);
  const codeUses = new Map<string, number>();
  const nameUses = new Map<string, number>();
  const nameKey = (row: ProductRow) => `${row.sku}\u0000${row.name}`;
  for (const row of products) {
    if (row.oneCCode) codeUses.set(row.oneCCode, (codeUses.get(row.oneCCode) ?? 0) + 1);
    nameUses.set(nameKey(row), (nameUses.get(nameKey(row)) ?? 0) + 1);
  }
  const plan: ProductAdoptionPlan = { byCode: [], byName: [] };
  for (const row of products) {
    // An identifier the file gives to two products cannot be handed to two rows of the site.
    if (identifierUses.get(row.externalId) !== 1) continue;
    if (row.oneCCode) {
      const codeExternalId = sourceExternalId(source, row.oneCCode);
      if (codeExternalId !== row.externalId && codeUses.get(row.oneCCode) === 1 && !identifiers.has(codeExternalId)) {
        plan.byCode.push({ codeExternalId, externalId: row.externalId });
      }
    } else if (nameUses.get(nameKey(row)) === 1) {
      plan.byName.push({ externalId: row.externalId, name: row.name, sku: row.sku });
    }
  }
  return plan;
}

const SLUG_SUFFIX = /-[0-9a-f]{10}$/u;

/**
 * The address a product keeps after the exchange. The tail of a slug only tells two products of one name apart, so a
 * product whose name did not change keeps the address it already has, whichever identifier that tail was made from.
 */
export function keptProductSlug(currentSlug: string, incomingSlug: string): string {
  return SLUG_SUFFIX.test(currentSlug) && SLUG_SUFFIX.test(incomingSlug)
    && currentSlug.replace(SLUG_SUFFIX, "") === incomingSlug.replace(SLUG_SUFFIX, "")
    ? currentSlug
    : incomingSlug;
}
