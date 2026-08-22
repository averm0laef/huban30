import Link from "next/link";

import type { CatalogBrand, CatalogCategoryNode } from "../_lib/catalog-api";
import styles from "../_components/storefront.module.css";
import { CATALOG_SEARCH_FORM_ID } from "./catalog-search-panel";
import {
  clearCatalogFiltersHref,
  hasActiveCatalogFilters,
  type CatalogPageQuery,
} from "./catalog-query";
import { CategoryChipGrid } from "./category-chip-grid";
import filterStyles from "./catalog-filters.module.css";

function ChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Left filter rail shared by `/catalog` and every `/catalog/[...slug]`
 * level: the category chips (reusing `CategoryChipGrid` as-is) plus the
 * real brand, availability and price filters. Their controls live outside
 * `CatalogSearchPanel`'s own `<form>` — it is associated with that form via
 * the HTML `form` attribute (`CATALOG_SEARCH_FORM_ID`) instead, which is
 * what lets this rail sit in its own DOM branch while still submitting as
 * one GET request with `q` and `sort`, no JavaScript required.
 *
 * `<details>` gives the mobile "collapses into a control above the results"
 * behaviour for free and with no JS: closed by default on a phone, forced
 * open again at desktop width by the `filterRailBody` override in
 * storefront.module.css.
 */
export function CatalogFilterRail({ basePath, brands, nodes, state }: {
  basePath: string;
  brands: CatalogBrand[];
  nodes: CatalogCategoryNode[];
  state: CatalogPageQuery;
}) {
  const activeFilterCount = (state.availability === "all" ? 0 : 1)
    + state.brands.length
    + (state.minPriceRubles === null && state.maxPriceRubles === null ? 0 : 1);
  const selectedBrands = new Set(state.brands);
  const populatedBrands = brands
    .filter((brand) => brand.productCount > 0)
    .sort((left, right) => {
      const selected = Number(selectedBrands.has(right.slug)) - Number(selectedBrands.has(left.slug));
      return selected || right.productCount - left.productCount || left.name.localeCompare(right.name, "ru");
    });
  const primaryBrands = populatedBrands.slice(0, 10);
  const remainingBrands = populatedBrands.slice(10);

  const brandOption = (brand: CatalogBrand) => (
    <label className={filterStyles.brandOption} key={brand.id}>
      <input
        defaultChecked={selectedBrands.has(brand.slug)}
        form={CATALOG_SEARCH_FORM_ID}
        name="brand"
        type="checkbox"
        value={brand.slug}
      />
      <span>{brand.name}</span>
      <small>{brand.productCount}</small>
    </label>
  );

  return (
    <aside aria-label="Фильтры каталога" className={styles.filterRail}>
      <details className={styles.filterRailPanel}>
        <summary className={styles.filterRailSummary}>
          <span>Фильтры{activeFilterCount > 0 ? <span className={styles.filterRailBadge}>{activeFilterCount}</span> : null}</span>
          <ChevronIcon />
        </summary>
        <div className={styles.filterRailBody}>
          {nodes.length > 0 ? (
            <div>
              <p className={styles.eyebrow}>Разделы</p>
              <CategoryChipGrid basePath={basePath} nodes={nodes} />
            </div>
          ) : null}
          <div className={styles.field}>
            <label htmlFor="catalog-availability">Наличие</label>
            <select defaultValue={state.availability} form={CATALOG_SEARCH_FORM_ID} id="catalog-availability" name="availability">
              <option value="all">Все товары</option>
              <option value="in_stock">В наличии</option>
              <option value="out_of_stock">Нет в наличии</option>
            </select>
          </div>

          {populatedBrands.length > 0 ? (
            <fieldset className={filterStyles.filterGroup}>
              <legend>Бренд</legend>
              <div className={filterStyles.brandOptions}>{primaryBrands.map(brandOption)}</div>
              {remainingBrands.length > 0 ? (
                <details className={filterStyles.moreBrands}>
                  <summary>Ещё {remainingBrands.length}</summary>
                  <div className={filterStyles.brandOptions}>{remainingBrands.map(brandOption)}</div>
                </details>
              ) : null}
            </fieldset>
          ) : null}

          <fieldset className={filterStyles.filterGroup}>
            <legend>Цена, ₽</legend>
            <div className={filterStyles.priceRange}>
              <label>
                <span>От</span>
                <input
                  defaultValue={state.minPriceRubles ?? ""}
                  form={CATALOG_SEARCH_FORM_ID}
                  inputMode="numeric"
                  min="0"
                  name="minPrice"
                  placeholder="0"
                  step="1"
                  type="number"
                />
              </label>
              <label>
                <span>До</span>
                <input
                  defaultValue={state.maxPriceRubles ?? ""}
                  form={CATALOG_SEARCH_FORM_ID}
                  inputMode="numeric"
                  min="0"
                  name="maxPrice"
                  placeholder="Без лимита"
                  step="1"
                  type="number"
                />
              </label>
            </div>
          </fieldset>

          <div className={filterStyles.filterActions}>
            <button className={styles.submitButton} form={CATALOG_SEARCH_FORM_ID} type="submit">Применить</button>
            {hasActiveCatalogFilters(state) ? (
              <Link href={clearCatalogFiltersHref(basePath, state)}>Сбросить фильтры</Link>
            ) : null}
          </div>
        </div>
      </details>
    </aside>
  );
}
