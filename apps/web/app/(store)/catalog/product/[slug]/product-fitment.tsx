"use client";

import { CheckmarkCircle20Regular, Info20Regular, List20Regular, VehicleCar20Regular, Warning20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import buttons from "../../../_components/store-button.module.css";
import type { PickedVehicle } from "../../../_lib/parts-finder";
import { activeCar, onActiveCarChange, tecdocGet, vehicleCatalogSource, type FitmentVerdict, type ProductFitment as Fitment } from "../../../_lib/tecdoc";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import styles from "./product-fitment.module.css";

type Load = { status: "idle" | "loading" | "hidden" } | { status: "error" } | { data: Fitment; status: "ready" };

function carName(car: PickedVehicle): string {
  return car.make && car.model ? `${car.make} ${car.model}` : car.label;
}

const VERDICTS: Record<FitmentVerdict, { text: (car: string) => string; tone: "ok" | "warn" | "info" }> = {
  fits: { text: (car) => `Подходит вашему автомобилю: ${car}`, tone: "ok" },
  model: { text: (car) => `Подходит для ${car}. Сверьте двигатель: деталь может зависеть от модификации`, tone: "info" },
  not_listed: { text: (car) => `В каталоге применимости эта деталь не указана для ${car}`, tone: "warn" },
  other_engine: { text: (car) => `Для ${car} эта деталь указана с другим двигателем`, tone: "warn" },
};

/**
 * «Применимость»: whether the product fits the visitor's own car (picked on
 * the site or the main car of the garage) and which cars it fits at all.
 * With a car chosen the answer loads by itself; without one — on a click, so
 * that merely opening a product page spends nothing.
 */
export function ProductFitment({ productId, productName }: { productId: string; productName: string }) {
  const [enabled, setEnabled] = useState(false);
  const [car, setCar] = useState<PickedVehicle | null>(null);
  const [state, setState] = useState<Load>({ status: "idle" });

  useEffect(() => {
    let live = true;
    const read = () => { void activeCar().then((next) => { if (live) setCar(next); }); };
    void vehicleCatalogSource().then((source) => { if (live) setEnabled(source === "tecdoc"); });
    read();
    const stop = onActiveCarChange(read);
    return () => { live = false; stop(); };
  }, []);

  const msId = car?.tecdoc?.msId;
  const genId = car?.tecdoc?.genId;

  function load(withCar: boolean) {
    setState({ status: "loading" });
    tecdocGet<Fitment>(`product/${encodeURIComponent(productId)}/fitment`, withCar && msId ? { ms: msId, ...(genId ? { gen: genId } : {}) } : undefined)
      .then((data) => setState(data.status === "not_applicable" || data.status === "not_found" ? { status: "hidden" } : { data, status: "ready" }))
      .catch(() => setState({ status: "error" }));
  }

  // The visitor has a car: answer «подходит ли» without a click.
  useEffect(() => {
    if (enabled && msId) load(true);
    // `load` reads the same values this effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, msId, genId, productId]);

  if (!enabled || state.status === "hidden") return null;
  const name = car ? carName(car) : null;
  const verdict = state.status === "ready" && state.data.status === "ok" && name && state.data.verdict ? VERDICTS[state.data.verdict] : null;

  return (
    <section aria-labelledby="product-fitment-title" className={styles.fitment}>
      <div className={styles.head}>
        <h2 id="product-fitment-title">Применимость к автомобилям</h2>
        {name ? <Link className={styles.carLink} href="/podbor"><VehicleCar20Regular aria-hidden="true" />{name}</Link> : null}
      </div>

      {state.status === "idle" ? (
        <div className={styles.actions}>
          <button className={`${buttons.button} ${buttons.soft}`} onClick={() => load(false)} type="button">
            <List20Regular aria-hidden="true" /> Показать, к каким автомобилям подходит
          </button>
          {!name ? <Link className={`${buttons.button} ${buttons.quiet}`} href="/podbor"><VehicleCar20Regular aria-hidden="true" /> Выбрать свой автомобиль</Link> : null}
        </div>
      ) : null}
      {state.status === "loading" ? <p className={styles.muted} role="status">Проверяем применимость…</p> : null}
      {state.status === "error" ? (
        <p className={styles.muted} role="alert">Каталог применимости сейчас недоступен. Специалист проверит деталь по VIN — напишите нам.</p>
      ) : null}

      {state.status === "ready" && state.data.status === "unknown_part" ? (
        <div className={styles.verdict} data-tone="info">
          <Info20Regular aria-hidden="true" />
          <p>В каталоге применимости этой детали нет. Специалист проверит её по VIN вашего автомобиля.</p>
        </div>
      ) : null}

      {verdict && name ? (
        <div className={styles.verdict} data-tone={verdict.tone}>
          {verdict.tone === "ok" ? <CheckmarkCircle20Regular aria-hidden="true" /> : verdict.tone === "warn" ? <Warning20Regular aria-hidden="true" /> : <Info20Regular aria-hidden="true" />}
          <div>
            <p><strong>{verdict.text(name)}</strong></p>
            {car?.generation || car?.engine ? <p className={styles.muted}>{[car.generation, car.engine].filter(Boolean).join(" · ")}</p> : null}
            {verdict.tone !== "ok" ? (
              <ExpertHelpQueryLink className={styles.textLink} prefillMessage={`Подойдёт ли «${productName}» для ${car?.label ?? name}? Пришлю VIN.`}>
                Проверить у специалиста по VIN
              </ExpertHelpQueryLink>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.status === "ready" && state.data.status === "ok" ? (
        <>
          {state.data.makes.length > 0 ? (
            <div className={styles.makes}>
              {state.data.makes.map((make) => (
                <details className={styles.make} key={make.make} open={state.data.status === "ok" && state.data.makes.length === 1}>
                  <summary><span>{make.make}</span><small>{make.models.length}</small></summary>
                  <ul>
                    {make.models.map((model) => (
                      <li data-mine={model.msId !== null && model.msId === msId ? true : undefined} key={`${model.msId}-${model.model}`}>
                        {model.model}{model.generations ? <small> · {model.generations} мод.</small> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : <p className={styles.muted}>Каталог не называет автомобили для этой детали.</p>}
          {state.data.oems.length > 0 ? (
            <p className={styles.oems}><strong>Оригинальные номера:</strong> {state.data.oems.map((oem) => `${oem.brand} ${oem.number}`).join(", ")}</p>
          ) : null}
          <p className={styles.muted}>Данные каталога TecDoc. Перед покупкой сверьте деталь со старой или пришлите нам VIN.</p>
        </>
      ) : null}
    </section>
  );
}
