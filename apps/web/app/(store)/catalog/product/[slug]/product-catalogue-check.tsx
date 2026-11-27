"use client";

import { CheckmarkCircle20Regular, ChevronUp20Regular, Info20Regular, List20Regular, ShieldCheckmark20Regular, VehicleCar20Regular, Warning20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { CarPicture } from "../../../_components/car-picture";
import buttons from "../../../_components/store-button.module.css";
import { WheelLoader } from "../../../_components/wheel-loader";
import { FinderError, type PickedVehicle } from "../../../_lib/parts-finder";
import { activeCar, onActiveCarChange } from "../../../_lib/tecdoc";
import { catalogCar, fitmentPath, readableName, umapiGet, umapiStatus, type FitMake, type UmapiFitment } from "../../../_lib/umapi";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import layout from "./product-page.module.css";
import styles from "./product-catalogue-check.module.css";

type Mode = "check" | "list";
type Result = { mode: Mode; status: "loading" }
  | { message: string; mode: Mode; status: "error" }
  | { data: UmapiFitment; mode: Mode; status: "ready" };

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

/** «1.6 л · 102 л.с. · бензин · 2008–2012» under the car's name; the label when the car has no details. */
function carDetails(car: PickedVehicle): string {
  const parts = [car.engine, car.power, car.fuel, car.years].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : car.label;
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

function CarList({ hidden, id, makes, onCollapse, total }: { hidden: boolean; id: string; makes: FitMake[]; onCollapse: () => void; total: number }) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  return (
    <div className={styles.cars} hidden={hidden} id={id}>
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
      {/* A long list: the customer does not have to scroll back up to fold it. */}
      {total > CARS_SHOWN ? (
        <button aria-controls={id} aria-expanded="true" className={styles.collapse} onClick={onCollapse} type="button">
          <ChevronUp20Regular aria-hidden="true" /> Свернуть список машин
        </button>
      ) : null}
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
  const [result, setResult] = useState<Result | null>(null);
  // «Все машины, к которым подходит» folds the list it opened; the answer is kept, so opening it again asks nothing.
  const [folded, setFolded] = useState(false);
  const [noCatalogueData, setNoCatalogueData] = useState(false);
  const listButton = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const requestVersion = useRef(0);

  useEffect(() => {
    if (!applies) return undefined;
    let live = true;
    let carVersion = 0;
    const read = () => {
      const version = ++carVersion;
      requestVersion.current++;
      setResult(null);
      setCar(null);
      void activeCar().then((next) => { if (live && version === carVersion) setCar(next); });
    };
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

  async function load(mode: Mode) {
    const version = ++requestVersion.current;
    setFolded(false);
    setResult({ mode, status: "loading" });
    try {
      const data = await umapiGet<UmapiFitment>(fitmentPath(productId, mode, ids));
      if (version !== requestVersion.current) return;
      if (data.status === "unknown_part" || (data.status === "ok" && data.total === 0 && (mode === "list" || data.verdict === "not_listed"))) {
        setNoCatalogueData(true);
      }
      setResult({ data, mode, status: "ready" });
    } catch (caught) {
      if (version !== requestVersion.current) return;
      const limited = caught instanceof FinderError && caught.status === 429;
      setResult({ message: limited ? caught.message : "Каталог сейчас не отвечает", mode, status: "error" });
    }
  }

  const listShown = result?.status === "ready" && result.mode === "list" && result.data.status === "ok" && result.data.total > 0;
  const listTotal = listShown && result.data.status === "ok" ? result.data.total : 0;

  function toggleList() {
    setFolded((value) => !value);
  }

  /** Folded from the button under a long list: bring the customer back to the box instead of leaving them far below. */
  function collapseFromBottom() {
    setFolded(true);
    const button = listButton.current;
    if (!button) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    button.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    button.focus({ preventScroll: true });
  }

  return (
    <div className={`${layout.compatibility} ${styles.box}`}>
      <strong className={styles.title}>Подойдёт к вашему автомобилю?</strong>
      {car && ids ? (
        <div className={styles.car}>
          <CarPicture className={styles.carIcon} height={43} width={64} />
          <span className={styles.carName}><b>{name}</b><small>{carDetails(car)}</small></span>
          <Link className={styles.carChange} href="/podbor">Сменить</Link>
        </div>
      ) : (
        <p className={styles.muted}>Выберите машину один раз — проверка заработает на всех товарах.</p>
      )}
      {noCatalogueData ? null : <div className={styles.actions}>
        {ids ? (
          <button className={`${buttons.button} ${buttons.primary}`} disabled={result?.status === "loading" && result.mode === "check"} onClick={() => { void load("check"); }} type="button">
            <CheckmarkCircle20Regular aria-hidden="true" /> Проверить для моей машины
          </button>
        ) : (
          <Link className={`${buttons.button} ${buttons.primary}`} href="/podbor"><VehicleCar20Regular aria-hidden="true" /> Выбрать мою машину</Link>
        )}
        {listShown ? (
          <button aria-controls={listId} aria-expanded={!folded} className={`${buttons.button} ${buttons.soft}`} onClick={toggleList} ref={listButton} type="button">
            {folded
              ? <><List20Regular aria-hidden="true" /> Показать машины{listTotal ? ` · ${listTotal}` : ""}</>
              : <><ChevronUp20Regular aria-hidden="true" /> Свернуть список машин</>}
          </button>
        ) : (
          <button className={`${buttons.button} ${buttons.soft}`} disabled={result?.status === "loading" && result.mode === "list"} onClick={() => { void load("list"); }} ref={listButton} type="button">
            <List20Regular aria-hidden="true" /> Все машины, к которым подходит
          </button>
        )}
      </div>}

      {result?.status === "loading" ? (
        <WheelLoader label={result.mode === "check" ? "Проверяем по каталогу…" : "Собираем список машин…"} size="sm" />
      ) : null}
      {result?.status === "error" ? (
        <Answer title={result.message} tone="mute">
          <span>Попробуйте через минуту или проверим по VIN.</span>
          <span className={styles.answerActions}>
            <button className={`${buttons.button} ${buttons.soft}`} onClick={() => { void load(result.mode); }} type="button">Повторить</button>
            {vin}
          </span>
        </Answer>
      ) : null}
      {result?.status === "ready" ? (
        result.data.status === "ok" && result.mode === "list"
          ? listShown
            ? <CarList hidden={folded} id={listId} makes={result.data.makes} onCollapse={collapseFromBottom} total={result.data.total} />
            : <Answer title="В каталоге не указано ни одной машины для этой детали." tone="info">{vin}</Answer>
          : <CheckAnswer car={name ?? "автомобиль"} data={result.data} vin={vin} />
      ) : null}
      {result === null ? noCatalogueData
        ? <CheckAnswer car={name ?? "автомобиль"} data={{ status: "unknown_part" }} vin={vin} />
        : <span className={styles.muted}>Проверка по каталогу производителя. Не уверены — специалист сверит по VIN.</span> : null}
    </div>
  );
}

function CheckAnswer({ car, data, vin }: { car: string; data: UmapiFitment; vin: ReactNode }) {
  if (data.status === "vehicle_required") return <Answer title="Выберите автомобиль, чтобы проверить" tone="info"><Link href="/podbor">Выбрать автомобиль</Link></Answer>;
  if (data.status === "ambiguous") return <Answer title="Не удалось однозначно определить деталь" tone="info"><span>Номер есть у нескольких производителей. Специалист проверит по VIN.</span>{vin}</Answer>;
  if (data.status === "unknown_part") return <Answer title="У этой детали нет данных для проверки по каталогу" tone="info"><span>Специалист сверит её по VIN вашего автомобиля.</span>{vin}</Answer>;
  if (data.status !== "ok") return <Answer title="Проверка по каталогу для этого товара не проводится" tone="mute">{vin}</Answer>;
  const through = data.parts.find((part) => part.through)?.through;
  const source = through
    ? `По каталогу — по аналогам номера ${through.brand} ${through.article}.`
    : data.via === "own"
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
  if (data.verdict === "model") {
    return <Answer title={`Подходит к ${car} — укажите двигатель, чтобы проверить точно`} tone="info"><span>{source}</span><Link href="/podbor">Указать двигатель</Link></Answer>;
  }
  return (
    <Answer title={`Для вашего ${car} в каталоге не указан`} tone="mute">
      <span>Это не значит, что деталь не подойдёт: каталог мог её не описать. Проверим по VIN.</span>
      {vin}
    </Answer>
  );
}
