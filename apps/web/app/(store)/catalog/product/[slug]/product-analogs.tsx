"use client";

import { ArrowSwap20Regular } from "@fluentui/react-icons";
import Link from "next/link";

import buttons from "../../../_components/store-button.module.css";
import { formatRubles } from "../../../_lib/catalog-format";
import type { ShopOffer } from "../../../_lib/parts-finder";
import { analogGroups, basisText, inStockAlternative } from "./analog-groups";
import styles from "./product-analogs.module.css";
import { useShopAnalogs } from "./shop-analogs-request";

function OfferLine({ offer, sizeLabel }: { offer: ShopOffer; sizeLabel: string | null }) {
  return (
    <li>
      <Link className={styles.offer} href={`/catalog/product/${offer.slug}`}>
        <span className={styles.identity}>
          <strong>{offer.name}</strong>
          <small>{offer.brand ? `${offer.brand} · ` : ""}{offer.sku}</small>
          <small className={styles.basis}>{basisText(offer, sizeLabel)}</small>
        </span>
        <span className={styles.price}>
          <strong>{offer.priceKopeks === null ? "Цена по запросу" : formatRubles(offer.priceKopeks)}</strong>
          <small className={offer.availableQuantity > 0 ? styles.inStock : undefined}>
            {offer.availableQuantity > 0 ? `В наличии ${offer.availableQuantity} шт.` : "Под заказ"}
          </small>
        </span>
      </Link>
    </li>
  );
}

function Group({ offers, sizeLabel = null, title }: { offers: ShopOffer[]; sizeLabel?: string | null; title: string }) {
  if (offers.length === 0) return null;
  return (
    <div className={styles.group}>
      <h3>{title}</h3>
      <ul className={styles.list}>{offers.map((offer) => <OfferLine key={offer.productId} offer={offer} sizeLabel={sizeLabel} />)}</ul>
    </div>
  );
}

/**
 * Other products of the shop for the same part, in the order a customer can trust them (analog-groups.ts): another
 * card of the same part, analogs a trusted source confirmed, the same standard size from any maker, and — folded —
 * possible analogs to check by VIN. Each line says why it is there. Free — no paid catalogue is asked; supplier
 * offers and paid crosses stay on /podbor behind a button.
 */
export function ProductAnalogs({ article, brand, productId }: { article: string; brand: string | null; productId: string }) {
  const state = useShopAnalogs(article, brand, productId);
  const groups = state.status === "ready" ? analogGroups(state.result, productId) : null;
  const empty = groups !== null && [groups.same, groups.checked, groups.sameSize, groups.possible].every((list) => list.length === 0);

  const podbor = `/podbor?q=${encodeURIComponent(article)}`;
  return (
    <section className={styles.analogs} aria-labelledby="product-analogs-title">
      <div className={styles.head}>
        <h2 id="product-analogs-title">Аналоги и замены</h2>
        <Link className={`${buttons.button} ${buttons.quiet}`} href={podbor}><ArrowSwap20Regular aria-hidden="true" />Все аналоги и под заказ</Link>
      </div>
      {state.status === "loading" ? <p className={styles.muted} role="status">Ищем аналоги в магазине…</p> : null}
      {state.status === "error" || empty ? (
        <p className={styles.muted}>В магазине других вариантов этой детали нет. Аналоги других брендов и позиции под заказ — по ссылке выше.</p>
      ) : null}
      {groups ? (
        <>
          <Group offers={groups.same} title="Эта же деталь" />
          <Group offers={groups.checked} title="Проверенные аналоги" />
          <Group offers={groups.sameSize} sizeLabel={groups.sizeLabel} title={groups.sizeLabel ? `Тот же типоразмер: ${groups.sizeLabel}` : "Тот же типоразмер"} />
          {groups.possible.length > 0 ? (
            <details className={styles.possible}>
              <summary>Возможные аналоги ({groups.possible.length}) — уточните применимость по VIN</summary>
              <ul className={styles.list}>{groups.possible.map((offer) => <OfferLine key={offer.productId} offer={offer} sizeLabel={null} />)}</ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Under the price of a product out of stock: the best part to buy today instead, when the shop has one. */
export function ProductInStockAlternative({ article, brand, productId }: { article: string; brand: string | null; productId: string }) {
  const state = useShopAnalogs(article, brand, productId);
  const best = state.status === "ready" ? inStockAlternative(analogGroups(state.result, productId)) : null;
  if (!best) return null;
  return (
    <Link className={styles.alternative} href={`/catalog/product/${best.slug}`}>
      <span>Есть замена в наличии</span>
      <strong>{best.brand ? `${best.brand} ` : ""}{best.name}</strong>
      <small>{best.priceKopeks === null ? "Цена по запросу" : formatRubles(best.priceKopeks)} · {basisText(best, state.status === "ready" ? state.result.sameSize?.label ?? null : null)}</small>
    </Link>
  );
}
