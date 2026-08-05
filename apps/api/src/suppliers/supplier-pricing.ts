/**
 * Retail pricing for parts brought in from a distributor.
 *
 * The shop buys at the distributor's price and sells at its own, so every
 * supplier figure passes through here before a customer sees it or before it
 * is recorded on a waiting-list request. Two rules matter:
 *
 *  - the markup is applied on the server only. The browser receives the retail
 *    price and never the purchase price, and cannot influence either;
 *  - search and the waiting list share this function, so the amount a customer
 *    agreed to is the amount the request is written with.
 */

/** Kopeks in one rouble; retail amounts are rounded to a whole rouble. */
const KOPEKS_IN_ROUBLE = 100;

export function applySupplierMarkup(purchaseKopeks: number, markupPercent: number): number {
  if (!Number.isSafeInteger(purchaseKopeks) || purchaseKopeks <= 0) {
    throw new Error("Supplier price must be a positive integer amount in kopeks");
  }
  if (!Number.isFinite(markupPercent) || markupPercent < 0) {
    throw new Error("Supplier markup must be a non-negative percentage");
  }

  const marked = purchaseKopeks * (1 + markupPercent / 100);
  // Round up to a whole rouble: a retail price ending in kopeks reads as a
  // machine artefact, and rounding down would sell below the intended margin.
  const roubles = Math.ceil(marked / KOPEKS_IN_ROUBLE);
  const retail = roubles * KOPEKS_IN_ROUBLE;

  if (!Number.isSafeInteger(retail)) {
    throw new Error("Retail price overflowed the safe integer range");
  }
  return retail;
}
