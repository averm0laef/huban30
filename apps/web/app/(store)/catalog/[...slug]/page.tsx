import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";

import { Search20Regular } from "../../_components/home-icons";
import { JsonLd } from "../../_components/json-ld";
import buttons from "../../_components/store-button.module.css";
import { getCatalogBrands, getCategoryTree, searchCatalog, StorefrontApiError } from "../../_lib/catalog-api";
import { isValidVin } from "../../_lib/vin";
import type { CatalogItem } from "../../_lib/catalog-api";
import { buildCategoryBreadcrumb, categoryPath, resolveCategoryPath, resolveTaxonomyPath } from "../../_lib/catalog-tree";
import { catalogSearchHref } from "../../_lib/catalog-search-url";
import { breadcrumbJsonLd, pageMetadata } from "../../_lib/seo";
import { CatalogFilterRail } from "../catalog-filter-rail";
import { CatalogSubsectionTiles } from "../catalog-subsection-tiles";
import layoutStyles from "../catalog-layout.module.css";
import resultsStyles from "../catalog-results.module.css";
import { CatalogSearchPanel } from "../catalog-search-panel";
import { ExpertHelpQueryLink } from "../expert-help-query-link";
import type { CatalogEmptyState } from "../catalog-search-panel";
import {
  CATALOG_PAGE_SIZE,
  catalogPageHref,
  catalogProductCount,
  hasActiveCatalogFilters,
  missedSearchText,
  parseCatalogPageQuery,
  priceKopeks,
  sectionWithoutMatchesHref,
} from "../catalog-query";

interface CategoryPageProps {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tree = await getCategoryTree();
  const stocked = resolveCategoryPath(tree, slug);
  // A section of the shop's taxonomy with no products yet is a page with nothing in it, not a missing page.
  const location = stocked ?? resolveTaxonomyPath(slug);
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
  const metadata = pageMetadata({
    description: node.description
      ?? `Раздел «${node.name}» каталога автозапчастей АН-30: подкатегории и товары с актуальными ценами и наличием.`,
    path: categoryPath([...ancestors, node].map((entry) => entry.slug)),
    title: `${node.name} — каталог автозапчастей АН-30`,
  });
  // An empty section is for the customer who followed a link to it, not for a search engine.
  return stocked ? metadata : { ...metadata, robots: { follow: true, index: false } };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const tree = await getCategoryTree();
  const location = resolveCategoryPath(tree, slug) ?? resolveTaxonomyPath(slug);
  if (!location) notFound();
  const { ancestors, node } = location;
  // Only brands present in this section, with this section's counts.
  const brands = await getCatalogBrands(node.slug).catch(() => []);
  const path = categoryPath([...ancestors, node].map((entry) => entry.slug));
  const breadcrumbTrail = buildCategoryBreadcrumb(ancestors, node);

  const parameters = await searchParams;
  const state = parseCatalogPageQuery(parameters);
  // Carried from /podbor: the car the customer is choosing for.
  const vehicle = typeof parameters.vehicle === "string" ? parameters.vehicle.trim().slice(0, 120) || null : null;

  let items: CatalogItem[] = [];
  let total = 0;
  let matchMode: "all" | "any" = "all";
  let errorHeading = "Каталог не отвечает";
  let errorMessage: string | null = null;
  const isSearch = state.query.length >= 2;
  const isVin = isValidVin(state.query.trim());
  // A one-character query never matches the contract's two-character minimum
  // (see `searchCatalog`), so it gets the same short-query hint as `/catalog`
  // instead of a real request. An empty query is normal here — this page
  // browses the category (and every descendant), it does not require search
  // text the way the site-wide `/catalog` page does.
  if (!state.priceRangeValid) {
    errorHeading = "Проверьте диапазон цены";
    errorMessage = "Цена «от» не может быть больше цены «до».";
  } else if (!isVin && state.query.length !== 1) {
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
      matchMode = response.matchMode ?? "all";
    } catch (error) {
      errorMessage = error instanceof StorefrontApiError ? error.message : "Не удалось прочитать ответ каталога.";
    }
  }
  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  if (!errorMessage && total > 0 && state.page > totalPages) {
    redirect(catalogPageHref(path, state, totalPages));
  }
  // A search narrowed to this section found nothing in it. The customer asked for the section — a click in the
  // list beside the results — so it opens as it is and says what was not found. (It used to send the customer back
  // to the results of the whole catalogue; after a search with no results at all that was a loop with no way out.)
  // With a brand, a price or «в наличии» chosen the page stays: there the filters are what to take off.
  if (!errorMessage && !isVin && isSearch && total === 0 && !hasActiveCatalogFilters(state)) {
    redirect(sectionWithoutMatchesHref(path, state));
  }
  const missed = state.query ? "" : missedSearchText(parameters);

  const emptyState: CatalogEmptyState | null = state.query.length === 1
    ? { body: "Введите минимум два символа названия или артикула.", heading: "Нужно ещё немного текста" }
    : !errorMessage && items.length === 0
      ? isSearch || hasActiveCatalogFilters(state)
        ? {
            body: "Попробуйте другой артикул или снимите часть фильтров. Если деталь не находится, поможем с подбором.",
            heading: "По запросу в этом разделе ничего не найдено",
          }
        : {
            body: "Ищите по названию или артикулу либо уточните наличие у специалиста.",
            heading: `В разделе «${node.name}» пока нет товаров`,
          }
        : null;
  return (
    <div className={layoutStyles.page}>
      <JsonLd value={breadcrumbJsonLd(breadcrumbTrail)} />
      <nav className={layoutStyles.breadcrumbs} aria-label="Хлебные крошки">
        {breadcrumbTrail.map((entry, index) => (
          index === breadcrumbTrail.length - 1 ? (
            <span aria-current="page" key={entry.path}>{entry.name}</span>
          ) : (
            <Fragment key={entry.path}>
              <Link href={entry.path === "/" ? "/" : catalogPageHref(entry.path, state)}>{entry.name}</Link><span aria-hidden="true">›</span>
            </Fragment>
          )
        ))}
      </nav>
      <header className={layoutStyles.heading}>
        <h1>{node.name}</h1>
        {!errorMessage && !isVin && state.query.length !== 1 && <span>{catalogProductCount(total)}</span>}
        {node.description ? <p>{node.description}</p> : null}
      </header>

      {!state.query ? (
        <CatalogSubsectionTiles
          basePath={path}
          nodes={node.children}
          parentSlug={ancestors[0]?.slug ?? node.slug}
          query={catalogPageHref("", { ...state, page: 1 })}
        />
      ) : null}
      <div className={layoutStyles.layout}>
        <CatalogFilterRail activePath={[...ancestors, node].map((entry) => entry.slug)} basePath={path} brands={brands} found={total} state={state} tree={tree} />
        <div className={layoutStyles.main}>
          {missed ? (
            <p className={resultsStyles.looseMatchNote} role="status">
              По запросу «{missed}» в разделе «{node.name}» ничего не нашлось — показываем весь раздел.{" "}
              <Link href={catalogSearchHref(missed)}>Искать «{missed}» во всём каталоге</Link>
            </p>
          ) : null}
          {vehicle ? (
            <p className={resultsStyles.looseMatchNote} role="status">
              Подбираете для <strong>{vehicle}</strong>. Подтверждённой применимости к этой машине в каталоге пока нет —
              сверьте артикул с оригиналом или <ExpertHelpQueryLink query={`${node.name} для ${vehicle}`}>спросите специалиста</ExpertHelpQueryLink>, он подберёт по VIN.
            </p>
          ) : null}
          <CatalogSearchPanel
            action={path}
            brands={brands}
            emptyState={emptyState}
            errorHeading={errorHeading}
            errorMessage={errorMessage}
            items={items}
            pageSize={CATALOG_PAGE_SIZE}
            state={state}
            matchMode={matchMode}
            total={total}
            tree={tree}
          />
          {isSearch && !isVin && (
            <p>
              <Link className={`${buttons.button} ${buttons.quiet}`} href={catalogPageHref("/catalog", state)}>
                <Search20Regular aria-hidden="true" />
                Искать «{state.query}» во всём каталоге
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
