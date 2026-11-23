"use client";

import { CheckmarkCircle20Regular, Info20Regular, List20Regular, ShieldCheckmark20Regular, VehicleCar20Regular, Warning20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import buttons from "../../../_components/store-button.module.css";
import { WheelLoader } from "../../../_components/wheel-loader";
import { FinderError, type PickedVehicle } from "../../../_lib/parts-finder";
import { activeCar, onActiveCarChange } from "../../../_lib/tecdoc";
import { catalogCar, fitmentPath, readableName, umapiGet, umapiStatus, type FitMake, type UmapiFitment } from "../../../_lib/umapi";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import layout from "./product-page.module.css";
import styles from "./product-catalogue-check.module.css";

type Load = { status: "idle" | "loading" } | { message: string; status: "error" } | { data: UmapiFitment; status: "ready" };

const CARS_SHOWN = 8;

/** «1 модель», «3 модели», «12 моделей». */
function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  const word = tens >= 11 && tens <= 14 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many;
  return `${count} ${word}`;
}

function carName(car: PickedVehicle): string {
  return car.make && car.model ? `${car.make} ${car.model}` : car.label;
}

function Answer({ children, tone, title }: { children?: ReactNode; title: string; tone: "ok" | "warn" | "info" | "mute" }) {
  const Icon = tone === "ok" ? CheckmarkCircle20Regular : tone === "warn" ? Warning20Regular : Info20Regular;
  return (
    <div className={styles.answer} data-tone={tone} role="status">
      <Icon aria-hidden="true" className={styles.answerIcon} />
      <div><strong>{title}</strong>{children}</div>
    </div>
  );
}

function CarList({ makes, total }: { makes: FitMake[]; total: number }) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  if (total === 0) return <p className={styles.muted}>В каталоге не указано ни одной машины для этой детали.</p>;
  return (
    <div className={styles.cars}>
      <p className={styles.muted}>{plural(makes.length, "марка", "марки", "марок")} · {plural(total, "модификация", "модификации", "модификаций")} — по каталогу</p>
      {makes.map((make) => (
        <details className={styles.make} key={make.make} open={make.mine || makes.length === 1}>
          <summary>{readableName(make.make)} <small>{plural(make.models.length, "модель", "модели", "моделей")}</small></summary>
          {make.models.map((model) => {
            const key = `${make.make}:${model.msId ?? model.model}`;
            const shown = opened.has(key) ? model.cars : model.cars.slice(0, CARS_SHOWN);
            return (
              <div className={styles.model} key={key}>
                <b>{readableName(model.model)}</b>
                <span className={styles.years}>{model.yearFrom ?? "?"}–{model.yearTo ?? "н. в."}</span>
                <ul className={styles.engines}>
                  {shown.map((car) => <li data-mine={car.mine || undefined} key={car.pcId}>{readableName(car.name)}{car.mine ? " — ваш" : ""}</li>)}
                  {model.cars.length > shown.length ? (
                    <li><button className={styles.more} onClick={() => setOpened(new Set(opened).add(key))} type="button">ещё {model.cars.length - shown.length}</button></li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </details>
      ))}
    </div>
  );
}

/**
 * «Подойдёт к вашему автомобилю?» in the product's info column (Claude Design canvas «совместимость и аналоги»):
 * checked against the UMAPI catalogue on a button, never on opening the page. Without the catalogue, or for goods it
 * does not describe, the box offers the check by VIN, as before.
 */
export function ProductCatalogueCheck({ applies, prefill, productId }: { applies: boolean; prefill: string; productId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [car, setCar] = useState<PickedVehicle | null>(null);
  const [check, setCheck] = useState<Load>({ status: "idle" });
  const [list, setList] = useState<Load>({ status: "idle" });

  useEffect(() => {
    if (!applies) return undefined;
    let live = true;
    const read = () => { void activeCar().then((next) => { if (live) { setCar(next); setCheck({ status: "idle" }); } }); };
    void umapiStatus().then((status) => { if (live) setEnabled(status.enabled); });
    read();
    const stop = onActiveCarChange(read);
    return () => { live = false; stop(); };
  }, [applies]);

  const vin = (
    <ExpertHelpQueryLink className={`${buttons.button} ${buttons.soft}`} prefillMessage={prefill}>
      <ShieldCheckmark20Regular aria-hidden="true" />
      Проверить по VIN
    </ExpertHelpQueryLink>
  );
  if (!applies || !enabled) {
    return <div className={layout.compatibility}><strong>Подойдёт к вашему автомобилю?</strong>{vin}</div>;
  }

  const ids = catalogCar(car);
  const name = car ? carName(car) : null;

  function load(mode: "check" | "list") {
    const set = mode === "check" ? setCheck : setList;
    set({ status: "loading" });
    umapiGet<UmapiFitment>(fitmentPath(productId, mode, mode === "check" ? ids : ids ?? null))
      .then((data) => set({ data, status: "ready" }))
      .catch((caught: unknown) => set({ message: caught instanceof FinderError ? caught.message : "Проверка сейчас недоступна.", status: "error" }));
  }

  return (
    <div className={`${layout.compatibility} ${styles.box}`}>
      <strong>{name && ids ? `Подойдёт к вашему ${name}?` : "Подойдёт к вашему автомобилю?"}</strong>
      <div className={styles.actions}>
        {ids ? (
          <button className={`${buttons.button} ${buttons.primary}`} disabled={check.status === "loading"} onClick={() => load("check")} type="button">
            <CheckmarkCircle20Regular aria-hidden="true" /> Проверить совместимость
          </button>
        ) : (
          <Link className={`${buttons.button} ${buttons.primary}`} href="/podbor"><VehicleCar20Regular aria-hidden="true" /> Выбрать мой автомобиль</Link>
        )}
        <button className={`${buttons.button} ${buttons.soft}`} disabled={list.status === "loading"} onClick={() => load("list")} type="button">
          <List20Regular aria-hidden="true" /> К каким машинам подходит
        </button>
      </div>
      {car && ids ? <span className={styles.muted}>{car.label} · <Link href="/podbor">сменить</Link></span> : null}

      {check.status === "loading" ? <WheelLoader label="Проверяем по каталогу…" size="sm" /> : null}
      {check.status === "error" ? <Answer title={check.message} tone="mute">{vin}</Answer> : null}
      {check.status === "ready" ? <CheckAnswer car={name ?? "автомобиль"} data={check.data} engineKnown={Boolean(ids?.mod)} vin={vin} /> : null}

      {list.status === "loading" ? <WheelLoader label="Собираем список машин…" size="sm" /> : null}
      {list.status === "error" ? <Answer title={list.message} tone="mute" /> : null}
      {list.status === "ready" ? (list.data.status === "ok" ? <CarList makes={list.data.makes} total={list.data.total} /> : <CheckAnswer car={name ?? "автомобиль"} data={list.data} engineKnown={false} vin={vin} />) : null}
    </div>
  );
}

function CheckAnswer({ car, data, engineKnown, vin }: { car: string; data: UmapiFitment; engineKnown: boolean; vin: ReactNode }) {
  if (data.status === "vehicle_required") return <Answer title="Выберите автомобиль, чтобы проверить" tone="info"><Link href="/podbor">Выбрать автомобиль</Link></Answer>;
  if (data.status === "ambiguous") return <Answer title="Не удалось однозначно определить деталь" tone="info"><span>Номер есть у нескольких производителей. Специалист проверит по VIN.</span>{vin}</Answer>;
  if (data.status === "unknown_part") return <Answer title="У этой детали нет данных для проверки по каталогу" tone="info"><span>Специалист сверит её по VIN вашего автомобиля.</span>{vin}</Answer>;
  if (data.status !== "ok") return <Answer title="Проверка по каталогу для этого товара не проводится" tone="mute">{vin}</Answer>;
  const source = data.via === "own"
    ? data.verdict === "fits" ? "По каталогу для вашей модификации." : "По каталогу."
    : `По каталогу — по номеру-аналогу ${data.parts.map((part) => `${part.brand} ${part.article}`).join(", ")} из названия товара.`;
  if (data.verdict === null) {
    return (
      <Answer title="Не уверены — проверим по VIN" tone="info">
        <span>Номера-аналоги из названия дают разные ответы: {data.parts.map((part) => `${part.brand} ${part.article} — ${part.verdict === "fits" ? "подходит" : "не указан"}`).join("; ")}.</span>
        {vin}
      </Answer>
    );
  }
  if (data.verdict === "fits") return <Answer title={`Подходит к вашему ${car}`} tone="ok"><span>{source}</span></Answer>;
  if (data.verdict === "other_engine") {
    return <Answer title={`Подходит к ${car}, но с другим двигателем`} tone="warn"><span>Сверьте двигатель в ПТС или уточните у специалиста. {source}</span>{vin}</Answer>;
  }
  if (data.verdict === "model" || !engineKnown) {
    return <Answer title={`Подходит к ${car} — укажите двигатель, чтобы проверить точно`} tone="info"><span>{source}</span><Link href="/podbor">Указать двигатель</Link></Answer>;
  }
  return (
    <Answer title={`Для вашего ${car} в каталоге не указан`} tone="mute">
      <span>Это не значит, что деталь не подойдёт: каталог мог её не описать. Проверим по VIN.</span>
      {vin}
    </Answer>
  );
}
