import Link from "next/link";

import { AddToCartButton } from "../_components/cart-actions";
import styles from "../_components/storefront.module.css";
import { formatRubles } from "../_lib/catalog-api";
import type { CatalogItem } from "../_lib/catalog-api";
import { CatalogResultRow, RowBadge } from "./catalog-result-row";
import { catalogPageHref, type CatalogPageQuery } from "./catalog-query";
import resultsStyles from "./catalog-results.module.css";

export interface CatalogEmptyState {
  body: string;
  heading: string;
}

export interface CatalogSearchPanelProps {
  /** Form target: `/catalog` site-wide, or the current category's own path. */
  action: string;
  /** Set by the caller whenever `items` is empty, with level-appropriate copy. */
  emptyState: CatalogEmptyState | null;
  errorHeading?: string;
  errorMessage: string | null;
  items: CatalogItem[];
  pageSize: number;
  state: CatalogPageQuery;
  total: number;
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
  action, emptyState, errorHeading = "Каталог не отвечает", errorMessage, items, pageSize, state, total,
}: CatalogSearchPanelProps) {
  const isSearch = state.query.trim().length >= 2;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPagination = !errorMessage && total > pageSize;

  const body = errorMessage ? (
    <section className={styles.errorState} role="alert">
      <h2>{errorHeading}</h2>
      <p>{errorMessage}</p>
    </section>
  ) : emptyState ? (
    <section className={styles.emptyState}>
      <h2>{emptyState.heading}</h2>
      <p>{emptyState.body}</p>
    </section>
  ) : (
    <>
      <p className={styles.catalogSummary} aria-live="polite">
        Найдено: {total}{total > items.length ? ` · показано ${items.length}` : ""}
      </p>
      {isSearch ? <h2 className={resultsStyles.sourceCaption}>На складе</h2> : null}
      <section aria-label="Результаты поиска" className={resultsStyles.resultsList}>
        {items.map((item) => {
          const available = item.availableQuantity > 0;
          return (
            <CatalogResultRow
              actionSlot={<AddToCartButton disabled={!available || item.priceKopeks === null} productId={item.id} />}
              // A product found via a confirmed article cross (see
              // catalog-public.service.ts / migration 0018) is never the
              // exact article the customer typed — it must read like the
              // supplier analogue badge (`RowBadge analog`, "Аналог") in
              // supplier-results.tsx, not like an ordinary own-stock row,
              // so nobody is sold a different part without being told.
              badges={item.matchedVia === "cross" ? <RowBadge analog>Аналог</RowBadge> : undefined}
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
      {showPagination ? (
        <nav aria-label="Страницы каталога" className={resultsStyles.pagination}>
          {state.page > 1 ? (
            <Link href={catalogPageHref(action, state, state.page - 1)} rel="prev">Назад</Link>
          ) : <span aria-hidden="true" />}
          <span>Страница {Math.min(state.page, totalPages)} из {totalPages}</span>
          {state.page < totalPages ? (
            <Link href={catalogPageHref(action, state, state.page + 1)} rel="next">Дальше</Link>
          ) : <span aria-hidden="true" />}
        </nav>
      ) : null}
    </>
  );

  return (
    <>
      <form action={action} className={styles.catalogForm} id={CATALOG_SEARCH_FORM_ID} method="get" role="search">
        <div className={styles.field}>
          <label htmlFor="catalog-query">Название или артикул</label>
          <input defaultValue={state.query} id="catalog-query" maxLength={120} minLength={2} name="q" placeholder="Например, фильтр или артикул" type="search" />
        </div>
        <div className={styles.field}>
          <label htmlFor="catalog-sort">Сортировка</label>
          <select defaultValue={state.sort} id="catalog-sort" name="sort">
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
