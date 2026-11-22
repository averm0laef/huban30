import type { ShopOffer } from "../_lib/parts-finder";

export interface NumberMaker {
  /** As the first offer writes it; null — products whose maker 1С does not name. */
  brand: string | null;
  /** The name of one of its products, so that «OSRAM — лампа, LIQUI MOLY — масло» reads at a glance. */
  example: string;
  fromKopeks: number | null;
  inStock: boolean;
  offers: ShopOffer[];
}

/**
 * The makers whose products carry the number a customer typed (docs/CATALOG_MATCHING.md, «Поиск по номеру»): one
 * number belongs to several makers' different parts («3930» is a lamp of OSRAM and an oil of LIQUI MOLY). Empty when
 * the number is one maker's: nothing to ask. In stock first.
 */
export function numberMakers(shop: readonly ShopOffer[]): NumberMaker[] {
  const groups = new Map<string, ShopOffer[]>();
  for (const offer of shop) {
    if ((offer.matchedVia ?? "exact") !== "exact") continue;
    const key = offer.brand?.trim().toUpperCase() ?? "";
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  if (groups.size < 2) return [];
  return [...groups.values()]
    .map((offers): NumberMaker => {
      const sorted = [...offers].sort((a, b) => Number(b.availableQuantity > 0) - Number(a.availableQuantity > 0));
      const prices = offers.flatMap((item) => (item.priceKopeks === null ? [] : [item.priceKopeks]));
      return {
        brand: sorted[0]!.brand,
        example: sorted[0]!.name,
        fromKopeks: prices.length > 0 ? Math.min(...prices) : null,
        inStock: offers.some((item) => item.availableQuantity > 0),
        offers: sorted,
      };
    })
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || Number(a.brand === null) - Number(b.brand === null) || (a.brand ?? "").localeCompare(b.brand ?? "", "ru"));
}
