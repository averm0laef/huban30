import type { Metadata } from "next";
import Link from "next/link";

import { AddToCartButton } from "../_components/cart-actions";
import styles from "../_components/storefront.module.css";
import { formatRubles, searchCatalog, StorefrontApiError } from "../_lib/catalog-api";
import type { CatalogItem } from "../_lib/catalog-api";

export const metadata: Metadata = {
  title: "Каталог автозапчастей",
  description: "Поиск автозапчастей АН-30 по названию и артикулу.",
};

type Availability = "all" | "in_stock" | "out_of_stock";
type Sort = "name" | "price_asc" | "price_desc" | "relevance";

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const parameters = await searchParams;
  const query = first(parameters.q).trim().slice(0, 120);
  const availabilityValue = first(parameters.availability);
  const sortValue = first(parameters.sort);
  const availability: Availability = availabilityValue === "in_stock" || availabilityValue === "out_of_stock" ? availabilityValue : "all";
  const sort: Sort = sortValue === "name" || sortValue === "price_asc" || sortValue === "price_desc" ? sortValue : "relevance";

  let items: CatalogItem[] = [];
  let errorMessage: string | null = null;
  if (query.length >= 2) {
    try {
      const response = await searchCatalog(query, 48, availability, sort);
      items = response.items;
    } catch (error) {
      errorMessage = error instanceof StorefrontApiError ? error.message : "Не удалось прочитать ответ каталога.";
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageTitle}>
        <h1>Каталог</h1>
        <p>Введите не менее двух символов. Поиск работает по названию и артикулу из 1С.</p>
      </header>

      <form className={styles.catalogForm} action="/catalog" method="get" role="search">
        <div className={styles.field}>
          <label htmlFor="catalog-query">Название или артикул</label>
          <input id="catalog-query" name="q" type="search" minLength={2} maxLength={120} defaultValue={query} placeholder="Например, фильтр или артикул" />
        </div>
        <div className={styles.field}>
          <label htmlFor="catalog-availability">Наличие</label>
          <select id="catalog-availability" name="availability" defaultValue={availability}>
            <option value="all">Все товары</option>
            <option value="in_stock">В наличии</option>
            <option value="out_of_stock">Нет в наличии</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="catalog-sort">Сортировка</label>
          <select id="catalog-sort" name="sort" defaultValue={sort}>
            <option value="relevance">По совпадению</option>
            <option value="name">По названию</option>
            <option value="price_asc">Сначала дешевле</option>
            <option value="price_desc">Сначала дороже</option>
          </select>
        </div>
        <button className={styles.submitButton} type="submit">Найти</button>
      </form>

      {errorMessage ? (
        <section className={styles.errorState} role="alert">
          <h2>Каталог не отвечает</h2>
          <p>{errorMessage}</p>
        </section>
      ) : query.length === 1 ? (
        <section className={styles.emptyState}>
          <h2>Нужно ещё немного текста</h2>
          <p>Введите минимум два символа названия или артикула.</p>
        </section>
      ) : query.length === 0 ? (
        <section className={styles.emptyState}>
          <h2>Начните с поиска</h2>
          <p>Мы не показываем демонстрационные товары. Результаты поступят из подтверждённого каталога 1С.</p>
        </section>
      ) : items.length === 0 ? (
        <section className={styles.emptyState}>
          <h2>Ничего не найдено</h2>
          <p>Проверьте артикул, уберите фильтр наличия или попробуйте более короткий запрос.</p>
        </section>
      ) : (
        <>
          <p className={styles.catalogSummary} aria-live="polite">Найдено: {items.length}</p>
          <section className={styles.productGrid} aria-label="Результаты поиска">
            {items.map((item) => {
              const available = item.availableQuantity > 0;
              return (
                <article className={styles.productCard} key={item.id}>
                  <div className={styles.productVisual} role="img" aria-label={`У товара «${item.name}» пока нет фотографии`}>
                    Нет фото
                  </div>
                  <div className={styles.productBody}>
                    <p className={styles.productMeta}>Артикул: {item.sku}</p>
                    <h2 className={styles.productName}><Link href={`/catalog/product/${encodeURIComponent(item.slug)}`}>{item.name}</Link></h2>
                    <p className={styles.productPrice}>{item.priceKopeks === null ? "Цена уточняется" : formatRubles(item.priceKopeks)}</p>
                    <p className={`${styles.stock} ${available ? "" : styles.stockOut}`}>{available ? `В наличии: ${item.availableQuantity}` : "Нет в наличии"}</p>
                    <AddToCartButton disabled={!available || item.priceKopeks === null} productId={item.id} />
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
