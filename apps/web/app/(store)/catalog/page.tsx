import type { Metadata } from "next";
import { redirect } from "next/navigation";

import styles from "../_components/storefront.module.css";
import { JsonLd } from "../_components/json-ld";
import { getCatalogBrands, getCategoryTree, searchCatalog, StorefrontApiError } from "../_lib/catalog-api";
import type { CatalogItem } from "../_lib/catalog-api";
import { breadcrumbJsonLd, pageMetadata } from "../_lib/seo";
import { CatalogFilterRail } from "./catalog-filter-rail";
import { CatalogSearchPanel } from "./catalog-search-panel";
import type { CatalogEmptyState } from "./catalog-search-panel";
import {
  CATALOG_PAGE_SIZE,
  catalogPageHref,
  hasActiveCatalogFilters,
  parseCatalogPageQuery,
  priceKopeks,
} from "./catalog-query";
import { SupplierResults } from "./supplier-results";

export const metadata: Metadata = pageMetadata({
  description: "Каталог автозапчастей АН-30: разделы каталога, поиск по названию и артикулу, актуальные цены и остатки из 1С.",
  path: "/catalog",
  title: "Каталог автозапчастей",
});

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const parameters = await searchParams;
  const state = parseCatalogPageQuery(parameters);

  const [tree, brands] = await Promise.all([
    getCategoryTree(),
    getCatalogBrands().catch(() => []),
  ]);

  let items: CatalogItem[] = [];
  let total = 0;
  let errorHeading = "Каталог не отвечает";
  let errorMessage: string | null = null;
  const isSearch = state.query.length >= 2;
  const hasFilters = hasActiveCatalogFilters(state);
  const shouldFetch = state.query.length !== 1 && (isSearch || hasFilters);
  if (!state.priceRangeValid) {
    errorHeading = "Проверьте диапазон цены";
    errorMessage = "Цена «от» не может быть больше цены «до».";
  } else if (shouldFetch) {
    try {
      const response = await searchCatalog({
        availability: state.availability,
        brands: state.brands,
        limit: CATALOG_PAGE_SIZE,
        offset: (state.page - 1) * CATALOG_PAGE_SIZE,
        sort: state.sort,
        ...(state.maxPriceRubles === null ? {} : { maxPriceKopeks: priceKopeks(state.maxPriceRubles) }),
        ...(state.minPriceRubles === null ? {} : { minPriceKopeks: priceKopeks(state.minPriceRubles) }),
        ...(state.query ? { query: state.query } : {}),
      });
      items = response.items;
      total = response.total;
    } catch (error) {
      errorMessage = error instanceof StorefrontApiError ? error.message : "Не удалось прочитать ответ каталога.";
    }
  }
  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  if (!errorMessage && total > 0 && state.page > totalPages) {
    redirect(catalogPageHref("/catalog", state, totalPages));
  }

  const emptyState: CatalogEmptyState | null = state.query.length === 1
    ? { body: "Введите минимум два символа названия или артикула.", heading: "Нужно ещё немного текста" }
    : state.query.length === 0 && !hasFilters
      ? {
          body: "Введите название или артикул либо выберите бренд, наличие и цену в фильтрах.",
          heading: "Найдите нужную деталь",
        }
      : !errorMessage && items.length === 0
        ? { body: "Проверьте артикул, снимите часть фильтров или попробуйте более короткий запрос.", heading: "Ничего не найдено" }
        : null;
  const selectedBrandNames = brands
    .filter((brand) => state.brands.includes(brand.slug))
    .map((brand) => brand.name);
  const ownAvailable = items
    .filter((item) => item.availableQuantity > 0)
    .map((item) => ({ brand: item.brand?.name ?? null, sku: item.sku }));

  return (
    <div className={styles.page}>
      <JsonLd value={breadcrumbJsonLd([{ name: "Главная", path: "/" }, { name: "Каталог", path: "/catalog" }])} />
      <header className={styles.pageTitle}>
        <h1>Каталог</h1>
        <p>Выберите раздел ниже или введите не менее двух символов названия либо артикула из 1С. Если детали нет на складе, привезём её под заказ.</p>
      </header>

      <div className={styles.catalogLayout}>
        <CatalogFilterRail basePath="/catalog" brands={brands} nodes={tree} state={state} />
        <div className={styles.catalogMain}>
          <CatalogSearchPanel
            action="/catalog"
            emptyState={emptyState}
            errorHeading={errorHeading}
            errorMessage={errorMessage}
            items={items}
            pageSize={CATALOG_PAGE_SIZE}
            state={state}
            total={total}
          />
          {isSearch && state.page === 1 && state.availability !== "in_stock" ? (
            <SupplierResults
              brandNames={selectedBrandNames}
              ownAvailable={ownAvailable}
              ownEmpty={!errorMessage && items.length === 0}
              query={state.query}
              {...(state.maxPriceRubles === null ? {} : { maxPriceKopeks: priceKopeks(state.maxPriceRubles) })}
              {...(state.minPriceRubles === null ? {} : { minPriceKopeks: priceKopeks(state.minPriceRubles) })}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
