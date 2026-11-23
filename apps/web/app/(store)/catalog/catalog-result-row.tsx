import type { ReactNode } from "react";

import { CatalogPhoto } from "../_components/catalog-photo";
import type { CatalogView } from "./catalog-query";
import { stockIndicator } from "./stock-indicator";
import styles from "./catalog-results.module.css";

/**
 * The three-segment battery meter + word described in `stock-indicator.ts`.
 * The bars are `aria-hidden` and the whole thing carries one consolidated
 * `aria-label` (`role="img"`) instead of leaving a screen reader to narrate
 * three anonymous `<span>`s — the word is still painted on screen right
 * next to the bars (never removed visually), it is only hidden from the
 * accessibility tree once to avoid double-announcing it.
 */
function StockMeter({ quantity }: { quantity: number }) {
  const { label, segments, tone } = stockIndicator(quantity);
  // The exact count rides on the same line as the word ("мало · 5 шт."),
  // so a card no longer spends a separate "В магазине: N шт." row on it.
  const text = quantity > 0 ? `${label} · ${quantity} шт.` : label;
  return (
    <span aria-label={`Наличие: ${text}`} className={styles.stockMeter} data-tone={tone} role="img">
      {segments > 0 ? (
        <span aria-hidden="true" className={styles.stockMeterBars}>
          <span className={styles.stockMeterBar} data-filled={segments >= 1} />
          <span className={styles.stockMeterBar} data-filled={segments >= 2} />
          <span className={styles.stockMeterBar} data-filled={segments >= 3} />
        </span>
      ) : null}
      <span aria-hidden="true" className={styles.stockMeterLabel}>{text}</span>
    </span>
  );
}

/** One small pill in a row's badge area — "Под заказ", "Аналог", etc. */
export function RowBadge({ analog = false, children }: { analog?: boolean; children: ReactNode }) {
  return (
    <span className={analog ? `${styles.resultRowBadge} ${styles.resultRowBadgeAnalog}` : styles.resultRowBadge}>
      {children}
    </span>
  );
}

export interface CatalogResultRowProps {
  /** Button/control for this row — omitted together with `priceLabel` when `note` is set. */
  actionSlot?: ReactNode;
  /** Small pills ("Под заказ", "Аналог") shown above the brand/article line. */
  badges?: ReactNode;
  brand: string | null;
  /** "Срок: 5 дней" style note — own 1C rows never carry one. */
  deliveryNote?: string | null;
  imageAlt: string;
  imageUrl?: string | null;
  name: ReactNode;
  /**
   * Honest replacement for the stock meter/price/action columns when a row
   * has identity but genuinely nothing to sell right now (a cross with no
   * priced stock line) — never a fake price or a silently blank row.
   */
  note?: string;
  priceLabel?: string;
  quantity?: number;
  sku: string;
  underOrder?: boolean;
  view?: CatalogView;
}

/**
 * One row of the unified catalog list — the shop's own 1C stock and the
 * supplier's under-order offers render through this exact same component
 * (see `catalog-search-panel.tsx` and `supplier-results.tsx`), which is
 * what makes the two sources read as one continuous list instead of two
 * differently-shaped card blocks. Every row carries its own brand, article
 * and name — there is no shared heading with anonymous price rows beneath
 * it; an analogue is just a row like any other with an "Аналог" badge.
 */
export function CatalogResultRow({
  actionSlot, badges, brand, deliveryNote, imageAlt, imageUrl, name, note, priceLabel, quantity, sku, underOrder = false, view = "list",
}: CatalogResultRowProps) {
  return (
    <article className={styles.resultRow} data-catalog-view={view}>
      <div className={styles.resultRowItem}>
        <CatalogPhoto alt={imageAlt} className={styles.resultRowMedia}
          noteInside preview showNote={view === "grid"}
          sizes={view === "list" ? "64px" : "(max-width: 640px) 42vw, 270px"} src={imageUrl} />
        <div className={styles.resultRowIdentity}>
          {badges ? <div className={styles.resultRowBadges}>{badges}</div> : null}
          <p className={styles.resultRowMeta}>{brand ? `${brand} · ` : ""}Артикул: {sku}</p>
          <p className={styles.resultRowName}>{name}</p>
          {view === "list" && !imageUrl ? <small className={styles.resultRowPhotoNote}>Фото по запросу — в карточке товара</small> : null}
        </div>
      </div>
      {note ? (
        <p className={styles.resultRowNote}>{note}</p>
      ) : (
        <div className={styles.resultRowPurchase}>
          <div className={styles.resultRowStock}>
            {underOrder ? null : <StockMeter quantity={quantity ?? 0} />}
            {deliveryNote ? <p className={styles.resultRowDelivery}>{deliveryNote}</p> : null}
          </div>
          <div className={styles.resultRowPrice}>{priceLabel}</div>
          <div className={styles.resultRowAction}>{actionSlot}</div>
        </div>
      )}
    </article>
  );
}
