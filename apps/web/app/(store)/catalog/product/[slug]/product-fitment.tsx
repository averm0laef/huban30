"use client";

import { CheckmarkCircle20Regular, Info20Regular, List20Regular, VehicleCar20Regular, Warning20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import buttons from "../../../_components/store-button.module.css";
import type { PickedVehicle } from "../../../_lib/parts-finder";
import { activeCar, onActiveCarChange, tecdocGet, vehicleCatalogSource, type FitmentVerdict, type ProductFitment as Fitment } from "../../../_lib/tecdoc";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import { fitmentButtons, fitmentFailure, fitmentQuery, keepFitment, keptFitment, type FitmentCar, type FitmentMode } from "./fitment-actions";
import styles from "./product-fitment.module.css";

type Load = { status: "idle" | "loading" | "hidden" | "expert" | "error" } | { data: Fitment; status: "ready" };

function carName(car: PickedVehicle): string {
  return car.make && car.model ? `${car.make} ${car.model}` : car.label;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const VERDICTS: Record<FitmentVerdict, { text: (car: string) => string; tone: "ok" | "warn" | "info" }> = {
  fits: { text: (car) => `Подходит вашему автомобилю: ${car}`, tone: "ok" },
  model: { text: (car) => `Подходит для ${car}. Сверьте двигатель: деталь может зависеть от модификации`, tone: "info" },
  not_listed: { text: (car) => `В каталоге применимости эта деталь не указана для ${car}`, tone: "warn" },
  other_engine: { text: (car) => `Для ${car} эта деталь указана с другим двигателем`, tone: "warn" },
};

/**
 * «Применимость»: whether the product fits the visitor's own car (picked on the site or the main car of the
 * garage) and which cars it fits at all. Only on a button: opening a product page asks the catalogue nothing
 * (docs/TECDOC.md). An answer is kept for the rest of the visit. `checkable` — the page knows the product has a
 * part-number catalogue (partNumberCatalogueApplies); for anything else there is the check by VIN.
 */
export function ProductFitment({ checkable, productId, productName }: { checkable: boolean; productId: string; productName: string }) {
  const [enabled, setEnabled] = useState(false);
  const [car, setCar] = useState<PickedVehicle | null>(null);
  const [check, setCheck] = useState<Load>({ status: "idle" });
  const [list, setList] = useState<Load>({ status: "idle" });

  useEffect(() => {
    if (!checkable) return undefined;
    let live = true;
    const read = () => { void activeCar().then((next) => { if (live) setCar(next); }); };
    void vehicleCatalogSource().then((source) => { if (live) setEnabled(source === "tecdoc"); });
    read();
    const stop = onActiveCarChange(read);
    return () => { live = false; stop(); };
  }, [checkable]);

  const ids: FitmentCar | null = car?.tecdoc?.msId ? { msId: car.tecdoc.msId, ...(car.tecdoc.genId ? { genId: car.tecdoc.genId } : {}) } : null;
  const msId = ids?.msId;

  // Another car picked meanwhile: the answer for the former one no longer says anything.
  useEffect(() => { setCheck({ status: "idle" }); }, [msId, ids?.genId]);

  function load(mode: FitmentMode) {
    const set = mode === "check" ? setCheck : setList;
    const kept = keptFitment(sessionStore(), productId, mode, ids);
    const show = (data: Fitment) => set(data.status === "not_applicable" || data.status === "not_found" ? { status: "hidden" } : { data, status: "ready" });
    if (kept) { show(kept); return; }
    set({ status: "loading" });
    tecdocGet<Fitment>(`product/${encodeURIComponent(productId)}/fitment`, fitmentQuery(mode, ids))
      .then((data) => { keepFitment(sessionStore(), productId, mode, ids, data); show(data); })
      .catch((error: unknown) => set({ status: fitmentFailure(error) === "expert" ? "expert" : "error" }));
  }

  if (!checkable || !enabled || check.status === "hidden" || list.status === "hidden") return null;
  const name = car ? carName(car) : null;
  const verdict = check.status === "ready" && check.data.status === "ok" && name && check.data.verdict ? VERDICTS[check.data.verdict] : null;
  const expertPrefill = `Подойдёт ли «${productName}» для ${car?.label ?? "моего автомобиля"}? Пришлю VIN.`;
  const idle = (state: Load) => state.status === "idle" || state.status === "error";
  const shown = fitmentButtons(ids).filter((button) => button === "pick" || idle(button === "check" ? check : list));

  const failure = (state: Load) => (state.status === "error" ? (
    <p className={styles.muted} role="alert">Каталог применимости сейчас недоступен. Специалист проверит деталь по VIN — напишите нам.</p>
  ) : state.status === "expert" ? (
    <div className={styles.verdict} data-tone="info">
      <Info20Regular aria-hidden="true" />
      <div>
        <p>Проверим совместимость по VIN вашего автомобиля.</p>
        <ExpertHelpQueryLink className={styles.textLink} prefillMessage={expertPrefill}>Написать специалисту</ExpertHelpQueryLink>
      </div>
    </div>
  ) : null);
  const unknownPart = (state: Load) => (state.status === "ready" && state.data.status === "unknown_part" ? (
    <div className={styles.verdict} data-tone="info">
      <Info20Regular aria-hidden="true" />
      <p>В каталоге применимости этой детали нет. Специалист проверит её по VIN вашего автомобиля.</p>
    </div>
  ) : null);

  return (
    <section aria-labelledby="product-fitment-title" className={styles.fitment}>
      <div className={styles.head}>
        <h2 id="product-fitment-title">Применимость к автомобилям</h2>
        {name ? <Link className={styles.carLink} href="/podbor"><VehicleCar20Regular aria-hidden="true" />{name}</Link> : null}
      </div>

      {shown.length > 0 ? (
        <div className={styles.actions}>
          {shown.map((button, index) => {
            const tier = index === 0 ? buttons.soft : buttons.quiet;
            if (button === "check") {
              return (
                <button className={`${buttons.button} ${tier}`} key={button} onClick={() => load("check")} type="button">
                  <CheckmarkCircle20Regular aria-hidden="true" /> Проверить, подойдёт ли к {name ?? "моему автомобилю"}
                </button>
              );
            }
            if (button === "list") {
              return (
                <button className={`${buttons.button} ${tier}`} key={button} onClick={() => load("list")} type="button">
                  <List20Regular aria-hidden="true" /> К каким машинам подходит
                </button>
              );
            }
            return <Link className={`${buttons.button} ${tier}`} href="/podbor" key={button}><VehicleCar20Regular aria-hidden="true" /> Выбрать мой автомобиль</Link>;
          })}
        </div>
      ) : null}

      {check.status === "loading" ? <p className={styles.muted} role="status">Проверяем, подойдёт ли деталь к вашему автомобилю…</p> : null}
      {failure(check)}
      {unknownPart(check)}
      {verdict && name ? (
        <div className={styles.verdict} data-tone={verdict.tone}>
          {verdict.tone === "ok" ? <CheckmarkCircle20Regular aria-hidden="true" /> : verdict.tone === "warn" ? <Warning20Regular aria-hidden="true" /> : <Info20Regular aria-hidden="true" />}
          <div>
            <p><strong>{verdict.text(name)}</strong></p>
            {car?.generation || car?.engine ? <p className={styles.muted}>{[car.generation, car.engine].filter(Boolean).join(" · ")}</p> : null}
            {verdict.tone !== "ok" ? (
              <ExpertHelpQueryLink className={styles.textLink} prefillMessage={expertPrefill}>Проверить у специалиста по VIN</ExpertHelpQueryLink>
            ) : null}
          </div>
        </div>
      ) : null}

      {list.status === "loading" ? <p className={styles.muted} role="status">Собираем список автомобилей…</p> : null}
      {failure(list)}
      {check.status === "ready" ? null : unknownPart(list)}
      {list.status === "ready" && list.data.status === "ok" ? (
        <>
          {list.data.makes.length > 0 ? (
            <div className={styles.makes}>
              {list.data.makes.map((make, _index, makes) => (
                <details className={styles.make} key={make.make} open={makes.length === 1}>
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
          {list.data.oems.length > 0 ? (
            <p className={styles.oems}><strong>Оригинальные номера:</strong> {list.data.oems.map((oem) => `${oem.brand} ${oem.number}`).join(", ")}</p>
          ) : null}
        </>
      ) : null}
      {check.status === "ready" || list.status === "ready" ? (
        <p className={styles.muted}>Данные каталога TecDoc. Перед покупкой сверьте деталь со старой или пришлите нам VIN.</p>
      ) : null}
    </section>
  );
}
