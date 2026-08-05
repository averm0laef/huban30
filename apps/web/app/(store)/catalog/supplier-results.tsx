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

function StockRow({
  brand, name, onWaitlist, partGuid, partNumber, query, stock,
}: {
  brand: string;
  name: string;
  onWaitlist: (target: SupplierWaitlistTarget) => void;
  partGuid: string;
  partNumber: string;
  query: string;
  stock: SupplierStockView;
}) {
  return (
    <div className={styles.supplierStockRow}>
      <span className={styles.supplierStockPrice}>{formatRubles(stock.priceKopeks)}</span>
      <span className={styles.supplierStockQuantity}>{stock.quantity} шт.</span>
      <span className={styles.supplierStockDelivery}>{deliveryLabel(stock.deliveryTime)}</span>
      <button
        className={styles.supplierWaitlistButton}
        onClick={() => onWaitlist({
          brand,
          deliveryTime: stock.deliveryTime,
          guid: partGuid,
          name,
          partNumber,
          priceKopeks: stock.priceKopeks,
          query,
          quantityAvailable: stock.quantity,
          stockId: stock.id,
        })}
        type="button"
      >
        В ожидание
      </button>
    </div>
  );
}

function CrossItem({ cross, onWaitlist, query }: {
  cross: SupplierPartView;
  onWaitlist: (target: SupplierWaitlistTarget) => void;
  query: string;
}) {
  return (
    <div className={styles.supplierCrossItem}>
      <p className={styles.supplierPartMeta}>{cross.brand} · Артикул {cross.partNumber} — {cross.name}</p>
      {cross.stocks.length > 0 ? (
        <div className={styles.supplierStockList}>
          {cross.stocks.map((stock) => (
            <StockRow brand={cross.brand} key={stock.id} name={cross.name} onWaitlist={onWaitlist} partGuid={cross.guid} partNumber={cross.partNumber} query={query} stock={stock} />
          ))}
        </div>
      ) : (
        <p className={styles.supplierCrossNoStock}>Предложений пока нет.</p>
      )}
    </div>
  );
}

/**
 * One part in the "Привезём под заказ" grid. Self-contained and
 * top-aligned by design (see `.supplierPartCard` / `.supplierPartList` in
 * storefront.module.css — the grid must never stretch a card to match a
 * taller sibling). Only the single cheapest available line is shown up
 * front with its own waitlist button; every remaining stock line and every
 * analogue is real data, never dropped, just tucked behind a native
 * `<details>` disclosure so a part with a dozen offers doesn't turn the
 * card into a wall of prices.
 */
function PartCard({ onWaitlist, part, query }: {
  onWaitlist: (target: SupplierWaitlistTarget) => void;
  part: SupplierPartView;
  query: string;
}) {
  const best = bestStock(part.stocks);
  const restStocks = best ? part.stocks.filter((stock) => stock.id !== best.id) : part.stocks;
  const hiddenCount = restStocks.length + part.crosses.length;

  return (
    <article className={styles.supplierPartCard}>
      <div className={styles.supplierPartHead}>
        <span className={styles.supplierBadge}>Под заказ</span>
        <p className={styles.supplierPartMeta}>{part.brand} · Артикул {part.partNumber}</p>
        <h3 className={styles.supplierPartName}>{part.name}</h3>
      </div>

      {best ? (
        <div className={styles.supplierStockList}>
          <StockRow brand={part.brand} key={best.id} name={part.name} onWaitlist={onWaitlist} partGuid={part.guid} partNumber={part.partNumber} query={query} stock={best} />
        </div>
      ) : (
        <p className={styles.supplierCrossNoStock}>Прямого предложения нет — есть аналоги ниже.</p>
      )}

      {hiddenCount > 0 ? (
        <details className={styles.supplierMoreDetails}>
          <summary className={styles.supplierMoreSummary}>Ещё {hiddenCount} {offersWord(hiddenCount)}</summary>
          <div className={styles.supplierMoreBody}>
            {restStocks.length > 0 ? (
              <div className={styles.supplierStockList}>
                {restStocks.map((stock) => (
                  <StockRow brand={part.brand} key={stock.id} name={part.name} onWaitlist={onWaitlist} partGuid={part.guid} partNumber={part.partNumber} query={query} stock={stock} />
                ))}
              </div>
            ) : null}

            {part.crosses.length > 0 ? (
              <div className={styles.supplierCrossList}>
                <p className={styles.supplierCrossLabel}>Аналоги</p>
                {part.crosses.map((cross) => <CrossItem cross={cross} key={cross.guid} onWaitlist={onWaitlist} query={query} />)}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

/**
 * The "Привезём под заказ" block on a catalog search. Deliberately separate
 * from the server-rendered "На складе" block above it: this component
 * fetches `/api/v1/suppliers/search` itself, client-side, after the page
 * (with the shop's own 1C results) has already painted — a cold under-order
 * lookup takes 3-5s and must never hold up the page the customer is already
 * reading. `query` only ever reaches this component once it is a real
 * search (≥2 characters); see the `isSearch` gate in catalog page.tsx and
 * catalog/[...slug]/page.tsx.
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
    <section aria-labelledby="supplier-results-heading" className={styles.supplierSection}>
      <h2 className={styles.resultsSourceHeading} id="supplier-results-heading">Привезём под заказ</h2>
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
          <div className={styles.supplierPartList}>
            {parts.map((part) => <PartCard key={part.guid} onWaitlist={setWaitlistTarget} part={part} query={query} />)}
          </div>
        </>
      ) : null}

      <SupplierWaitlistDialog onClose={() => setWaitlistTarget(null)} target={waitlistTarget} />
    </section>
  );
}
