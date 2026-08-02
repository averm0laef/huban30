/**
 * Money formatting shared by server and client components.
 *
 * Kept apart from `catalog-api`, which reaches for `node:net` and `next/headers`
 * and therefore cannot be imported from a client component.
 */
export function formatRubles(kopeks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    currency: "RUB",
    maximumFractionDigits: kopeks % 100 === 0 ? 0 : 2,
    minimumFractionDigits: kopeks % 100 === 0 ? 0 : 2,
    style: "currency",
  }).format(kopeks / 100);
}
