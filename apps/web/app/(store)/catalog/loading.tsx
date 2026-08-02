import styles from "../_components/storefront.module.css";

export default function CatalogLoading() {
  return (
    <div className={styles.page}>
      <section className={styles.loadingState} aria-live="polite" aria-busy="true">
        <h2>Загружаем каталог</h2>
        <p>Получаем актуальные цены и остатки.</p>
      </section>
    </div>
  );
}
