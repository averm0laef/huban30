import type { SupplierCrossPair } from "@an30/contracts";

import type { SupplierPart } from "../adapters/provider-contracts.js";

// A defensive cap, mirroring the ones in rossko-soap.ts (MAX_TOP_LEVEL_PARTS,
// MAX_CROSSES_PER_PART, MAX_PART_DEPTH): a pathological or hostile response
// could otherwise turn a single search into an unbounded write burst against
// the crosses queue. In practice a real response tops out far below this.
const MAX_PAIRS = 500;

/**
 * Flattens every parent-child edge in a Rossko search result's cross tree
 * into (partA, partB) pairs — the raw, not-yet-normalised material
 * apps/worker/src/article-cross-ingest.ts turns into app.article_crosses
 * rows. Walks the *full* tree the provider parsed (up to rossko-soap.ts's
 * own MAX_PART_DEPTH), not the response view SupplierSearchService trims to
 * 8 crosses and one nesting level for the customer — the shop should learn
 * every cross the supplier stated, even the ones never shown to this
 * particular customer.
 *
 * Only states a pair directly asserted by the tree structure itself: a
 * top-level part and one of its `crosses` entries, or that cross and one of
 * *its* own crosses. It never assumes a grandchild is transitively a cross
 * of the top-level part — that inference is not something Rossko actually
 * claimed, so a pair skipping a level is never invented here.
 *
 * A part with a blank partNumber (`?? ""` in rossko-soap.ts's parser)
 * carries no article to link at all and is skipped rather than turned into
 * a degenerate pair.
 */
export function extractCrossPairs(parts: readonly SupplierPart[]): SupplierCrossPair[] {
  const pairs: SupplierCrossPair[] = [];

  function visit(part: SupplierPart): void {
    for (const cross of part.crosses) {
      if (pairs.length >= MAX_PAIRS) return;
      if (part.partNumber.length > 0 && cross.partNumber.length > 0) {
        pairs.push({
          partA: { article: part.partNumber, brand: part.brand },
          partB: { article: cross.partNumber, brand: cross.brand },
        });
      }
      visit(cross);
    }
  }

  for (const part of parts) {
    if (pairs.length >= MAX_PAIRS) break;
    visit(part);
  }

  return pairs;
}
