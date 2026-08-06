/**
 * Stock-level indicator shared by every row of the unified catalog list —
 * the shop's own 1C stock and the supplier's under-order offers alike (see
 * `CatalogResultRow` / `catalog-search-panel.tsx` / `supplier-results.tsx`).
 * A raw quantity number ("200 шт.", "1 шт.") tells a customer nothing
 * actionable; this collapses it to a three-segment battery-style meter plus
 * a Russian word, on four fixed thresholds the owner specified:
 *
 *   quantity 0   -> no meter,        "под заказ"
 *   1-2          -> one segment,     "скоро закончится" (red)
 *   3-9          -> two segments,    "мало" (amber)
 *   10 and above -> three segments,  "в наличии" (green)
 *
 * `label` is not decorative — WCAG 2.2 (1.4.1) forbids colour as the only
 * carrier of meaning, so callers must always render it as visible text next
 * to the meter, never drop it in favour of `tone` alone.
 */
export type StockTone = "danger" | "order" | "success" | "warning";

export interface StockIndicator {
  /** Visible Russian word carrying the meaning — never colour alone. */
  label: string;
  /** Number of filled meter segments, 0-3. 0 means no meter is drawn at all. */
  segments: 0 | 1 | 2 | 3;
  tone: StockTone;
}

export function stockIndicator(quantity: number): StockIndicator {
  if (quantity <= 0) return { label: "под заказ", segments: 0, tone: "order" };
  if (quantity <= 2) return { label: "скоро закончится", segments: 1, tone: "danger" };
  if (quantity <= 9) return { label: "мало", segments: 2, tone: "warning" };
  return { label: "в наличии", segments: 3, tone: "success" };
}
