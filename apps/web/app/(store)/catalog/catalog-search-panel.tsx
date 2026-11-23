import { CATALOG_VEHICLE_KIND_LABELS } from "@an30/contracts";
import Link from "next/link";

import { AddToCartButton } from "../_components/cart-actions";
import { ChevronLeft20Regular, ChevronRight20Regular, Clock20Regular, Search20Regular, VehicleCar20Regular } from "../_components/home-icons";
import buttons from "../_components/store-button.module.css";
import styles from "../_components/storefront.module.css";
import { formatRubles } from "../_lib/catalog-api";
import type { CatalogBrand, CatalogCategoryNode, CatalogItem } from "../_lib/catalog-api";
import { findCategorySlugPath } from "../_lib/catalog-tree";
import { searchServiceLinks, suggestedCatalogSections } from "../_lib/search-guidance";
import { catalogCategoryPhoto } from "../_lib/store-categories";
import { isValidVin } from "../_lib/vin";
import { CatalogResultRow, RowBadge } from "./catalog-result-row";
import layoutStyles from "./catalog-layout.module.css";
import { catalogLastPage, catalogPageHref, catalogPageNumbers, clearCatalogFiltersHref, type CatalogPageQuery } from "./catalog-query";
import resultsStyles from "./catalog-results.module.css";
import { CATALOG_SEARCH_FORM_ID } from "./catalog-search-form";
import { CatalogSelectionRequest } from "./catalog-selection-request";
import { CatalogFilterTrigger, CatalogPageSizeSelect, CatalogSortSelect, Checkmark20Regular, Grid20Regular, TextBulletList20Regular } from "./catalog-toolbar-controls";
import { CatalogVinHelpLink } from "./catalog-vin-help-link";
import { ExpertHelpQueryLink } from "./expert-help-query-link";

// A question to the shop about a product («Узнать срок», «Уточнить цену»): the same soft button as on /podbor.
const askButton = `${buttons.button} ${buttons.soft}`;

export { CATALOG_SEARCH_FORM_ID } from "./catalog-search-form";

export interface CatalogEmptyState {
  body: string;
  heading: string;
}

export interface CatalogSearchPanelProps {
  /** Form target: `/catalog` site-wide, or the current category's own path. */
  action: string;
  brands?: CatalogBrand[];
  /** Set by the caller whenever `items` is empty, with level-appropriate copy. */
  emptyState: CatalogEmptyState | null;
  errorHeading?: string;
  errorMessage: string | null;
  items: CatalogItem[];
  /** "any": no product had every word, so these match at least one of them. */
  matchMode?: "all" | "any";
  pageSize: number;
  /** On a section's page: its name. The toolbar then has the section's own search field. */
  sectionName?: string;
  state: CatalogPageQuery;
  total: number;
  tree: CatalogCategoryNode[];
}

/** Sorting and filter controls submit together to the current catalog scope. */
export function CatalogSearchPanel({
  action, brands = [], emptyState, errorHeading = "Каталог не отвечает", errorMessage, items, matchMode = "all", pageSize, sectionName, state, total, tree,
}: CatalogSearchPanelProps) {
  const isSearch = state.query.trim().length >= 2;
  const isVin = isValidVin(state.query.trim());
  // A list opens up to its last reachable page: «Дальше» past it used to start the list again from page 1.
  const totalPages = Math.min(catalogLastPage(pageSize), Math.max(1, Math.ceil(total / pageSize)));
  const currentPage = Math.min(state.page, totalPages);
  const showPagination = !errorMessage && total > pageSize;
  const serviceLinks = isSearch && !isVin ? searchServiceLinks(state.query) : [];
  const categoryLinks = emptyState && isSearch ? suggestedCatalogSections(state.query) : [];
  const selectionRequest = { query: state.query, sectionName, vehicleKind: state.vehicleKind };
  const filters = [
    ...(state.vehicleKind === null ? [] : [{
      label: CATALOG_VEHICLE_KIND_LABELS[state.vehicleKind],
      href: catalogPageHref(action, { ...state, vehicleKind: null }),
    }]),
    ...(state.availability === "all" ? [] : [{
      label: state.availability === "in_stock" ? "В наличии" : "Под заказ",
      href: catalogPageHref(action, { ...state, availability: "all" }),
    }]),
    ...state.brands.map(slug => ({
      label: brands.find(brand => brand.slug === slug)?.name ?? slug,
      href: catalogPageHref(action, { ...state, brands: state.brands.filter(brand => brand !== slug) }),
    })),
    ...(state.minPriceRubles === null && state.maxPriceRubles === null ? [] : [{
      label: [state.minPriceRubles === null ? "" : `от ${state.minPriceRubles}`, state.maxPriceRubles === null ? "" : `до ${state.maxPriceRubles}`].filter(Boolean).join(" ") + " ₽",
      href: catalogPageHref(action, { ...state, minPriceRubles: null, maxPriceRubles: null }),
    }]),
  ];

  const body = errorMessage ? (
    <section className={styles.errorState} role="alert">
      <h2>{errorHeading}</h2>
      <p>{errorMessage}</p>
    </section>
  ) : emptyState ? (
    <section className={isSearch ? `${styles.emptyState} ${resultsStyles.searchEmptyState}` : styles.emptyState}>
      <h2>{emptyState.heading}</h2>
      <p>{emptyState.body}</p>
      {/* Every empty list — a search, a filter, a section with no products yet — offers the selection request. */}
      <div className={resultsStyles.emptyLinks}>
        <CatalogSelectionRequest empty {...selectionRequest} />
        {isSearch ? <>
          {categoryLinks.map(({ href, label }) => (
            <Link className={`${buttons.button} ${buttons.quiet}`} key={href} href={href}><Grid20Regular aria-hidden="true" />{label}</Link>
          ))}
          <Link className={`${buttons.button} ${buttons.soft}`} href={`/podbor?q=${encodeURIComponent(state.query.trim().slice(0, 140))}`}>
            <VehicleCar20Regular aria-hidden="true" />
            Подобрать по автомобилю и аналогам
          </Link>
        </> : null}
      </div>
    </section>
  ) : (
    <>
      <CatalogSelectionRequest {...selectionRequest} />
      {matchMode === "any" && isSearch ? (
        <p className={resultsStyles.looseMatchNote} role="status">
          Точного совпадения по запросу «{state.query.trim()}» нет. Ниже — похожие товары. Уточните запрос или <Link href="/expert-help">спросите специалиста</Link>.
        </p>
      ) : null}
      <section aria-label={isSearch ? "Результаты поиска" : "Товары каталога"} className={resultsStyles.resultsList} data-catalog-view={state.view}>
        {items.map((item) => {
          const available = item.availableQuantity > 0;
          const directCategoryImage = catalogCategoryPhoto(item.category);
          return (
            <CatalogResultRow
              actionSlot={item.priceKopeks === null
                ? <ExpertHelpQueryLink className={askButton} query={item.sku}>Уточнить цену</ExpertHelpQueryLink>
                : available
                  ? <AddToCartButton productId={item.id} />
                  : (
                    <ExpertHelpQueryLink
                      className={askButton}
                      prefillMessage={`Нужна деталь под заказ: ${item.brand ? `${item.brand.name} ` : ""}${item.sku}, ${item.name}. Подскажите срок и цену.`}
                    >
                      <Clock20Regular aria-hidden="true" />
                      Узнать срок
                    </ExpertHelpQueryLink>
                  )}
              // A product found via a confirmed article cross (see
              // catalog-public.service.ts / migration 0018) is never the
              // exact article the customer typed — it must read like the
              // supplier analogue badge (`RowBadge analog`, "Аналог") in
              // supplier-results.tsx, not like an ordinary own-stock row,
              // so nobody is sold a different part without being told.
              badges={item.matchedVia === "cross" ? <RowBadge analog>Аналог</RowBadge> : undefined}
              brand={item.brand ? item.brand.name : null}
              categoryImage={directCategoryImage ?? (item.category
                ? catalogCategoryPhoto(item.category, findCategorySlugPath(tree, item.category.slug) ?? [])
                : null)}
              imageAlt={item.primaryImage?.altText ?? ""}
              imageUrl={item.primaryImage?.url}
              key={item.id}
              name={<Link href={`/catalog/product/${encodeURIComponent(item.slug)}`}>{item.name}</Link>}
              priceLabel={item.priceKopeks === null ? "Цена уточняется" : formatRubles(item.priceKopeks)}
              quantity={item.availableQuantity}
              sku={item.sku}
              view={state.view}
            />
          );
        })}
      </section>
      {showPagination ? (
        <nav aria-label="Страницы каталога" className={resultsStyles.pagination}>
          {currentPage > 1 ? (
            <Link className={`${buttons.button} ${buttons.quiet} ${resultsStyles.pagePrev}`} href={catalogPageHref(action, state, currentPage - 1)} rel="prev">
              <ChevronLeft20Regular aria-hidden="true" /> Назад
            </Link>
          ) : <span aria-hidden="true" className={resultsStyles.pagePrev} />}
          <ol className={resultsStyles.pageNumbers}>
            {catalogPageNumbers(currentPage, totalPages).map((number, index) => (number === null ? (
              <li aria-hidden="true" className={resultsStyles.pageGap} key={`gap-${index}`}>…</li>
            ) : (
              <li key={number}>
                {number === currentPage
                  ? <span aria-current="page" aria-label={`Страница ${number}, текущая`} className={resultsStyles.pageNumber}>{number}</span>
                  : <Link aria-label={`Страница ${number}`} className={resultsStyles.pageNumber} href={catalogPageHref(action, state, number)}>{number}</Link>}
              </li>
            )))}
          </ol>
          {currentPage < totalPages ? (
            <Link className={`${buttons.button} ${buttons.soft} ${resultsStyles.pageNext}`} href={catalogPageHref(action, state, currentPage + 1)} rel="next">
              Дальше <ChevronRight20Regular aria-hidden="true" />
            </Link>
          ) : <span aria-hidden="true" className={resultsStyles.pageNext} />}
        </nav>
      ) : null}
    </>
  );

  return (
    <>
      <form action={action} className={layoutStyles.toolbar} id={CATALOG_SEARCH_FORM_ID} method="get">
        {sectionName ? (
          // A search inside this section: some look for a name among the filters only. The header searches everything.
          <label className={layoutStyles.sectionSearch}>
            <span className={styles.visuallyHidden}>Найти в разделе «{sectionName}»</span>
            <Search20Regular aria-hidden="true" />
            <input defaultValue={state.query} enterKeyHint="search" key={state.query} maxLength={120} name="q"
              placeholder={`Найти в разделе «${sectionName}»`} type="search" />
            <button type="submit">Найти</button>
          </label>
        ) : state.query && <input name="q" type="hidden" value={state.query} />}
        {state.view === "list" && <input name="view" type="hidden" value={state.view} />}
        <CatalogFilterTrigger count={filters.length} />
        <CatalogSortSelect value={state.sort} />
        <CatalogPageSizeSelect value={state.pageSize} />
        <Link aria-label={state.availability === "in_stock" ? "Сбросить фильтр наличия" : "В наличии"}
          data-active={state.availability === "in_stock"} className={layoutStyles.quickFilter}
          href={catalogPageHref(action, { ...state, availability: state.availability === "in_stock" ? "all" : "in_stock" })}>
          <Checkmark20Regular aria-hidden="true" /> В наличии
        </Link>
        <div aria-label="Вид каталога" className={layoutStyles.viewToggle} role="group">
          <Link aria-label="Плиткой" aria-current={state.view === "grid" ? "page" : undefined}
            href={catalogPageHref(action, { ...state, view: "grid" }, state.page)}>
            <Grid20Regular aria-hidden="true" />
          </Link>
          <Link aria-label="Списком" aria-current={state.view === "list" ? "page" : undefined}
            href={catalogPageHref(action, { ...state, view: "list" }, state.page)}>
            <TextBulletList20Regular aria-hidden="true" />
          </Link>
        </div>
        <noscript><button className={styles.submitButton} type="submit">Применить сортировку</button></noscript>
      </form>
      {serviceLinks.length ? <nav className={resultsStyles.matchedServices} aria-label="Информация магазина">
        <strong>Информация магазина</strong>
        {serviceLinks.map(({ href, label }) => <Link key={href} href={href}>{label}</Link>)}
      </nav> : null}
      {filters.length > 0 && (
        <ul className={resultsStyles.activeFilters} aria-label="Выбранные фильтры">
          {filters.map((filter) => (
            <li key={filter.href}>
              <Link href={filter.href} aria-label={`Снять фильтр: ${filter.label}`}>{filter.label}<span aria-hidden="true">×</span></Link>
            </li>
          ))}
          <li><Link className={resultsStyles.clearFilters} href={clearCatalogFiltersHref(action, state)}>Сбросить всё</Link></li>
        </ul>
      )}

      {isVin ? (
        <section className={styles.emptyState} aria-label="Подбор по VIN">
          <h2>VIN поможет подобрать нужную деталь</h2>
          <p>VIN не ищется среди артикулов. Передайте его специалисту для подбора по автомобилю.</p>
          <CatalogVinHelpLink vin={state.query.trim()} />
        </section>
      ) : null}

      {isVin ? null : body}
    </>
  );
}
