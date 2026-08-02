import styles from "../../../_components/storefront.module.css";

export default function ProductLoading() {
  return (
    <div className={styles.page}>
      <section className={styles.loadingState} aria-live="polite" aria-busy="true">
        <h2>Загружаем товар</h2>
        <p>Проверяем цену и остаток.</p>
      </section>
    </div>
  );
}
