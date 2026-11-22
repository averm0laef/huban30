"use client";

import { Clock20Regular, ShieldCheckmark20Regular } from "@fluentui/react-icons";
import Link from "next/link";

import { AddToCartButton } from "../_components/cart-actions";
import buttons from "../_components/store-button.module.css";
import { formatRubles } from "../_lib/catalog-format";
import type { ShopOffer } from "../_lib/parts-finder";
import { ExpertHelpQueryLink } from "../catalog/expert-help-query-link";
import styles from "./parts-finder.module.css";

const softButton = `${buttons.button} ${buttons.soft}`;

/** One product of ours for a part: name, price, stock and the action that fits its state. */
export function OfferRow({ offer }: { offer: ShopOffer }) {
  const inStock = offer.availableQuantity > 0;
  return (
    <div className={styles.offer}>
      <div className={styles.offerIdentity}>
        <Link href={`/catalog/product/${encodeURIComponent(offer.slug)}`}>{offer.name}</Link>
        <small>
          {offer.brand ? `${offer.brand} · ` : ""}{offer.sku}
          {offer.matchedVia === "cross" ? <span className={styles.analogBadge}>Аналог</span> : null}
          {offer.matchedVia === "possible" ? <span className={styles.analogBadge} data-possible title="Совпадает по номеру в каталогах аналогов. Перед покупкой сверьте применимость.">Возможный аналог</span> : null}
        </small>
      </div>
      <div className={styles.offerPrice}>
        <strong>{offer.priceKopeks === null ? "Цена уточняется" : formatRubles(offer.priceKopeks)}</strong>
        <small data-in-stock={inStock || undefined}>{inStock ? `В наличии ${offer.availableQuantity} шт.` : "Под заказ"}</small>
      </div>
      <div className={styles.offerAction}>
        {offer.matchedVia === "possible" ? (
          <ExpertHelpQueryLink className={softButton}
            prefillMessage={`Подойдёт ли как аналог: ${offer.brand ? `${offer.brand} ` : ""}${offer.sku}, ${offer.name}? Пришлю VIN для проверки.`}>
            <ShieldCheckmark20Regular aria-hidden="true" />
            Проверить применимость
          </ExpertHelpQueryLink>
        ) : inStock && offer.priceKopeks !== null
          ? <AddToCartButton productId={offer.productId} />
          : (
            <ExpertHelpQueryLink className={softButton}
              prefillMessage={`Нужна деталь: ${offer.brand ? `${offer.brand} ` : ""}${offer.sku}, ${offer.name}. Подскажите срок и цену.`}>
              <Clock20Regular aria-hidden="true" />
              Узнать срок
            </ExpertHelpQueryLink>
          )}
      </div>
    </div>
  );
}
