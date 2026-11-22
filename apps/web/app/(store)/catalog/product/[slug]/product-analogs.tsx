"use client";

import { ArrowSwap20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import buttons from "../../../_components/store-button.module.css";
import { formatRubles } from "../../../_lib/catalog-format";
import { finderRequest, type ShopAnalogsResult, type ShopOffer } from "../../../_lib/parts-finder";
import styles from "./product-analogs.module.css";

/**
 * Other products of the shop for the same part: a second card of the same
 * part (same number and maker, or the same kind of part in the same section
 * when 1С names no maker) and the shop's own confirmed crosses. Free — no FAPI call;
 * supplier offers and paid crosses stay on /podbor behind a button.
 */
export function ProductAnalogs({ article, brand, productId }: { article: string; brand: string | null; productId: string }) {
  const [offers, setOffers] = useState<ShopOffer[] | null>(null);

  useEffect(() => {
    let alive = true;
    // The card names its product: the API reads the product's own brand and section, and another
    // maker's product that only shares the number is not shown as an analog.
    finderRequest<ShopAnalogsResult>("shop-analogs", { article, productId, ...(brand ? { brand } : {}) })
      .then((result) => { if (alive) setOffers(result.offers.filter((offer) => offer.productId !== productId)); })
      .catch(() => { if (alive) setOffers([]); });
    return () => { alive = false; };
  }, [article, brand, productId]);

  const podbor = `/podbor?q=${encodeURIComponent(article)}`;
  return (
    <section className={styles.analogs} aria-labelledby="product-analogs-title">
      <div className={styles.head}>
        <h2 id="product-analogs-title">Аналоги и замены</h2>
        <Link className={`${buttons.button} ${buttons.quiet}`} href={podbor}><ArrowSwap20Regular aria-hidden="true" />Все аналоги и под заказ</Link>
      </div>
      {offers === null ? <p className={styles.muted} role="status">Ищем аналоги в магазине…</p> : null}
      {offers !== null && offers.length === 0 ? (
        <p className={styles.muted}>В магазине других вариантов этой детали нет. Аналоги других брендов и позиции под заказ — по ссылке выше.</p>
      ) : null}
      {offers && offers.length > 0 ? (
        <ul className={styles.list}>
          {offers.map((offer) => (
            <li key={offer.productId}>
              <Link className={styles.offer} href={`/catalog/product/${offer.slug}`}>
                <span className={styles.identity}>
                  <strong>{offer.name}</strong>
                  <small>{offer.brand ? `${offer.brand} · ` : ""}{offer.sku}{offer.matchedVia === "cross" ? " · аналог" : offer.matchedVia === "possible" ? " · возможный аналог" : ""}</small>
                </span>
                <span className={styles.price}>
                  <strong>{offer.priceKopeks === null ? "Цена по запросу" : formatRubles(offer.priceKopeks)}</strong>
                  <small className={offer.availableQuantity > 0 ? styles.inStock : undefined}>
                    {offer.availableQuantity > 0 ? `В наличии ${offer.availableQuantity} шт.` : "Под заказ"}
                  </small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
