"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { SupplierSearchResponseSchema } from "@an30/contracts";
import type { SupplierPartView, SupplierSearchResponse, SupplierStockView } from "@an30/contracts";

import { STORE_PHONE, STORE_PHONE_DISPLAY } from "../../site-config";
import { formatRubles } from "../_lib/catalog-format";
import { apiRequest, errorText } from "../_lib/storefront-api";
import { filterSupplierParts } from "../_lib/supplier-results";
import styles from "../_components/storefront.module.css";
import { CatalogResultRow, RowBadge } from "./catalog-result-row";
import resultsStyles from "./catalog-results.module.css";
import { SupplierWaitlistDialog } from "./supplier-waitlist-dialog";
import type { SupplierWaitlistTarget } from "./supplier-waitlist-dialog";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { response: SupplierSearchResponse; status: "ready" };

function deliveryLabel(deliveryTime: string | null): string {
  return deliveryTime ? `Срок: ${deliveryTime}` : "Срок уточняется";
}

/**
 * Cheapest line that actually has quantity, falling back to the cheapest
 * line overall when nothing does. `null` when a part carries no stock lines
 * of its own (it may still have priced lines via `crosses`).
 */
function bestStock(stocks: SupplierStockView[]): SupplierStockView | null {
  if (stocks.length === 0) return null;
  return [...stocks].sort((a, b) => {
    const aOut = a.quantity > 0 ? 0 : 1;
    const bOut = b.quantity > 0 ? 0 : 1;
    return aOut !== bOut ? aOut - bOut : a.priceKopeks - b.priceKopeks;
  })[0] ?? null;
}

/** Russian plural for "N предложение / предложения / предложений". */
function offersWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "предложение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "предложения";
  return "предложений";
}

/**
 * One priced offer, flattened out of a `SupplierPartView` so it can carry
 * its own full identity — brand, article and name — instead of sitting
 * anonymously under a heading printed once for the whole part. `stock` is
 * `null` for a cross that has no priced line yet: it still gets its own
 * identity row, just with an honest "nothing to sell yet" note instead of a
 * fake price.
 */
interface FlatOffer {
  analog: boolean;
  brand: string;
  guid: string;
  key: string;
  name: string;
  partNumber: string;
  stock: SupplierStockView | null;
}

/**
 * Splits one supplier part into the single row shown up front (`primary`,
 * the cheapest available line) and every remaining offer — the part's own
 * other stock lines plus every analogue's stock lines — tucked behind the
 * "Ещё N предложений" disclosure. Nothing is ever dropped: a cross with no
 * stock lines still contributes one identity-only row.
 */
function partOffers(part: SupplierPartView): { hidden: FlatOffer[]; primary: FlatOffer | null } {
  const best = bestStock(part.stocks);
  const restStocks = best ? part.stocks.filter((stock) => stock.id !== best.id) : part.stocks;

  const primary: FlatOffer | null = best
    ? { analog: false, brand: part.brand, guid: part.guid, key: `${part.guid}:${best.id}`, name: part.name, partNumber: part.partNumber, stock: best }
    : null;

  const restOffers: FlatOffer[] = restStocks.map((stock) => ({
    analog: false, brand: part.brand, guid: part.guid, key: `${part.guid}:${stock.id}`, name: part.name, partNumber: part.partNumber, stock,
  }));

  const crossOffers: FlatOffer[] = part.crosses.flatMap((cross): FlatOffer[] => (
    cross.stocks.length > 0
      ? cross.stocks.map((stock): FlatOffer => ({
        analog: true, brand: cross.brand, guid: cross.guid, key: `${cross.guid}:${stock.id}`, name: cross.name, partNumber: cross.partNumber, stock,
      }))
      : [{ analog: true, brand: cross.brand, guid: cross.guid, key: `${cross.guid}:none`, name: cross.name, partNumber: cross.partNumber, stock: null }]
  ));

  return { hidden: [...restOffers, ...crossOffers], primary };
}

function OfferBadges({ offer }: { offer: FlatOffer }) {
  return (
    <>
      <RowBadge>Под заказ</RowBadge>
      {offer.analog ? <RowBadge analog>Аналог</RowBadge> : null}
    </>
  );
}

/** One flattened offer, rendered as a full-identity `CatalogResultRow`. */
function OfferRow({ offer, onWaitlist, query }: {
  offer: FlatOffer;
  onWaitlist: (target: SupplierWaitlistTarget) => void;
  query: string;
}) {
  if (!offer.stock) {
    return (
      <CatalogResultRow
        badges={<OfferBadges offer={offer} />}
        brand={offer.brand}
        imageAlt={`Нет фото товара «${offer.name}»`}
        imageUrl="/catalog/no-photo.webp"
        name={offer.name}
        note="Предложений пока нет."
        sku={offer.partNumber}
      />
    );
  }

  const { stock } = offer;
  return (
    <CatalogResultRow
      actionSlot={(
        <button
          className={resultsStyles.waitlistButton}
          onClick={() => onWaitlist({
            brand: offer.brand,
            deliveryTime: stock.deliveryTime,
            guid: offer.guid,
            name: offer.name,
            partNumber: offer.partNumber,
            priceKopeks: stock.priceKopeks,
            query,
            quantityAvailable: stock.quantity,
            stockId: stock.id,
          })}
          type="button"
        >
          В ожидание
        </button>
      )}
      badges={<OfferBadges offer={offer} />}
      brand={offer.brand}
      deliveryNote={deliveryLabel(stock.deliveryTime)}
      imageAlt={`Нет фото товара «${offer.name}»`}
      imageUrl="/catalog/no-photo.webp"
      name={offer.name}
      priceLabel={formatRubles(stock.priceKopeks)}
      quantity={stock.quantity}
      sku={offer.partNumber}
    />
  );
}

/**
 * Every row a single supplier part contributes to the list: the best offer
 * up front, then — only if there is more — a native `<details>` disclosure
 * holding every other stock line and every analogue, each its own full row.
 * Top-aligned and self-contained by design, same as the rest of the list.
 */
function PartRows({ onWaitlist, part, query }: {
  onWaitlist: (target: SupplierWaitlistTarget) => void;
  part: SupplierPartView;
  query: string;
}) {
  const { hidden, primary } = partOffers(part);

  return (
    <>
      {primary ? (
        <OfferRow offer={primary} onWaitlist={onWaitlist} query={query} />
      ) : (
        <CatalogResultRow
          badges={<RowBadge>Под заказ</RowBadge>}
          brand={part.brand}
          imageAlt={`Нет фото товара «${part.name}»`}
          imageUrl="/catalog/no-photo.webp"
          name={part.name}
          note={part.crosses.length > 0 ? "Прямого предложения нет — есть аналоги ниже." : "Предложений пока нет."}
          sku={part.partNumber}
        />
      )}

      {hidden.length > 0 ? (
        <details className={resultsStyles.moreDetails}>
          <summary className={resultsStyles.moreSummary}>Ещё {hidden.length} {offersWord(hidden.length)}</summary>
          <div className={resultsStyles.moreBody}>
            {hidden.map((offer) => <OfferRow key={offer.key} offer={offer} onWaitlist={onWaitlist} query={query} />)}
          </div>
        </details>
      ) : null}
    </>
  );
}

/**
 * The "Привезём под заказ" rows appended after the shop's own 1C rows —
 * deliberately a separate fetch from the server-rendered rows above it:
 * this component fetches `/api/v1/suppliers/search` itself, client-side,
 * after the page (with the shop's own 1C results) has already painted — a
 * cold under-order lookup takes 3-5s and must never hold up the page the
 * customer is already reading. `query` only ever reaches this component
 * once it is a real search (≥2 characters); see the `isSearch` gate in
 * catalog page.tsx and catalog/[...slug]/page.tsx.
 *
 * Visually it continues the same row list `CatalogSearchPanel` renders
 * above it — same `CatalogResultRow` anatomy, no card grid, no boxed
 * section — with only a light divider + caption marking where the shop's
 * own stock ends and the under-order offers begin. The two sources stay
 * distinct arrays throughout (`items` above vs. `parts` here, from
 * `filterSupplierParts`) and are never spliced into one combined array —
 * they are simply rendered one after the other.
 *
 * The supplier behind this lookup is never named to the customer — see
 * `filterSupplierParts` and the contract's `source` field for where that
 * identity actually lives (staff-only, never rendered here).
 */
export function SupplierResults({ ownEmpty, query }: { ownEmpty: boolean; query: string }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [waitlistTarget, setWaitlistTarget] = useState<SupplierWaitlistTarget | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    apiRequest<unknown>(`/suppliers/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((payload) => {
        const parsed = SupplierSearchResponseSchema.safeParse(payload);
        setState(parsed.success
          ? { response: parsed.data, status: "ready" }
          : { message: "Получен некорректный ответ.", status: "error" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ message: errorText(error), status: "error" });
      });
    return () => controller.abort();
  }, [query, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const ready = state.status === "ready" ? state.response : null;
  const parts = filterSupplierParts(ready);
  const supplierUnavailable = Boolean(ready && !ready.success);
  const supplierEmpty = Boolean(ready?.success && parts.length === 0);

  return (
    <section aria-labelledby="supplier-results-heading" className={resultsStyles.sourceDivider}>
      <h2 className={resultsStyles.sourceCaption} id="supplier-results-heading">Привезём под заказ</h2>
      <p className={styles.supplierIntro}>Этой детали может не быть на складе прямо сейчас, но мы можем привезти её под заказ.</p>

      {state.status === "loading" ? (
        <section aria-busy="true" aria-live="polite" className={styles.loadingState}>
          <h3>Проверяем, что можно привезти</h3>
          <p>Обычно это занимает несколько секунд.</p>
        </section>
      ) : null}

      {state.status === "error" ? (
        <section className={styles.errorState} role="alert">
          <h3>Не удалось проверить под заказ</h3>
          <p>{state.message}</p>
          <button className={styles.submitButton} onClick={retry} type="button">Повторить</button>
        </section>
      ) : null}

      {supplierUnavailable ? (
        <section className={styles.errorState} role="alert">
          <h3>Под заказ временно недоступен</h3>
          <p>{ready?.message || "Попробуйте повторить запрос позже."}</p>
          <button className={styles.submitButton} onClick={retry} type="button">Повторить</button>
        </section>
      ) : null}

      {supplierEmpty ? (
        <section className={styles.emptyState}>
          {ownEmpty ? (
            <>
              <h3>Ничего не найдено</h3>
              <p>
                Мы проверили склад и возможность привезти под заказ — по запросу «{query}» пока ничего нет ни там, ни там.
                Позвоните нам или опишите деталь специалисту: подберём аналог или узнаем срок под заказ.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href={`tel:${STORE_PHONE}`}>{STORE_PHONE_DISPLAY}</a>
                <Link className={styles.secondaryAction} href="/expert-help">Спросить специалиста</Link>
              </div>
            </>
          ) : (
            <>
              <h3>Под заказ ничего нет</h3>
              <p>По запросу «{query}» подходящих позиций под заказ не нашлось. Попробуйте изменить запрос.</p>
            </>
          )}
        </section>
      ) : null}

      {ready && parts.length > 0 ? (
        <>
          {ready.truncated ? (
            <p className={styles.supplierTruncatedNote}>Показаны первые {parts.length} из {ready.totalFound} найденных под заказ.</p>
          ) : null}
          <div className={resultsStyles.resultsList}>
            {parts.map((part) => <PartRows key={part.guid} onWaitlist={setWaitlistTarget} part={part} query={query} />)}
          </div>
        </>
      ) : null}

      <SupplierWaitlistDialog onClose={() => setWaitlistTarget(null)} target={waitlistTarget} />
    </section>
  );
}
