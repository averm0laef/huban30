import Link from "next/link";

import styles from "./_components/storefront.module.css";

export default function StorefrontNotFound() {
  return (
    <div className={styles.page}>
      <section className={styles.emptyState}>
        <h1>Страница не найдена</h1>
        <p>Проверьте адрес или вернитесь в каталог.</p>
        <Link className={styles.primaryAction} href="/catalog">Открыть каталог</Link>
      </section>
    </div>
  );
}
