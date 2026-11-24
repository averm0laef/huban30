"use client";

import { ChevronRight16Regular, VehicleCar20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import buttons from "../_components/store-button.module.css";
import { readChosenCar, VEHICLE_CATALOG_ID_BASE } from "../_lib/parts-finder";
import { umapiStatus } from "../_lib/umapi";
import styles from "./catalog-results.module.css";

interface Generation { bodyCode: string | null; generation: string | null; id: number; series: string | null; yearFrom: number | null; yearTo: number | null }
interface Understood { family: string; label: string; make: { name: string; slug: string }; models: Generation[]; part: string }

function years(item: Generation): string {
  if (!item.yearFrom) return "";
  return item.yearTo ? `${item.yearFrom}–${item.yearTo}` : `с ${item.yearFrom}`;
}

function generationName(item: Generation, family: string): string {
  return [family, item.series, item.bodyCode].filter(Boolean).join(" ").trim() || item.generation || family;
}

/** The car the visitor already chose is this model: its catalogue opens without picking again. */
function sameModel(understood: Understood): string | null {
  const car = readChosenCar();
  if (!car?.make || !car.model || car.modificationId === undefined || car.modificationId < VEHICLE_CATALOG_ID_BASE) return null;
  const same = car.make.toLowerCase() === understood.make.name.toLowerCase() && car.model.toLowerCase() === understood.family.toLowerCase();
  return same ? car.label : null;
}

/**
 * «фильтр салона ауди а4» (Claude Design canvas «совместимость и аналоги», board «Поиск „деталь + машина“»): above the
 * usual results, one offer to open that part in the catalogue of that car. The car is read from our own vehicle
 * catalog — typing costs no paid call; the results below stay exactly what the search found.
 */
export function CatalogCarPartHint({ query }: { query: string }) {
  const [understood, setUnderstood] = useState<Understood | null>(null);
  const [mine, setMine] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setUnderstood(null);
    const text = query.trim();
    if (text.length < 5 || !/\s/u.test(text)) return undefined;
    void umapiStatus().then(async (status) => {
      if (!status.enabled || !live) return;
      const response = await fetch(`/api/v1/parts-finder/vehicles/understand?q=${encodeURIComponent(text.slice(0, 120))}`, { headers: { Accept: "application/json" } }).catch(() => null);
      const data = response?.ok ? await response.json().catch(() => null) as { vehicle?: Understood | null } | null : null;
      if (!live || !data?.vehicle) return;
      setUnderstood(data.vehicle);
      setMine(sameModel(data.vehicle));
    });
    return () => { live = false; };
  }, [query]);

  if (!understood) return null;
  const part = understood.part;
  const title = `${part[0]!.toUpperCase()}${part.slice(1)} для ${understood.label}`;
  const href = (model?: number) => `/podbor?${new URLSearchParams({
    part, ...(model === undefined && mine ? {} : { make: understood.make.slug }), ...(model ? { model: String(model) } : {}),
  }).toString()}`;
  return (
    <section aria-label="Подбор по машине" className={styles.carHint}>
      <div className={styles.carHintHead}>
        <VehicleCar20Regular aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p>{mine
            ? `Для вашей машины (${mine}) покажем, что подходит именно ей, — сначала то, что есть у нас.`
            : "Выберите поколение — покажем, что подходит именно вашей машине, и сначала то, что есть у нас."}</p>
        </div>
        {mine ? <Link className={`${buttons.button} ${buttons.primary}`} href={href()}>Показать для моей машины <ChevronRight16Regular aria-hidden="true" /></Link> : null}
      </div>
      <div className={styles.carHintChips}>
        {understood.models.map((item) => (
          <Link href={href(item.id)} key={item.id}>
            <strong>{generationName(item, understood.family)}</strong>
            {years(item) ? <small>{years(item)}</small> : null}
          </Link>
        ))}
        {understood.models.length === 0 ? <Link href={href()}><strong>Выбрать машину</strong></Link> : null}
      </div>
    </section>
  );
}
