import type { ShopAnalogsResult, ShopOffer } from "../../../_lib/parts-finder";

/**
 * The analogs of a product card in the order a customer can trust them (docs/CATALOG_MATCHING.md, part D): another
 * card of the same part, analogs a source the shop trusts confirmed, parts of the same standard size, and possible
 * analogs, which a customer checks by VIN first.
 */
export interface AnalogGroups {
  checked: ShopOffer[];
  possible: ShopOffer[];
  same: ShopOffer[];
  sameSize: ShopOffer[];
  sizeLabel: string | null;
}

/** In stock first, then priced, then the cheaper one. */
function ranked(offers: readonly ShopOffer[]): ShopOffer[] {
  return [...offers].sort((a, b) => Number(b.availableQuantity > 0) - Number(a.availableQuantity > 0)
    || Number(a.priceKopeks === null) - Number(b.priceKopeks === null)
    || (a.priceKopeks ?? 0) - (b.priceKopeks ?? 0));
}

export function analogGroups(result: ShopAnalogsResult, productId: string): AnalogGroups {
  const others = result.offers.filter((offer) => offer.productId !== productId);
  const kind = (offer: ShopOffer) => offer.matchedVia ?? "exact";
  return {
    checked: ranked(others.filter((offer) => kind(offer) === "cross")),
    possible: ranked(others.filter((offer) => kind(offer) === "possible")),
    same: ranked(others.filter((offer) => kind(offer) === "exact")),
    sameSize: ranked((result.sameSize?.offers ?? []).filter((offer) => offer.productId !== productId)),
    sizeLabel: result.sameSize?.label ?? null,
  };
}

/** What to buy instead of a product out of stock: the same part, a checked analog, the same size; never a possible one. */
export function inStockAlternative(groups: AnalogGroups): ShopOffer | null {
  return [...groups.same, ...groups.checked, ...groups.sameSize].find((offer) => offer.availableQuantity > 0) ?? null;
}

const BASIS: Record<NonNullable<ShopOffer["basis"]>, string> = {
  catalogue: "по данным каталога запчастей",
  maker: "по каталогу производителя",
  original_number: "через общий оригинальный номер",
  same_number: "тот же номер",
  same_size: "тот же типоразмер",
  shop: "подтверждено магазином",
  supplier: "по данным поставщика",
  two_sources: "подтверждено двумя источниками",
};

/** Why the offer is there, in a few words under its line. */
export function basisText(offer: ShopOffer, sizeLabel: string | null): string {
  if (offer.basis === "same_size" && sizeLabel) return `${BASIS.same_size}: ${sizeLabel}`;
  if (offer.basis) return BASIS[offer.basis];
  return offer.matchedVia === "possible" ? "возможный аналог" : offer.matchedVia === "cross" ? "аналог" : BASIS.same_number;
}
