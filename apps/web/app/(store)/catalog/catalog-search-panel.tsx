import Link from "next/link";

import { AddToCartButton } from "../_components/cart-actions";
import styles from "../_components/storefront.module.css";
import { formatRubles } from "../_lib/catalog-api";
import type { CatalogItem } from "../_lib/catalog-api";
import { CatalogResultRow } from "./catalog-result-row";
import resultsStyles from "./catalog-results.module.css";

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
 * The search form + the shop's own 1C rows, shared by `/catalog` (site-wide)
 * and every `/catalog/[...slug]` category level — the category itself comes
 * from the route, not a query parameter, so a search here always combines
 * with whichever category the page already scoped `searchCatalog` to.
 *
 * Honest by construction: it only ever renders `items` the server actually
 * returned, and the caller must supply `emptyState` copy whenever there are
 * none — there is no generic "browse the catalog" list to fall back to.
 *
 * Each row renders through `CatalogResultRow`, the exact same row component
 * `supplier-results.tsx` uses for the under-order offers below it — that
 * shared anatomy is what makes the two sources read as one continuous list
 * rather than two differently-shaped blocks. When `query` is a real search
 * (≥2 characters) the rows get a small "На складе" caption above them,
 * deliberately light — not a boxed section — so the reader can still see
 * where the shop's own stock ends and the under-order rows begin. A plain
 * category browse (no query, or the 1-character hint) renders unlabelled,
 * exactly as before.
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
      {isSearch ? <h2 className={resultsStyles.sourceCaption}>На складе</h2> : null}
      <section aria-label="Результаты поиска" className={resultsStyles.resultsList}>
        {items.map((item) => {
          const available = item.availableQuantity > 0;
          return (
            <CatalogResultRow
              actionSlot={<AddToCartButton disabled={!available || item.priceKopeks === null} productId={item.id} />}
              brand={item.brand ? item.brand.name : null}
              imageAlt={item.primaryImage ? item.primaryImage.altText : `Нет фото товара «${item.name}»`}
              imageUrl={item.primaryImage ? item.primaryImage.url : "/catalog/no-photo.webp"}
              key={item.id}
              name={<Link href={`/catalog/product/${encodeURIComponent(item.slug)}`}>{item.name}</Link>}
              priceLabel={item.priceKopeks === null ? "Цена уточняется" : formatRubles(item.priceKopeks)}
              quantity={item.availableQuantity}
              sku={item.sku}
            />
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

      {body}
    </>
  );
}
