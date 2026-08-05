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
  return deliveryTime ? `Срок: ${deliveryTime}` : "Срок уточняется у поставщика";
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
      <span className={styles.supplierStockQuantity}>{stock.quantity} шт. у поставщика</span>
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

function PartCard({ onWaitlist, part, query }: {
  onWaitlist: (target: SupplierWaitlistTarget) => void;
  part: SupplierPartView;
  query: string;
}) {
  return (
    <article className={styles.supplierPartCard}>
      <div className={styles.supplierPartHead}>
        <span className={styles.supplierBadge}>Под заказ</span>
        <p className={styles.supplierPartMeta}>{part.brand} · Артикул {part.partNumber}</p>
        <h3 className={styles.supplierPartName}>{part.name}</h3>
      </div>

      {part.stocks.length > 0 ? (
        <div className={styles.supplierStockList}>
          {part.stocks.map((stock) => (
            <StockRow brand={part.brand} key={stock.id} name={part.name} onWaitlist={onWaitlist} partGuid={part.guid} partNumber={part.partNumber} query={query} stock={stock} />
          ))}
        </div>
      ) : null}

      {part.crosses.length > 0 ? (
        <div className={styles.supplierCrossList}>
          <p className={styles.supplierCrossLabel}>Аналоги</p>
          {part.crosses.map((cross) => (
            <div className={styles.supplierCrossItem} key={cross.guid}>
              <p className={styles.supplierPartMeta}>{cross.brand} · Артикул {cross.partNumber} — {cross.name}</p>
              {cross.stocks.length > 0 ? (
                <div className={styles.supplierStockList}>
                  {cross.stocks.map((stock) => (
                    <StockRow brand={cross.brand} key={stock.id} name={cross.name} onWaitlist={onWaitlist} partGuid={cross.guid} partNumber={cross.partNumber} query={query} stock={stock} />
                  ))}
                </div>
              ) : (
                <p className={styles.supplierCrossNoStock}>Нет предложения у поставщика прямо сейчас.</p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/**
 * The "Под заказ у поставщика" block on a catalog search. Deliberately
 * separate from the server-rendered "В наличии" block above it: this
 * component fetches `/api/v1/suppliers/search` itself, client-side, after
 * the page (with the shop's own 1C results) has already painted — a cold
 * Rossko call takes 3-5s and must never hold up the page the customer is
 * already reading. `query` only ever reaches this component once it is a
 * real search (≥2 characters); see the `isSearch` gate in catalog page.tsx
 * and catalog/[...slug]/page.tsx.
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
          : { message: "Поставщик вернул некорректный ответ.", status: "error" });
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
      <h2 className={styles.resultsSourceHeading} id="supplier-results-heading">Под заказ у поставщика</h2>
      <p className={styles.supplierIntro}>Этих позиций может не быть на нашем складе — поставщик Rossko привезёт их под заказ.</p>

      {state.status === "loading" ? (
        <section aria-busy="true" aria-live="polite" className={styles.loadingState}>
          <h3>Спрашиваем у поставщика</h3>
          <p>Обычно это занимает несколько секунд.</p>
        </section>
      ) : null}

      {state.status === "error" ? (
        <section className={styles.errorState} role="alert">
          <h3>Не удалось спросить поставщика</h3>
          <p>{state.message}</p>
          <button className={styles.submitButton} onClick={retry} type="button">Повторить</button>
        </section>
      ) : null}

      {supplierUnavailable ? (
        <section className={styles.errorState} role="alert">
          <h3>Поставщик недоступен</h3>
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
                Мы проверили собственный склад и поставщика — по запросу «{query}» пока ничего нет ни там, ни там.
                Позвоните нам или опишите деталь специалисту: подберём аналог или узнаем срок под заказ.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href={`tel:${STORE_PHONE}`}>{STORE_PHONE_DISPLAY}</a>
                <Link className={styles.secondaryAction} href="/expert-help">Спросить специалиста</Link>
              </div>
            </>
          ) : (
            <>
              <h3>У поставщика ничего нет</h3>
              <p>По запросу «{query}» подходящих позиций под заказ не нашлось. Попробуйте изменить запрос.</p>
            </>
          )}
        </section>
      ) : null}

      {ready && parts.length > 0 ? (
        <>
          {ready.truncated ? (
            <p className={styles.supplierTruncatedNote}>Показаны первые {parts.length} из {ready.totalFound} найденных у поставщика.</p>
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
