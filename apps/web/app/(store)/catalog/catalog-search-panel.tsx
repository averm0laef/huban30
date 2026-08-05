import Image from "next/image";
import Link from "next/link";

import { AddToCartButton } from "../_components/cart-actions";
import styles from "../_components/storefront.module.css";
import { formatRubles } from "../_lib/catalog-api";
import type { CatalogItem } from "../_lib/catalog-api";

export type CatalogAvailability = "all" | "in_stock" | "out_of_stock";
export type CatalogSort = "name" | "price_asc" | "price_desc" | "relevance";

export interface CatalogEmptyState {
  body: string;
  heading: string;
}

export interface CatalogSearchPanelProps {
  /** Form target: `/catalog` site-wide, or the current category's own path. */
  action: string;
  availability: CatalogAvailability;
  /** Set by the caller whenever `items` is empty, with level-appropriate copy. */
  emptyState: CatalogEmptyState | null;
  errorMessage: string | null;
  items: CatalogItem[];
  query: string;
  sort: CatalogSort;
}

/**
 * The search form + product grid shared by `/catalog` (site-wide) and every
 * `/catalog/[...slug]` category level — the category itself comes from the
 * route, not a query parameter, so a search here always combines with
 * whichever category the page already scoped `searchCatalog` to.
 *
 * Honest by construction: it only ever renders `items` the server actually
 * returned, and the caller must supply `emptyState` copy whenever there are
 * none — there is no generic "browse the catalog" grid to fall back to.
 */
export function CatalogSearchPanel({
  action, availability, emptyState, errorMessage, items, query, sort,
}: CatalogSearchPanelProps) {
  return (
    <>
      <form className={styles.catalogForm} action={action} method="get" role="search">
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
      ) : emptyState ? (
        <section className={styles.emptyState}>
          <h2>{emptyState.heading}</h2>
          <p>{emptyState.body}</p>
        </section>
      ) : (
        <>
          <p className={styles.catalogSummary} aria-live="polite">Найдено: {items.length}</p>
          <section className={styles.productGrid} aria-label="Результаты поиска">
            {items.map((item) => {
              const available = item.availableQuantity > 0;
              return (
                <article className={styles.productCard} key={item.id}>
                  {item.primaryImage ? (
                    <div className={styles.productVisual}>
                      <Image alt={item.primaryImage.altText} fill sizes="(max-width: 767px) 50vw, 240px" src={item.primaryImage.url} />
                    </div>
                  ) : (
                    <div className={styles.productVisual} role="img" aria-label={`У товара «${item.name}» пока нет фотографии`}>
                      Нет фото
                    </div>
                  )}
                  <div className={styles.productBody}>
                    <p className={styles.productMeta}>{item.brand ? `${item.brand.name} · ` : ""}Артикул: {item.sku}</p>
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
    </>
  );
}
