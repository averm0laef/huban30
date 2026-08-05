import type { Metadata } from "next";

import styles from "../_components/storefront.module.css";
import { JsonLd } from "../_components/json-ld";
import { getCategoryTree, searchCatalog, StorefrontApiError } from "../_lib/catalog-api";
import type { CatalogItem } from "../_lib/catalog-api";
import { breadcrumbJsonLd, pageMetadata } from "../_lib/seo";
import { CatalogFilterRail } from "./catalog-filter-rail";
import { CatalogSearchPanel } from "./catalog-search-panel";
import type { CatalogAvailability, CatalogEmptyState, CatalogSort } from "./catalog-search-panel";
import { SupplierResults } from "./supplier-results";

export const metadata: Metadata = pageMetadata({
  description: "Каталог автозапчастей АН-30: разделы каталога, поиск по названию и артикулу, актуальные цены и остатки из 1С.",
  path: "/catalog",
  title: "Каталог автозапчастей",
});

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const parameters = await searchParams;
  const query = first(parameters.q).trim().slice(0, 120);
  const availabilityValue = first(parameters.availability);
  const sortValue = first(parameters.sort);
  const availability: CatalogAvailability = availabilityValue === "in_stock" || availabilityValue === "out_of_stock" ? availabilityValue : "all";
  const sort: CatalogSort = sortValue === "name" || sortValue === "price_asc" || sortValue === "price_desc" ? sortValue : "relevance";

  const tree = await getCategoryTree();

  let items: CatalogItem[] = [];
  let errorMessage: string | null = null;
  const isSearch = query.length >= 2;
  if (isSearch) {
    try {
      const response = await searchCatalog(query, 48, availability, sort);
      items = response.items;
    } catch (error) {
      errorMessage = error instanceof StorefrontApiError ? error.message : "Не удалось прочитать ответ каталога.";
    }
  }

  const emptyState: CatalogEmptyState | null = query.length === 1
    ? { body: "Введите минимум два символа названия или артикула.", heading: "Нужно ещё немного текста" }
    : query.length === 0
      ? {
          body: "Мы не показываем демонстрационные товары. Результаты поступят из подтверждённого каталога 1С.",
          heading: "Начните с поиска",
        }
      : !errorMessage && items.length === 0
        ? { body: "Проверьте артикул, уберите фильтр наличия или попробуйте более короткий запрос.", heading: "Ничего не найдено" }
        : null;

  return (
    <div className={styles.page}>
      <JsonLd value={breadcrumbJsonLd([{ name: "Главная", path: "/" }, { name: "Каталог", path: "/catalog" }])} />
      <header className={styles.pageTitle}>
        <h1>Каталог</h1>
        <p>Выберите раздел ниже или введите не менее двух символов названия либо артикула из 1С. Если детали нет на складе, поищем под заказ у поставщика.</p>
      </header>

      <div className={styles.catalogLayout}>
        <CatalogFilterRail availability={availability} basePath="/catalog" nodes={tree} />
        <div className={styles.catalogMain}>
          <CatalogSearchPanel
            action="/catalog"
            emptyState={emptyState}
            errorMessage={errorMessage}
            items={items}
            query={query}
            sort={sort}
          />
          {isSearch ? <SupplierResults ownEmpty={!errorMessage && items.length === 0} query={query} /> : null}
        </div>
      </div>
    </div>
  );
}
