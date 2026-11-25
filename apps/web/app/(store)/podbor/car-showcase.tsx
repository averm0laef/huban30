"use client";

import { ArrowRight16Regular, ArrowSwap20Regular, Bookmark20Regular, Dismiss16Regular, Edit20Regular, Grid20Regular, ScanText20Regular, Search20Regular } from "@fluentui/react-icons";
import type { FormEvent, ReactNode } from "react";

import { carLook, carLookPicture } from "../_lib/car-look";
import type { PickedVehicle } from "../_lib/parts-finder";
import styles from "./car-showcase.module.css";

/** «Toyota Corolla»: the model alone when the make is long, for «Для Corolla чаще всего берут». */
export function carTitle(car: PickedVehicle): string {
  return car.make && car.model ? `${car.make} ${car.model}` : car.label;
}

function carShort(car: PickedVehicle): string {
  return car.model ?? car.make ?? "вашей машины";
}

/** «кузов E12 · 2001–2006»: the generation, and the years when the generation does not already name them. */
function generationLine(car: PickedVehicle): string | null {
  const parts = [car.generation, car.years && !car.generation?.includes(car.years) ? car.years : null].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * «Подбор» with a chosen car — Claude Design canvas «Подбор · вариант А „Витрина машины“» (owner 25.11.2026: «перенеси
 * дизайн с холста»). The car is the hero: one of our blue cars of the same kind (`_lib/car-look.ts`), its name large,
 * the facts as chips, then one search for this car laid over the hero's lower edge.
 */
export function CarShowcase({ busy, car, input, onChange, onForget, onInput, onSave, onSubmit, onVin, save, status }: {
  busy: boolean;
  car: PickedVehicle;
  input: string;
  onChange: () => void;
  onForget: () => void;
  onInput: (value: string) => void;
  onSave: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onVin: () => void;
  /** «В «Мои автомобили»» is offered to a signed-in customer whose car is not in the garage yet. */
  save: "offer" | "saving" | "saved" | "error" | null;
  status?: ReactNode;
}) {
  const look = carLook(car);
  const facts: Array<[string, string]> = [
    ["Двигатель", car.engine ?? "не выбран"],
    ...(car.power ? [["Мощность", car.power] as [string, string]] : []),
    ...(car.drive ? [["Привод", car.drive] as [string, string]] : []),
    ...(car.fuel ? [["Топливо", car.fuel] as [string, string]] : []),
    ...(car.body ? [["Кузов", car.body.toLowerCase()] as [string, string]] : []),
  ];
  const generation = generationLine(car);
  return (
    <div className={styles.showcase}>
      <section aria-labelledby="podbor-title" className={styles.hero}>
        <div className={styles.heroBody}>
          <span className={styles.kick}>Ваша машина</span>
          <h1 className={styles.name} id="podbor-title"><span className={styles.visuallyHidden}>Подбор запчастей для </span>{carTitle(car)}</h1>
          {generation ? <p className={styles.generation}>{generation}</p> : null}
          {/* Phone board: the facts in one line instead of chips. */}
          <p className={styles.specLine}>{facts.filter(([label]) => label !== "Кузов").map(([, value]) => value).join(" · ")}</p>
          <dl className={styles.specs}>
            {facts.map(([label, value]) => (
              <div className={styles.spec} data-missing={label === "Двигатель" && !car.engine ? "" : undefined} key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={onChange} type="button"><ArrowSwap20Regular aria-hidden="true" /> Сменить машину</button>
            {save === "offer" || save === "saving" ? (
              <button className={styles.ghost} disabled={save === "saving"} onClick={onSave} type="button">
                <Bookmark20Regular aria-hidden="true" /> {save === "saving" ? "Сохраняем…" : "В «Мои автомобили»"}
              </button>
            ) : null}
            <button className={styles.ghost} onClick={onVin} type="button"><ScanText20Regular aria-hidden="true" /> По VIN</button>
          </div>
          {status}
        </div>
        <button aria-label="Убрать автомобиль" className={styles.remove} onClick={onForget} title="Убрать автомобиль" type="button"><Dismiss16Regular aria-hidden="true" /></button>
        <img alt="" className={styles.car} data-look={look} decoding="async" height={360} width={540} {...carLookPicture(look)} />
      </section>
      <form className={styles.search} onSubmit={onSubmit} role="search">
        <label className={styles.visuallyHidden} htmlFor="podbor-car-search">Что ищете для {carTitle(car)}</label>
        <Search20Regular aria-hidden="true" className={styles.searchIcon} />
        <input autoComplete="off" id="podbor-car-search" maxLength={140} onChange={(event) => onInput(event.target.value)}
          placeholder={`Что ищете для ${carShort(car)}: колодки, фильтр салона, артикул…`} type="search" value={input} />
        <button disabled={busy || input.trim().length < 2} type="submit">Найти</button>
      </form>
    </div>
  );
}

/** What is bought most for any car; each opens the matching part of this car's catalogue. Pictures — `public/categories`. */
const POPULAR: ReadonlyArray<{ image: string; query: string; title: string; hint: string }> = [
  { hint: "передние и задние", image: "tormoznye-kolodki", query: "Колодки", title: "Тормозные колодки" },
  { hint: "масляный, воздушный, салона", image: "vozdushnye-filtry", query: "Фильтр", title: "Фильтры для ТО" },
  { hint: "передние и задние", image: "amortizatory", query: "Амортизатор", title: "Амортизаторы" },
  { hint: "зажигания и накала", image: "svechi-zazhiganiya", query: "Свеча зажигания", title: "Свечи" },
];

/** The car catalogue's sections (api `GROUP_ORDER`), each with our own picture and the shop's words for what is inside. */
const SECTIONS: ReadonlyArray<{ hint: string; image: string; name: string }> = [
  { hint: "фильтры, свечи, ремни", image: "motornye-masla", name: "Техобслуживание" },
  { hint: "масляный, воздушный, салона", image: "filtry", name: "Фильтры" },
  { hint: "колодки, диски, суппорты", image: "tormoznaya-sistema", name: "Тормоза" },
  { hint: "амортизаторы, рычаги, опоры", image: "podveska", name: "Подвеска" },
  { hint: "прокладки, ремни, датчики", image: "dvigatel", name: "Двигатель" },
  { hint: "помпа, термостат, радиатор", image: "ohlazhdenie", name: "Охлаждение и печка" },
  { hint: "наконечники, тяги, насос", image: "rulevoe-upravlenie", name: "Рулевое" },
  { hint: "генератор, стартер", image: "elektrika", name: "Электрика" },
  { hint: "свечи, катушки, провода", image: "zazhiganie", name: "Зажигание" },
  { hint: "фары, фонари, лампы", image: "fary-i-fonari", name: "Свет" },
  { hint: "щётки, омыватель", image: "shchetki", name: "Стёкла и щётки" },
  { hint: "сцепление, ШРУС, приводы", image: "transmissiya", name: "Трансмиссия" },
  { hint: "насос, фильтр, форсунки", image: "toplivnaya-sistema", name: "Топливная система" },
  { hint: "глушитель, катализатор", image: "vyhlopnaya-sistema", name: "Выхлопная система" },
  { hint: "бампер, крылья, зеркала", image: "kuzovnye-paneli", name: "Кузов" },
  { hint: "ручки, стеклоподъёмники", image: "komfort-v-salone", name: "Салон" },
];

function Picture({ name }: { name: string }) {
  return <img alt="" decoding="async" height={96} loading="lazy" src={`/categories/${name}.webp`} width={96} />;
}

/**
 * Under the hero, before anything is asked: «чаще всего берут» and every section as a tile with our picture. Nothing is
 * asked of the catalogue until a tile is pressed (`AGENTS.md`: UMAPI only on the visitor's action).
 */
export function CarStart({ car, onPart, onSection }: { car: PickedVehicle; onPart: (query: string) => void; onSection: (name: string | null) => void }) {
  const short = carShort(car);
  return (
    <div className={styles.start}>
      <section aria-labelledby="podbor-popular" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="podbor-popular">Для {short} чаще всего берут</h2>
          <p>Покажем то, что подходит именно к вашей машине по каталогу производителей. Сначала — то, что есть в магазине.</p>
        </div>
        <div className={styles.popular}>
          {POPULAR.map((item) => (
            <button className={styles.part} key={item.query} onClick={() => onPart(item.query)} type="button">
              <span className={styles.partPicture}><Picture name={item.image} /></span>
              <strong>{item.title}</strong>
              <span className={styles.partRow}><small>{item.hint}</small><ArrowRight16Regular aria-hidden="true" /></span>
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="podbor-sections" className={styles.block}>
        <div className={styles.blockHead}><h2 id="podbor-sections">Все разделы для {short}</h2></div>
        <div className={styles.sections}>
          {SECTIONS.map((item) => (
            <button className={styles.section} key={item.name} onClick={() => onSection(item.name)} type="button">
              <Picture name={item.image} />
              <strong>{item.name}</strong>
              <small>{item.hint}</small>
            </button>
          ))}
          <button className={styles.section} data-all="" onClick={() => onSection(null)} type="button">
            <Grid20Regular aria-hidden="true" className={styles.allIcon} />
            <strong>Весь каталог</strong>
            <small>все разделы списком</small>
          </button>
        </div>
      </section>
    </div>
  );
}

/** A car without its engine: the catalogue needs the modification, so the one step left is said plainly. */
export function CarNeedsEngine({ onPick }: { onPick: () => void }) {
  return (
    <section className={styles.engine}>
      <strong>Укажите двигатель — откроется каталог запчастей вашей машины</strong>
      <span>Детали отличаются даже у одной модели: объём и код двигателя есть в СТС или под капотом.</span>
      <button className={styles.enginePick} onClick={onPick} type="button"><Edit20Regular aria-hidden="true" /> Выбрать двигатель</button>
    </section>
  );
}
