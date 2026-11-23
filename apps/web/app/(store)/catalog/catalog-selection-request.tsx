import { CATALOG_VEHICLE_KIND_LABELS, type CatalogVehicleKind } from "@an30/contracts";

import { PersonSupport20Regular } from "../_components/home-icons";
import buttons from "../_components/store-button.module.css";
import resultsStyles from "./catalog-results.module.css";
import { ExpertHelpQueryLink } from "./expert-help-query-link";

/** What the customer was looking at when they asked: the specialist's form opens with it already written. */
export function selectionRequestMessage({ query, sectionName, vehicleKind }: {
  query: string;
  sectionName?: string | undefined;
  vehicleKind: CatalogVehicleKind | null;
}): string {
  const text = query.trim().slice(0, 120);
  return [
    "Заявка на подбор.",
    text.length >= 2 ? `Искал: «${text}».` : null,
    sectionName ? `Раздел: ${sectionName}.` : null,
    vehicleKind ? `Техника: ${CATALOG_VEHICLE_KIND_LABELS[vehicleKind].toLowerCase()}.` : null,
    "Автомобиль или VIN: ",
  ].filter(Boolean).join(" ");
}

/**
 * «Заявка на подбор»: stands above every list of the catalogue and inside «ничего не найдено». It opens the
 * shop's own request form (/expert-help) with the search text, the section and the kind of vehicle filled in.
 */
export function CatalogSelectionRequest({ empty = false, query, sectionName, vehicleKind }: {
  /** Inside an empty result: only the button — the heading above it already says nothing was found. */
  empty?: boolean;
  query: string;
  sectionName?: string | undefined;
  vehicleKind: CatalogVehicleKind | null;
}) {
  const link = (
    <ExpertHelpQueryLink
      className={`${buttons.button} ${empty ? buttons.primary : buttons.soft}`}
      prefillMessage={selectionRequestMessage({ query, sectionName, vehicleKind })}
    >
      <PersonSupport20Regular aria-hidden="true" />
      Заявка на подбор
    </ExpertHelpQueryLink>
  );
  if (empty) return link;
  return (
    <aside aria-label="Заявка на подбор" className={resultsStyles.selectionRequest}>
      <p><strong>Не нашли нужную деталь?</strong> Оставьте заявку — специалист подберёт по VIN, артикулу или описанию.</p>
      {link}
    </aside>
  );
}
