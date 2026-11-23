import { CATALOG_VEHICLE_KIND_LABELS } from "@an30/contracts";
import Link from "next/link";

import type { CatalogVehicleKindCount } from "../_lib/catalog-api";
import layoutStyles from "./catalog-layout.module.css";
import { catalogPageHref, type CatalogPageQuery } from "./catalog-query";

const countFormat = new Intl.NumberFormat("ru-RU");

/**
 * «Вся техника · Легковые · Грузовые · Тракторы и спецтехника» above a list: the owner's 1С top groups as one
 * row of links. Each narrows the list the customer is in (the whole catalogue, a section, a search) and keeps
 * its other choices; a kind with no products here is not offered.
 */
export function CatalogVehicleKindTabs({ basePath, kinds, state }: {
  basePath: string;
  kinds: CatalogVehicleKindCount[];
  state: CatalogPageQuery;
}) {
  if (kinds.length === 0 && state.vehicleKind === null) return null;
  return (
    <nav aria-label="Техника" className={layoutStyles.kindTabs}>
      <Link aria-current={state.vehicleKind === null ? "true" : undefined} href={catalogPageHref(basePath, { ...state, vehicleKind: null })}>
        Вся техника
      </Link>
      {kinds.map(({ kind, productCount }) => (
        <Link aria-current={state.vehicleKind === kind ? "true" : undefined} href={catalogPageHref(basePath, { ...state, vehicleKind: kind })} key={kind}>
          {CATALOG_VEHICLE_KIND_LABELS[kind]}
          {/* The count is of the whole section, not of the search text: with a search it would promise too much. */}
          {state.query ? null : <small>{countFormat.format(productCount)}</small>}
        </Link>
      ))}
    </nav>
  );
}
