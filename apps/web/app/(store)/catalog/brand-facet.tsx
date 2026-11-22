"use client";

import { useId, useState } from "react";

import type { CatalogBrand } from "../_lib/catalog-api";
import styles from "../_components/storefront.module.css";
import { filterBrandsByTerm } from "./catalog-filter-logic";
import filterStyles from "./catalog-filters.module.css";

const COLLAPSED_COUNT = 10;
const MAX_SELECTED = 20;

export function BrandFacet({ brands, formId, selectedSlugs }: {
  brands: CatalogBrand[];
  formId: string;
  selectedSlugs: string[];
}) {
  const [term, setTerm] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(() => new Set(selectedSlugs));
  const inputId = useId();
  const optionsId = useId();

  if (brands.length === 0 && selected.size === 0) return null;
  const searching = term.trim().length > 0;
  const matches = new Set(filterBrandsByTerm(brands, term).map(brand => brand.slug));
  const visibleBrands = searching
    ? brands.filter(brand => selected.has(brand.slug) || matches.has(brand.slug))
    : expanded ? brands : brands.filter((brand, index) => index < COLLAPSED_COUNT || selected.has(brand.slug));
  const omittedSelected = [...selected].filter(slug => !brands.some(brand => brand.slug === slug));

  function toggle(slug: string, checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      if (checked && next.size < MAX_SELECTED) next.add(slug);
      if (!checked) next.delete(slug);
      return next;
    });
  }

  return (
    <fieldset className={filterStyles.filterGroup}>
      <legend className={styles.visuallyHidden}>Бренд</legend>
      {brands.length > COLLAPSED_COUNT && (
        <div className={styles.field}>
          <label className={styles.visuallyHidden} htmlFor={inputId}>Поиск по бренду</label>
          <input autoComplete="off" id={inputId} onChange={event => setTerm(event.target.value)} placeholder="Найти бренд" type="search" value={term} />
        </div>
      )}
      {[...selected].map(slug => <input form={formId} key={slug} name="brand" type="hidden" value={slug} />)}
      <div id={optionsId} className={filterStyles.brandOptions}>
        {visibleBrands.map(brand => (
          <label className={filterStyles.optionRow} key={brand.id}>
            <input checked={selected.has(brand.slug)} disabled={!selected.has(brand.slug) && selected.size >= MAX_SELECTED}
              onChange={event => toggle(brand.slug, event.target.checked)} type="checkbox" />
            <span>{brand.name}</span>
            <small>{brand.productCount}</small>
          </label>
        ))}
        {omittedSelected.map(slug => (
          <label className={filterStyles.optionRow} key={slug}>
            <input checked onChange={() => toggle(slug, false)} type="checkbox" />
            <span>{slug}</span>
            <small>0</small>
          </label>
        ))}
      </div>
      {searching && matches.size === 0 && <p className={filterStyles.brandEmpty}>Бренд «{term.trim()}» не найден.</p>}
      {!searching && brands.length > COLLAPSED_COUNT && (
        <button aria-controls={optionsId} aria-expanded={expanded} className={filterStyles.moreBrandsButton}
          type="button" onClick={() => setExpanded(value => !value)}>
          {expanded ? "Свернуть список" : `Все бренды (${brands.length})`}
        </button>
      )}
      {selected.size >= MAX_SELECTED && <p className={filterStyles.brandEmpty}>Можно выбрать до {MAX_SELECTED} брендов.</p>}
    </fieldset>
  );
}
