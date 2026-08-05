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
  /** Set by the caller whenever `items` is empty, with level-appropriate copy. */
  emptyState: CatalogEmptyState | null;
  errorMessage: string | null;
  items: CatalogItem[];
  query: string;
  sort: CatalogSort;
}

/**
 * Id shared with `CatalogFilterRail`'s availability `<select>`, which lives
 * outside this component's own `<form>` (in the rail, a DOM sibling) and
 * links back to it purely via the HTML `form` attribute — see the comment
 * on `CatalogFilterRail` for why.
 */
export const CATALOG_SEARCH_FORM_ID = "catalog-search-form";

/**
 * The search form + product grid shared by `/catalog` (site-wide) and every
 * `/catalog/[...slug]` category level — the category itself comes from the
 * route, not a query parameter, so a search here always combines with
 * whichever category the page already scoped `searchCatalog` to.
 *
 * Honest by construction: it only ever renders `items` the server actually
 * returned, and the caller must supply `emptyState` copy whenever there are
 * none — there is no generic "browse the catalog" grid to fall back to.
 *
 * When `query` is a real search (≥2 characters) the results are wrapped in
 * their own "На складе" heading — the shop's own 1C stock, deliberately
 * labelled and visually separate from the under-order block the page
 * renders below it (`SupplierResults`). A plain category browse (no query,
 * or the 1-character hint) renders unlabelled, exactly as before.
 */
export function CatalogSearchPanel({
  action, emptyState, errorMessage, items, query, sort,
}: CatalogSearchPanelProps) {
  const isSearch = query.trim().length >= 2;

  const body = errorMessage ? (
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
              <div className={styles.productVisual}>
                <Image
                  alt={item.primaryImage ? item.primaryImage.altText : `Нет фото товара «${item.name}»`}
                  fill
                  sizes="(max-width: 767px) 50vw, 240px"
                  src={item.primaryImage ? item.primaryImage.url : "/catalog/no-photo.webp"}
                />
              </div>
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
  );

  return (
    <>
      <form action={action} className={styles.catalogForm} id={CATALOG_SEARCH_FORM_ID} method="get" role="search">
        <div className={styles.field}>
          <label htmlFor="catalog-query">Название или артикул</label>
          <input defaultValue={query} id="catalog-query" maxLength={120} minLength={2} name="q" placeholder="Например, фильтр или артикул" type="search" />
        </div>
        <div className={styles.field}>
          <label htmlFor="catalog-sort">Сортировка</label>
          <select defaultValue={sort} id="catalog-sort" name="sort">
            <option value="relevance">По совпадению</option>
            <option value="name">По названию</option>
            <option value="price_asc">Сначала дешевле</option>
            <option value="price_desc">Сначала дороже</option>
          </select>
        </div>
        <button className={styles.submitButton} type="submit">Найти</button>
      </form>

      {isSearch ? (
        <section aria-labelledby="own-results-heading" className={styles.ownResultsSection}>
          <h2 className={styles.resultsSourceHeading} id="own-results-heading">На складе</h2>
          {body}
        </section>
      ) : body}
    </>
  );
}
