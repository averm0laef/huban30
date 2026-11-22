"use client";

import { useEffect, useState } from "react";

import { computeShopStatusNow, type ShopStatus } from "./shop-status";
import styles from "./content-page.module.css";

/** «Сейчас открыто · закроется через 2 ч» — re-read every 30 s; empty until mounted so server and client HTML agree. */
export function ShopOpenLine() {
  const [status, setStatus] = useState<ShopStatus | null>(null);
  useEffect(() => {
    setStatus(computeShopStatusNow());
    const id = window.setInterval(() => setStatus(computeShopStatusNow()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!status) return <p className={styles.openLine} aria-hidden="true">&nbsp;</p>;
  return (
    <p className={styles.openLine}>
      <span aria-hidden="true" className={styles.openDot} data-open={status.open || undefined} />
      <strong>{status.label}</strong> · {status.detail}
    </p>
  );
}
