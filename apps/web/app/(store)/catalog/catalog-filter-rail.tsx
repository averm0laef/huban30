"use client";

import { ChevronDown16Regular, ChevronRight20Regular, Dismiss20Regular, VehicleCar24Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { CATALOG_VEHICLE_KIND_LABELS, CATALOG_VEHICLE_KINDS } from "@an30/contracts";

import type { CatalogBrand, CatalogCategoryNode, CatalogVehicleKindCount } from "../_lib/catalog-api";
import styles from "../_components/storefront.module.css";
import { PICKED_VEHICLE_EVENT, readPickedVehicle, readSavedVehicle } from "../_lib/parts-finder";
import { BrandFacet } from "./brand-facet";
import { sortBrandsForFacet } from "./catalog-filter-logic";
import { CATALOG_SEARCH_FORM_ID } from "./catalog-search-form";
import { CATALOG_FILTER_DIALOG_ID, CATALOG_FILTER_TRIGGER_ID } from "./catalog-toolbar-controls";
import {
  catalogPageHref,
  clearCatalogFiltersHref,
  hasActiveCatalogFilters,
  sectionLinkState,
  type CatalogAvailability,
  type CatalogPageQuery,
} from "./catalog-query";
import { CategoryTree } from "./category-tree";
import filterStyles from "./catalog-filters.module.css";

/**
 * The only availability signal the system can actually answer today: the
 * shop's own 1C stock is either there (`available_quantity > 0`) or it
 * isn't — see the `availability` filter in `CatalogProductsQuerySchema` and
 * its SQL in `catalog-public.service.ts`. Rossko's richer «Срок доставки»
 * (Сегодня / Завтра / До 3 дней / До 7 дней) reads off TecDoc-fed supplier
 * lead times this shop does not have wired into the product search — the
 * supplier's own `deliveryTime` only ever appears on the separate
 * under-order results (`supplier-results.tsx`), which is not a filterable,
 * paginated list. Inventing extra buckets here would filter against data
 * that does not exist. "Под заказ" matches the wording already used
 * site-wide for a zero-quantity row (`stock-indicator.ts`), rather than the
 * flatter "Нет в наличии" this select used to say.
 */
const AVAILABILITY_OPTIONS: Array<{ label: string; value: CatalogAvailability }> = [
  { label: "Все товары", value: "all" },
  { label: "В наличии", value: "in_stock" },
  { label: "Под заказ", value: "out_of_stock" },
];

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return <details className={filterStyles.railGroup} open>
    <summary>{title}<ChevronDown16Regular aria-hidden="true" /></summary>
    <div className={filterStyles.groupBody}>{children}</div>
  </details>;
}

const pricePresetFormat = new Intl.NumberFormat("ru-RU");
const kindCountFormat = new Intl.NumberFormat("ru-RU");

/** Controls submit with the same GET form on desktop and in the mobile dialog. */
export function CatalogFilterRail({ activePath = [], basePath, brands, state, tree, vehicleKinds = [] }: {
  /** Slug chain of the category being viewed; empty on `/catalog`. */
  activePath?: readonly string[];
  basePath: string;
  brands: CatalogBrand[];
  state: CatalogPageQuery;
  /** The whole category tree — the rail shows it with the current branch open. */
  tree: CatalogCategoryNode[];
  /** Kinds of vehicle that have products in this list's scope, with their counts; none — the group is not shown. */
  vehicleKinds?: CatalogVehicleKindCount[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mobile, setMobile] = useState(false);
  const [draft, setDraft] = useState(0);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1101px)");
    const sync = () => {
      if (desktop.matches && dialogRef.current?.open) dialogRef.current.close();
      setMobile(!desktop.matches);
    };
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);

  const populatedBrands = sortBrandsForFacet(brands, state.brands);
  const kindCounts = new Map(vehicleKinds.map((entry) => [entry.kind, entry.productCount]));
  // The chosen kind stays in the list even when the counts did not arrive, so it can be seen and taken off.
  const kindOptions = CATALOG_VEHICLE_KINDS.filter((kind) => kindCounts.has(kind) || kind === state.vehicleKind);
  const formKey = JSON.stringify([state.vehicleKind, state.availability, state.brands, state.minPriceRubles, state.maxPriceRubles, draft]);

  const car = useChosenCar();

  const body = (
    <div className={filterStyles.railBody} key={formKey}>
      <Link className={filterStyles.vehicle} href="/podbor">
        <VehicleCar24Regular aria-hidden="true" />
        {car ? (
          <span><small>Ваш автомобиль</small><strong>{car.name}</strong>{car.details ? <small>{car.details}</small> : null}</span>
        ) : (
          <span><small>Подбор по автомобилю</small><strong>Подобрать по марке или VIN</strong></span>
        )}
        <ChevronRight20Regular aria-hidden="true" />
      </Link>
      <FilterGroup title="Категория">
          <Link className={filterStyles.allCategories} href={catalogPageHref("/catalog", { ...state, page: 1 })} onClick={() => dialogRef.current?.close()}
            aria-current={basePath === "/catalog" ? "page" : undefined}>Все категории</Link>
          <CategoryTree activePath={activePath} onNavigate={() => dialogRef.current?.close()} state={sectionLinkState(state)} tree={tree} />
      </FilterGroup>

      {kindOptions.length > 0 && <FilterGroup title="Техника">
        <fieldset className={filterStyles.filterGroup}>
          <legend className={styles.visuallyHidden}>Техника</legend>
          <div className={filterStyles.brandOptions}>
            <label className={filterStyles.optionRow}>
              <input defaultChecked={state.vehicleKind === null} form={CATALOG_SEARCH_FORM_ID} name="kind" type="radio" value="all" />
              <span>Вся техника</span>
            </label>
            {kindOptions.map((kind) => (
              <label className={filterStyles.optionRow} key={kind}>
                <input defaultChecked={state.vehicleKind === kind} form={CATALOG_SEARCH_FORM_ID} name="kind" type="radio" value={kind} />
                <span>{CATALOG_VEHICLE_KIND_LABELS[kind]}</span>
                {kindCounts.has(kind) ? <small>{kindCountFormat.format(kindCounts.get(kind)!)}</small> : null}
              </label>
            ))}
          </div>
          {/* The 1С groups or the make in the name say it; it is not a fitment check of a particular car. */}
          <p className={filterStyles.groupNote}>По группам 1С и марке в названии. Применимость к вашей машине уточнит специалист.</p>
        </fieldset>
      </FilterGroup>}

      <FilterGroup title="Цена, ₽">
      <fieldset className={filterStyles.filterGroup}>
        <legend className={styles.visuallyHidden}>Цена, ₽</legend>
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
        <div className={filterStyles.pricePresets}>
          {[1_000, 3_000, 10_000].map(price => (
            <Link aria-current={price === state.maxPriceRubles && state.minPriceRubles === null ? "true" : undefined}
              onClick={() => dialogRef.current?.close()}
              href={catalogPageHref(basePath, { ...state, minPriceRubles: null, maxPriceRubles: price })} key={price}>
              до {pricePresetFormat.format(price)} ₽
            </Link>
          ))}
        </div>
      </fieldset>
      </FilterGroup>

      {(populatedBrands.length > 0 || state.brands.length > 0) && <FilterGroup title="Бренд">
        <BrandFacet brands={populatedBrands} formId={CATALOG_SEARCH_FORM_ID} selectedSlugs={state.brands} />
      </FilterGroup>}

      <FilterGroup title="Наличие">
        <fieldset className={filterStyles.filterGroup}>
          <legend className={styles.visuallyHidden}>Наличие</legend>
          <div className={filterStyles.brandOptions}>
            {AVAILABILITY_OPTIONS.map((option) => (
              <label className={filterStyles.optionRow} key={option.value}>
                <input defaultChecked={state.availability === option.value} form={CATALOG_SEARCH_FORM_ID}
                  name="availability" type="radio" value={option.value} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </FilterGroup>

      <div className={filterStyles.filterActions}>
        <button className={styles.submitButton} form={CATALOG_SEARCH_FORM_ID} type="submit">Применить</button>
        {hasActiveCatalogFilters(state) ? (
          <Link href={clearCatalogFiltersHref(basePath, state)} onClick={() => dialogRef.current?.close()}>Сбросить фильтры</Link>
        ) : null}
      </div>
    </div>
  );
  return (
    <aside aria-label="Фильтры каталога" className={filterStyles.railAside}>
      {mobile ? (
          <dialog
            className={filterStyles.mobileDialog}
            id={CATALOG_FILTER_DIALOG_ID}
            ref={dialogRef}
            aria-label="Фильтры"
            onClose={() => {
              setDraft(value => value + 1);
              document.getElementById(CATALOG_FILTER_TRIGGER_ID)?.focus();
            }}
            onClick={event => {
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
                event.currentTarget.close();
              }
            }}
          >
            <header className={filterStyles.dialogHeader}>
              <strong>Фильтры</strong>
              <button type="button" autoFocus aria-label="Закрыть фильтры" onClick={() => dialogRef.current?.close()}><Dismiss20Regular aria-hidden="true" /></button>
            </header>
            <div className={filterStyles.dialogScroll} onClick={event => {
              if (event.target instanceof Element && event.target.closest("a")) dialogRef.current?.close();
            }}>{body}</div>
          </dialog>
      ) : (
        <div className={filterStyles.desktopRail}>{body}</div>
      )}
    </aside>
  );
}

/** The car chosen on /podbor, so the catalog always says what the customer is shopping for. */
function useChosenCar(): { details: string | null; name: string } | null {
  const [car, setCar] = useState<{ details: string | null; name: string } | null>(null);
  useEffect(() => {
    const read = () => {
      const picked = readPickedVehicle();
      const label = picked?.label ?? readSavedVehicle();
      if (!label) return setCar(null);
      setCar({
        details: [picked?.generation, picked?.engine].filter(Boolean).join(" · ") || null,
        name: picked?.make && picked.model ? `${picked.make} ${picked.model}` : label,
      });
    };
    read();
    window.addEventListener(PICKED_VEHICLE_EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(PICKED_VEHICLE_EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  return car;
}
