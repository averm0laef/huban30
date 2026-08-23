import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";

import styles from "../../_components/storefront.module.css";
import { JsonLd } from "../../_components/json-ld";
import { getCatalogBrands, getCategoryTree, searchCatalog, StorefrontApiError } from "../../_lib/catalog-api";
import type { CatalogItem } from "../../_lib/catalog-api";
import { buildCategoryBreadcrumb, categoryPath, resolveCategoryPath } from "../../_lib/catalog-tree";
import { breadcrumbJsonLd, pageMetadata } from "../../_lib/seo";
import { CatalogFilterRail } from "../catalog-filter-rail";
import { CatalogSearchPanel } from "../catalog-search-panel";
import type { CatalogEmptyState } from "../catalog-search-panel";
import {
  CATALOG_PAGE_SIZE,
  catalogPageHref,
  parseCatalogPageQuery,
  priceKopeks,
} from "../catalog-query";
import { SupplierResults } from "../supplier-results";

interface CategoryPageProps {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tree = await getCategoryTree();
  const location = resolveCategoryPath(tree, slug);
  // Where notFound() is called (here vs. the component below) does not
  // decide the status code — a Suspense boundary anywhere above this segment
  // does. Next flushes the HTML shell up to the nearest ancestor loading.tsx
  // as soon as that boundary is ready, committing a 200 before an inner
  // notFound() can run; the not-found UI then streams in over that already-
  // sent 200 ("soft 404"). `catalog/loading.tsx` used to live one directory
  // up and wrapped this route too. It now lives in `catalog/(index)/`, a
  // route group that scopes it to the `/catalog` index only, so this segment
  // has no Suspense boundary above it and renders (and can notFound()) as a
  // single blocking response with the real status. Kept here as well as in
  // the component below purely as a defensive duplicate.
  if (!location) notFound();
  const { ancestors, node } = location;
  return pageMetadata({
    description: node.description
      ?? `Раздел «${node.name}» каталога автозапчастей АН-30: подкатегории и товары с ценами и остатками из 1С.`,
    path: categoryPath([...ancestors, node].map((entry) => entry.slug)),
    title: `${node.name} — каталог автозапчастей АН-30`,
  });
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const [tree, brands] = await Promise.all([
    getCategoryTree(),
    getCatalogBrands().catch(() => []),
  ]);
  const location = resolveCategoryPath(tree, slug);
  if (!location) notFound();
  const { ancestors, node } = location;
  const path = categoryPath([...ancestors, node].map((entry) => entry.slug));
  const breadcrumbTrail = buildCategoryBreadcrumb(ancestors, node);

  const parameters = await searchParams;
  const state = parseCatalogPageQuery(parameters);

  let items: CatalogItem[] = [];
  let total = 0;
  let errorHeading = "Каталог не отвечает";
  let errorMessage: string | null = null;
  const isSearch = state.query.length >= 2;
  // A one-character query never matches the contract's two-character minimum
  // (see `searchCatalog`), so it gets the same short-query hint as `/catalog`
  // instead of a real request. An empty query is normal here — this page
  // browses the category (and every descendant), it does not require search
  // text the way the site-wide `/catalog` page does.
  if (!state.priceRangeValid) {
    errorHeading = "Проверьте диапазон цены";
    errorMessage = "Цена «от» не может быть больше цены «до».";
  } else if (state.query.length !== 1) {
    try {
      const response = await searchCatalog({
        availability: state.availability,
        brands: state.brands,
        category: node.slug,
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
    redirect(catalogPageHref(path, state, totalPages));
  }

  const emptyState: CatalogEmptyState | null = state.query.length === 1
    ? { body: "Введите минимум два символа названия или артикула.", heading: "Нужно ещё немного текста" }
    : !errorMessage && items.length === 0
      ? {
          body: "Ассортимент наполняется из 1С. Уточните наличие и цену по телефону, пока раздел пуст.",
          heading: `В разделе «${node.name}» пока нет товаров`,
        }
        : null;
  const selectedBrandNames = brands
    .filter((brand) => state.brands.includes(brand.slug))
    .map((brand) => brand.name);
  const ownAvailable = items
    .filter((item) => item.availableQuantity > 0)
    .map((item) => ({ brand: item.brand?.name ?? null, sku: item.sku }));

  return (
    <div className={styles.page}>
      <JsonLd value={breadcrumbJsonLd(breadcrumbTrail)} />
      <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
        {breadcrumbTrail.map((entry, index) => (
          index === breadcrumbTrail.length - 1 ? (
            <span aria-current="page" key={entry.path}>{entry.name}</span>
          ) : (
            <Fragment key={entry.path}>
              <Link href={entry.path}>{entry.name}</Link><span aria-hidden="true">/</span>
            </Fragment>
          )
        ))}
      </nav>
      <header className={styles.pageTitle}>
        <h1>{node.name}</h1>
        {node.description ? <p>{node.description}</p> : null}
      </header>

      <div className={styles.catalogLayout}>
        <CatalogFilterRail basePath={path} brands={brands} nodes={node.children} state={state} />
        <div className={styles.catalogMain}>
          <CatalogSearchPanel
            action={path}
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
