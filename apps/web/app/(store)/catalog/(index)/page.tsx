import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JsonLd } from "../../_components/json-ld";
import { getCatalogBrands, getCatalogVehicleKinds, getCategoryTree, searchCatalog, StorefrontApiError } from "../../_lib/catalog-api";
import { directSearchProduct } from "../../_lib/search-guidance";
import { categoryHrefBySlug, exactCategoryMatch, flattenCategoryTree } from "../../_lib/search-assist";
import { isValidVin } from "../../_lib/vin";
import type { CatalogItem } from "../../_lib/catalog-api";
import { breadcrumbJsonLd, pageMetadata } from "../../_lib/seo";
import { catalogSectionTiles } from "../../_lib/store-categories";
import { CatalogFilterRail } from "../catalog-filter-rail";
import { CatalogCategoryTiles } from "../catalog-category-tiles";
import layoutStyles from "../catalog-layout.module.css";
import resultsStyles from "../catalog-results.module.css";
import { CatalogSearchPanel } from "../catalog-search-panel";
import { CatalogVehicleKindTabs } from "../catalog-vehicle-kind-tabs";
import type { CatalogEmptyState } from "../catalog-search-panel";
import {
  catalogFailureText,
  catalogPageHref,
  catalogProductCount,
  hasActiveCatalogFilters,
  parseCatalogPageQuery,
  priceKopeks,
} from "../catalog-query";
import { SupplierResults } from "../supplier-results";

export const metadata: Metadata = pageMetadata({
  description: "Каталог автозапчастей АН-30: разделы каталога, поиск по названию и артикулу, актуальные цены и наличие в магазине.",
  path: "/catalog",
  title: "Каталог автозапчастей",
});

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const parameters = await searchParams;
  const state = parseCatalogPageQuery(parameters);

  const [tree, brands, vehicleKinds] = await Promise.all([
    getCategoryTree().catch(() => []),
    getCatalogBrands().catch(() => []),
    getCatalogVehicleKinds().catch(() => []),
  ]);

  // A query that simply names a section ("аккумулятор", "фильтры") opens
  // that section instead of a word search over product names.
  if (state.query.length >= 2 && !hasActiveCatalogFilters(state)) {
    const flat = flattenCategoryTree(tree);
    const section = exactCategoryMatch(flat, state.query);
    const href = section ? categoryHrefBySlug(flat, section.slug) : null;
    if (href) redirect(state.view === "list" ? `${href}?view=list` : href);
  }

  let items: CatalogItem[] = [];
  let total = 0;
  let matchMode: "all" | "any" = "all";
  let errorHeading = "Каталог не отвечает";
  let errorMessage: string | null = null;
  const isSearch = state.query.length >= 2;
  const isVin = isValidVin(state.query.trim());
  const hasFilters = hasActiveCatalogFilters(state);
  const shouldFetch = !isVin && state.query.length !== 1;
  if (!state.priceRangeValid) {
    errorHeading = "Проверьте диапазон цены";
    errorMessage = "Цена «от» не может быть больше цены «до».";
  } else if (shouldFetch) {
    try {
      const response = await searchCatalog({
        availability: state.availability,
        brands: state.brands,
        limit: state.pageSize,
        offset: (state.page - 1) * state.pageSize,
        sort: state.sort,
        vehicleKind: state.vehicleKind,
        ...(state.maxPriceRubles === null ? {} : { maxPriceKopeks: priceKopeks(state.maxPriceRubles) }),
        ...(state.minPriceRubles === null ? {} : { minPriceKopeks: priceKopeks(state.minPriceRubles) }),
        ...(state.query ? { query: state.query } : {}),
      });
      items = response.items;
      total = response.total;
      matchMode = response.matchMode ?? "all";
    } catch (error) {
      if (error instanceof StorefrontApiError) ({ heading: errorHeading, message: errorMessage } = catalogFailureText(error.status));
      else errorMessage = "Не удалось прочитать ответ каталога.";
    }
  }
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (parameters.direct === "1" && !hasFilters && matchMode === "all") {
    const exactSlug = directSearchProduct(state.query, items, total);
    if (exactSlug) redirect(`/catalog/product/${encodeURIComponent(exactSlug)}`);
  }
  if (!errorMessage && total > 0 && state.page > totalPages) {
    redirect(catalogPageHref("/catalog", state, totalPages));
  }

  const emptyState: CatalogEmptyState | null = state.query.length === 1
    ? { body: "Введите минимум два символа названия или артикула.", heading: "Нужно ещё немного текста" }
    : !errorMessage && !isVin && items.length === 0
      ? isSearch || hasFilters
        ? {
          body: "Проверьте написание или подберите деталь по автомобилю — покажем аналоги и позиции под заказ.",
          heading: "В каталоге пока нет совпадений",
        }
        : {
          body: "Поищите нужную деталь по названию или артикулу либо обратитесь в магазин.",
          heading: "В каталоге пока нет товаров",
        }
      : null;
  const selectedBrandNames = brands
    .filter((brand) => state.brands.includes(brand.slug))
    .map((brand) => brand.name);
  const ownAvailable = items
    .filter((item) => item.availableQuantity > 0)
    .map((item) => ({ brand: item.brand?.name ?? null, sku: item.sku }));

  return (
    <div className={layoutStyles.page}>
      <JsonLd value={breadcrumbJsonLd([{ name: "Главная", path: "/" }, { name: "Каталог", path: "/catalog" }])} />
      <nav aria-label="Хлебные крошки" className={layoutStyles.breadcrumbs}>
        <Link href="/">Главная</Link><span aria-hidden="true">›</span>
        {state.query
          ? <><Link href="/catalog">Каталог</Link><span aria-hidden="true">›</span><span aria-current="page">Поиск</span></>
          : <span aria-current="page">Каталог</span>}
      </nav>
      <header className={layoutStyles.heading}>
        <h1>{state.query ? `Результаты поиска «${state.query}»` : "Каталог товаров"}</h1>
        {!errorMessage && shouldFetch && <span>{catalogProductCount(total)}</span>}
      </header>

      {!state.query && <CatalogCategoryTiles tiles={catalogSectionTiles(tree)} />}
      <CatalogVehicleKindTabs basePath="/catalog" kinds={vehicleKinds} state={state} />
      <div className={layoutStyles.layout}>
        <CatalogFilterRail basePath="/catalog" brands={brands} state={state} tree={tree} vehicleKinds={vehicleKinds} />
        <div className={layoutStyles.main}>
          <CatalogSearchPanel
            action="/catalog"
            brands={brands}
            emptyState={emptyState}
            errorHeading={errorHeading}
            errorMessage={errorMessage}
            items={items}
            pageSize={state.pageSize}
            state={state}
            matchMode={matchMode}
            total={total}
            tree={tree}
          />
          {isSearch && !isVin && state.page === 1 && state.availability !== "in_stock" ? (
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
