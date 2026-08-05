import type { CatalogCategoryNode } from "../_lib/catalog-api";
import styles from "../_components/storefront.module.css";
import { CATALOG_SEARCH_FORM_ID } from "./catalog-search-panel";
import type { CatalogAvailability } from "./catalog-search-panel";
import { CategoryChipGrid } from "./category-chip-grid";

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
 * availability filter. The availability `<select>` lives outside
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
export function CatalogFilterRail({ availability, basePath, nodes }: {
  availability: CatalogAvailability;
  basePath: string;
  nodes: CatalogCategoryNode[];
}) {
  const activeFilterCount = availability === "all" ? 0 : 1;

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
            <select defaultValue={availability} form={CATALOG_SEARCH_FORM_ID} id="catalog-availability" name="availability">
              <option value="all">Все товары</option>
              <option value="in_stock">В наличии</option>
              <option value="out_of_stock">Нет в наличии</option>
            </select>
          </div>
        </div>
      </details>
    </aside>
  );
}
