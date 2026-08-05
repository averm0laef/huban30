import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import styles from "../../_components/storefront.module.css";
import { JsonLd } from "../../_components/json-ld";
import { getCategoryTree, searchCatalog, StorefrontApiError } from "../../_lib/catalog-api";
import type { CatalogItem } from "../../_lib/catalog-api";
import { buildCategoryBreadcrumb, categoryPath, resolveCategoryPath } from "../../_lib/catalog-tree";
import { breadcrumbJsonLd, pageMetadata } from "../../_lib/seo";
import { CategoryChipGrid } from "../category-chip-grid";
import { CatalogSearchPanel } from "../catalog-search-panel";
import type { CatalogAvailability, CatalogEmptyState, CatalogSort } from "../catalog-search-panel";

interface CategoryPageProps {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tree = await getCategoryTree();
  const location = resolveCategoryPath(tree, slug);
  // The unknown-category check has to happen here, not only in the component
  // below. `catalog/loading.tsx` opens a Suspense boundary, so by the time the
  // component runs the shell has already been flushed with a 200 and the
  // status can no longer change — an unknown category would answer 200 with
  // "not found" text, which is a soft 404 that search engines index.
  // `generateMetadata` runs before the stream opens, so notFound() here yields
  // a real 404.
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
  const tree = await getCategoryTree();
  const location = resolveCategoryPath(tree, slug);
  if (!location) notFound();
  const { ancestors, node } = location;
  const path = categoryPath([...ancestors, node].map((entry) => entry.slug));
  const breadcrumbTrail = buildCategoryBreadcrumb(ancestors, node);

  const parameters = await searchParams;
  const query = first(parameters.q).trim().slice(0, 120);
  const availabilityValue = first(parameters.availability);
  const sortValue = first(parameters.sort);
  const availability: CatalogAvailability = availabilityValue === "in_stock" || availabilityValue === "out_of_stock" ? availabilityValue : "all";
  const sort: CatalogSort = sortValue === "name" || sortValue === "price_asc" || sortValue === "price_desc" ? sortValue : "relevance";

  let items: CatalogItem[] = [];
  let errorMessage: string | null = null;
  // A one-character query never matches the contract's two-character minimum
  // (see `searchCatalog`), so it gets the same short-query hint as `/catalog`
  // instead of a real request. An empty query is normal here — this page
  // browses the category (and every descendant), it does not require search
  // text the way the site-wide `/catalog` page does.
  if (query.length !== 1) {
    try {
      const response = await searchCatalog(query, 48, availability, sort, node.slug);
      items = response.items;
    } catch (error) {
      errorMessage = error instanceof StorefrontApiError ? error.message : "Не удалось прочитать ответ каталога.";
    }
  }

  const emptyState: CatalogEmptyState | null = query.length === 1
    ? { body: "Введите минимум два символа названия или артикула.", heading: "Нужно ещё немного текста" }
    : !errorMessage && items.length === 0
      ? {
          body: "Ассортимент наполняется из 1С. Уточните наличие и цену по телефону, пока раздел пуст.",
          heading: `В разделе «${node.name}» пока нет товаров`,
        }
      : null;

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

      <CategoryChipGrid basePath={path} nodes={node.children} />

      <CatalogSearchPanel
        action={path}
        availability={availability}
        emptyState={emptyState}
        errorMessage={errorMessage}
        items={items}
        query={query}
        sort={sort}
      />
    </div>
  );
}
