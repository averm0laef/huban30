"use client";

import { useEffect, useState } from "react";

import { STORE_LOCALITY, STORE_MAP_URL, STORE_STREET } from "../../site-config";
import { computeShopStatusNow } from "./shop-status";
import type { ShopStatus } from "./shop-status";
import styles from "./storefront.module.css";

const REEVALUATE_MS = 30_000;

function sameStatus(a: ShopStatus, b: ShopStatus): boolean {
  return a.open === b.open && a.label === b.label && a.detail === b.detail;
}

/**
 * Live open/closed line for the home page's first "Магазин прямо сейчас"
 * block. `initialStatus` is computed on the server by `FeaturePanel` (see
 * home-sections.tsx) from the same real clock this component re-reads, so
 * the first client render matches the server-rendered HTML exactly — no
 * hydration mismatch — and then a 30s interval keeps it from going stale
 * in a tab left open across the 09:00/19:00 boundary. The interval only
 * calls `setStatus` when the computed value actually changed, so it does
 * not re-render (or, if this ever grows an `aria-live` region, re-announce
 * anything) every 30 seconds for no reason.
 */
export function ShopStatusBlock({ initialStatus }: { initialStatus: ShopStatus }) {
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStatus((previous) => {
        const next = computeShopStatusNow();
        return sameStatus(previous, next) ? previous : next;
      });
    }, REEVALUATE_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className={styles.quickBlock}>
      <p className={styles.quickBlockStatusLine}>
        <span aria-hidden="true" className={styles.statusDot} data-open={status.open} />
        <span className={styles.quickBlockTitle}>{status.label}</span>
        <span className={styles.quickBlockStatusDetail}>{status.detail}</span>
      </p>
      <p className={styles.quickBlockText}>{STORE_LOCALITY}, {STORE_STREET}</p>
      <a className={styles.quickBlockLink} href={STORE_MAP_URL} rel="noreferrer" target="_blank">Маршрут до магазина</a>
    </div>
  );
}
