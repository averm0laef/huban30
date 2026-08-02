"use client";

import styles from "../_components/storefront.module.css";

export default function CatalogError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={styles.page}>
      <section className={styles.errorState} role="alert">
        <h2>Не удалось открыть каталог</h2>
        <p>Соединение прервалось. Повторите запрос.</p>
        <button className={styles.submitButton} type="button" onClick={reset}>Повторить</button>
      </section>
    </div>
  );
}
