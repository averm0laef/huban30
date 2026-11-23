"use client";

import { Filter20Regular, TextSortAscending20Regular } from "@fluentui/react-icons";

import { CATALOG_PAGE_SIZES } from "@an30/contracts";

import type { CatalogSort } from "./catalog-query";
import styles from "./catalog-layout.module.css";

export { Checkmark20Regular, Grid20Regular, TextBulletList20Regular } from "@fluentui/react-icons";

export const CATALOG_FILTER_DIALOG_ID = "catalog-filter-sheet";
export const CATALOG_FILTER_TRIGGER_ID = "catalog-open-filters";

export function CatalogFilterTrigger({ count }: { count: number }) {
  return (
    <button aria-controls={CATALOG_FILTER_DIALOG_ID} aria-haspopup="dialog" className={styles.mobileFilter}
      id={CATALOG_FILTER_TRIGGER_ID}
      onClick={() => {
        const sheet = document.getElementById(CATALOG_FILTER_DIALOG_ID);
        if (sheet instanceof HTMLDialogElement && !sheet.open) sheet.showModal();
      }}
      type="button"
    >
      <Filter20Regular aria-hidden="true" />
      <span>Фильтры</span>
      {count > 0 && <span aria-label={`Активных фильтров: ${count}`} className={styles.filterCount}>{count}</span>}
    </button>
  );
}

export function CatalogSortSelect({ value }: { value: CatalogSort }) {
  return (
    <label className={styles.sortSelect}>
      <TextSortAscending20Regular aria-hidden="true" className={styles.sortIcon} />
      <select aria-label="Сортировка" defaultValue={value} key={value} name="sort"
        onChange={event => event.currentTarget.form?.requestSubmit()}
      >
        <option value="relevance">По совпадению</option>
        <option value="popular">По популярности</option>
        <option value="name">По названию</option>
        <option value="price_asc">Сначала дешевле</option>
        <option value="price_desc">Сначала дороже</option>
      </select>
    </label>
  );
}

/** How many products a page holds. Changing it submits the catalogue form, which opens the list from its first page. */
export function CatalogPageSizeSelect({ value }: { value: number }) {
  return (
    <label className={styles.pageSizeSelect}>
      <span>Показывать по</span>
      <select aria-label="Товаров на странице" defaultValue={value} key={value} name="perPage"
        onChange={event => event.currentTarget.form?.requestSubmit()}
      >
        {CATALOG_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
  );
}
