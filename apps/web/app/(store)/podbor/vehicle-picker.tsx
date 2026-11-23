"use client";

import { ArrowRight20Regular, ChevronRight16Regular, Dismiss16Regular, Search20Regular } from "@fluentui/react-icons";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import buttons from "../_components/store-button.module.css";
import {
  dropRestOfDoubleClick,
  FinderError,
  finderGet,
  isRepeatClick,
  pickerStep,
  yearsLabel,
  type PickedVehicle,
  type PickerMake,
  type PickerModel,
  type PickerModification,
} from "../_lib/parts-finder";
import { tecdocGet } from "../_lib/tecdoc";
import shared from "./parts-finder.module.css";
import styles from "./vehicle-picker.module.css";

interface MakesResponse { groups: Array<{ letter: string; makes: PickerMake[] }>; popular: PickerMake[] }
interface ModelsResponse { make: PickerMake; models: PickerModel[]; popular?: string[]; source: "umapi" }
interface ModificationsResponse { available: boolean; message?: string; modifications: PickerModification[] }
/** `family`: a model as people call it («Toyota Corolla») — the customer then picks its generation. */
interface SuggestItem { family?: string; label: string; make: PickerMake; model: PickerModel | null }

type Load<T> = { status: "idle" | "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

function message(caught: unknown): string {
  return caught instanceof FinderError ? caught.message : "Список автомобилей сейчас недоступен. Напишите марку и модель в поиске.";
}

function familyOf(model: PickerModel): string {
  return model.family ?? model.name;
}

/** "2001–2008 · Verso · кузов E12 · седан": what tells one generation from another, years first — that is what people know. */
function generationLabel(model: PickerModel): string {
  const code = model.bodyCode !== undefined ? [model.series, model.bodyCode ? `кузов ${model.bodyCode}` : null] : [model.generation];
  return [yearsLabel(model.yearFrom, model.yearTo), ...code, model.body].filter(Boolean).join(" · ");
}

interface FamilyGroup { generations: PickerModel[]; name: string; yearFrom: number | null; yearTo: number | null }

/** «бензин» -> «Бензин»: a group title. */
function capital(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/** Engines grouped by fuel, the larger group first; one group when the fuel is not known. */
export function engineGroups(list: readonly PickerModification[]): Array<{ items: PickerModification[]; title: string }> {
  const groups = new Map<string, PickerModification[]>();
  for (const item of list) {
    const title = item.fuel ? capital(item.fuel) : "Двигатели";
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }
  return [...groups.entries()].map(([title, items]) => ({ items, title })).sort((a, b) => b.items.length - a.items.length);
}

/** «1.6 л 4WD (3ZZ-FE)» as the catalog names it, else volume and engine code. */
export function engineTitle(item: PickerModification): string {
  return item.name ?? ([item.capacity ? `${item.capacity} л` : null, item.engine].filter(Boolean).join(" · ") || item.label);
}

/** Catalogue generations grouped under the model name people use, newest generation first. */
export function groupFamilies(models: readonly PickerModel[]): FamilyGroup[] {
  const groups = new Map<string, PickerModel[]>();
  for (const model of models) groups.set(familyOf(model), [...(groups.get(familyOf(model)) ?? []), model]);
  return [...groups.entries()].map(([name, list]) => {
    const generations = [...list].sort((a, b) => (b.yearFrom ?? 0) - (a.yearFrom ?? 0) || a.name.localeCompare(b.name, "ru"));
    const starts = generations.flatMap((item) => (item.yearFrom ? [item.yearFrom] : []));
    const open = generations.some((item) => item.yearFrom !== null && item.yearTo === null);
    const ends = generations.flatMap((item) => (item.yearTo ? [item.yearTo] : []));
    return { generations, name, yearFrom: starts.length ? Math.min(...starts) : null, yearTo: open || !ends.length ? null : Math.max(...ends) };
  }).sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }));
}

/**
 * «Выбрать автомобиль»: марка → модель → модификация, with a typeahead over
 * makes and models. The step row shows where the customer is and lets them
 * step back; every choice is a 44 px button reachable from the keyboard.
 */
export function VehiclePicker({ onCancel, onPick, source = "local" }: {
  onCancel: () => void;
  onPick: (vehicle: PickedVehicle) => void;
  /** "tecdoc": makes, generations and engines come from the TecDoc catalogue, asked step by step. */
  source?: "local" | "tecdoc";
}) {
  // TecDoc refusing or being over its budget must not leave the visitor without a picker: the shop's own list answers.
  const [fallback, setFallback] = useState(false);
  const catalog = source === "tecdoc" && !fallback ? "tecdoc" : "local";
  const catalogGet = catalog === "tecdoc" ? tecdocGet : finderGet;
  const inputId = useId();
  const listId = `${inputId}-suggest`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [makes, setMakes] = useState<Load<MakesResponse>>({ status: "loading" });
  const [make, setMake] = useState<PickerMake | null>(null);
  const [models, setModels] = useState<Load<ModelsResponse>>({ status: "idle" });
  const [family, setFamily] = useState<string | null>(null);
  const [model, setModel] = useState<PickerModel | null>(null);
  const [modifications, setModifications] = useState<Load<ModificationsResponse>>({ status: "idle" });
  const [query, setQuery] = useState("");
  const [suggest, setSuggest] = useState<SuggestItem[]>([]);
  const [active, setActive] = useState(-1);
  const [filter, setFilter] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  // Hundreds of makes: one letter at a time, the first letter until another is chosen.
  const [makeLetter, setMakeLetter] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    catalogGet<MakesResponse>("makes")
      .then((data) => { if (live) setMakes({ data, status: "ready" }); })
      .catch((caught: unknown) => {
        if (!live) return;
        if (catalog === "tecdoc") setFallback(true);
        else setMakes({ message: message(caught), status: "error" });
      });
    return () => { live = false; };
  }, [catalogGet, catalog]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setSuggest([]);
      return;
    }
    // The TecDoc catalogue is not asked on every keystroke: makes are filtered from the list already loaded.
    if (catalog === "tecdoc") {
      const needle = text.toLowerCase();
      const all = makes.status === "ready" ? makes.data.groups.flatMap((group) => group.makes) : [];
      setSuggest(all.filter((item) => item.name.toLowerCase().startsWith(needle) || item.nameRu?.toLowerCase().startsWith(needle))
        .slice(0, 8).map((item) => ({ label: item.nameRu ? `${item.name} · ${item.nameRu}` : item.name, make: item, model: null })));
      setActive(-1);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      finderGet<{ items: SuggestItem[] }>("vehicles/suggest", { q: text.slice(0, 60) })
        .then((data) => { if (live) { setSuggest(data.items); setActive(-1); } })
        .catch(() => { if (live) setSuggest([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, catalog, makes]);

  // Move focus to the new step's heading so screen readers announce it.
  // A long model list leaves the page far below the next, shorter step: bring the picker back.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    const top = sectionRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  }, [make, family, model]);

  function openMake(next: PickerMake, preset: string | null = null) {
    setMake(next);
    setFamily(preset);
    setModel(null);
    setFilter("");
    setLetter(null);
    setModifications({ status: "idle" });
    setModels({ status: "loading" });
    catalogGet<ModelsResponse>("models", { make: next.slug })
      .then((data) => setModels({ data, status: "ready" }))
      .catch((caught: unknown) => setModels({ message: message(caught), status: "error" }));
  }

  function openModel(nextMake: PickerMake, next: PickerModel) {
    setMake(nextMake);
    setFamily(familyOf(next));
    setModel(next);
    setModifications({ status: "loading" });
    catalogGet<ModificationsResponse>("modifications", { model: next.id })
      .then((data) => setModifications({ data, status: "ready" }))
      .catch((caught: unknown) => setModifications({ message: message(caught), status: "error" }));
  }

  function pickSuggestion(item: SuggestItem) {
    setQuery("");
    setSuggest([]);
    if (item.model) openModel(item.make, item.model);
    else openMake(item.make, item.family ?? null);
  }

  function onSuggestKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggest.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (event.key === "ArrowDown" ? (index + 1) % suggest.length : index <= 0 ? suggest.length - 1 : index - 1));
    } else if (event.key === "Enter" && suggest[active]) {
      event.preventDefault();
      pickSuggestion(suggest[active]);
    } else if (event.key === "Escape") {
      setSuggest([]);
    }
  }

  const step = pickerStep({ family, make, model });
  // Every step replaces the list under the pointer, so the rest of a double click must not choose from the new one.
  const choose = (action: () => void) => (event: MouseEvent) => { if (!isRepeatClick(event)) action(); };
  const shownMakeLetter = makes.status === "ready" ? makeLetter ?? makes.data.groups[0]?.letter ?? null : null;
  const allMakes = makes.status === "ready" ? makes.data.groups.flatMap((group) => group.makes) : [];
  const families = models.status === "ready" ? groupFamilies(models.data.models) : [];
  const needle = filter.trim().toLowerCase();
  // A make has up to two hundred models: the usual ones first, the rest by first letter.
  const popularNames = models.status === "ready" ? models.data.popular ?? [] : [];
  const popular = popularNames.flatMap((name) => families.filter((item) => item.name === name));
  const letters = [...new Set(families.map((item) => firstLetter(item.name)))];
  const browseAll = families.length <= 24;
  const visibleFamilies = needle ? families.filter((item) => item.name.toLowerCase().includes(needle))
    : letter ? families.filter((item) => firstLetter(item.name) === letter)
      : browseAll || popular.length === 0 ? families : popular;
  const listTitle = needle ? "Найдено" : letter ? `Модели на «${letter}»` : browseAll || popular.length === 0 ? "Все модели" : "Популярные модели";
  const generations = family ? families.find((item) => item.name === family)?.generations ?? [] : [];

  function openFamily(next: FamilyGroup) {
    // One generation only: nothing to choose, go straight to engines.
    if (next.generations.length === 1 && make) openModel(make, next.generations[0]!);
    else { setFamily(next.name); setModel(null); }
  }

  function pick(modification: PickerModification | null) {
    if (!make || !model) return;
    // The catalog's generation without its years and body type: the card shows those in tiles of their own.
    const generation = model.bodyCode !== undefined
      ? [model.series, model.bodyCode ? `кузов ${model.bodyCode}` : null].filter(Boolean).join(" · ") || generationLabel(model)
      : generationLabel(model);
    const engine = modification ? modification.name ?? ([modification.capacity ? `${modification.capacity} л` : null, modification.engine].filter(Boolean).join(" · ") || modification.label) : "";
    const years = yearsLabel(modification?.yearFrom ?? model.yearFrom, modification?.yearTo ?? model.yearTo);
    const body = (modification?.body ?? model.body)?.toLowerCase();
    dropRestOfDoubleClick();
    onPick({
      label: [make.name, familyOf(model), modification?.engine, yearsLabel(modification?.yearFrom ?? model.yearFrom, modification?.yearTo ?? model.yearTo)].filter(Boolean).join(" · "),
      make: make.name,
      model: familyOf(model),
      ...(generation ? { generation } : {}),
      ...(engine ? { engine } : {}),
      ...(modification?.powerPs ? { power: `${modification.powerPs} л.с.` } : {}),
      ...(modification?.fuel ? { fuel: modification.fuel } : {}),
      ...(modification?.drive ? { drive: modification.drive } : {}),
      ...(body ? { body } : {}),
      ...(years ? { years } : {}),
      ...(catalog === "tecdoc"
        ? { tecdoc: { mfaId: make.id, msId: model.id, ...(modification ? { genId: modification.id } : {}) } }
        : { modelId: model.id, ...(modification ? { modificationId: modification.id } : {}) }),
    });
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className={styles.picker} ref={sectionRef}>
      <div className={styles.head}>
        <nav aria-label="Шаги выбора автомобиля" className={styles.steps}>
          <ol>
            <li aria-current={step === 1 ? "step" : undefined}>
              {make ? <button onClick={() => { setMake(null); setFamily(null); setModel(null); }} type="button">{make.name}</button> : <span>Марка</span>}
            </li>
            <li aria-current={step === 2 ? "step" : undefined}>
              <ChevronRight16Regular aria-hidden="true" />
              {family && make ? <button onClick={() => openMake(make)} type="button">{family}</button> : <span>Модель</span>}
            </li>
            <li aria-current={step === 3 ? "step" : undefined}>
              <ChevronRight16Regular aria-hidden="true" />
              {model ? <button onClick={() => { setModel(null); }} type="button">{generationLabel(model) || "Поколение"}</button> : <span>Поколение</span>}
            </li>
            <li aria-current={step === 4 ? "step" : undefined}>
              <ChevronRight16Regular aria-hidden="true" />
              <span>Двигатель</span>
            </li>
          </ol>
        </nav>
        <button aria-label="Закрыть выбор автомобиля" className={styles.close} onClick={() => { dropRestOfDoubleClick(); onCancel(); }} type="button">
          <Dismiss16Regular aria-hidden="true" />
        </button>
      </div>

      {/* Four drop-down lists in a row: the plainest way to choose for anyone who does not want to look through cards. */}
      <div aria-label="Выбор списками" className={styles.selects} role="group">
        <label className={styles.select}>
          <span>Марка</span>
          <select
            disabled={makes.status !== "ready"}
            onChange={(event) => {
              const next = allMakes.find((item) => item.slug === event.target.value);
              if (next) openMake(next);
            }}
            value={make?.slug ?? ""}
          >
            <option value="">{makes.status === "ready" ? "Выберите марку" : "Загружаем…"}</option>
            {makes.status === "ready" && makes.data.popular.length > 0 ? (
              <optgroup label="Популярные">
                {makes.data.popular.map((item) => <option key={`p-${item.id}`} value={item.slug}>{item.name}</option>)}
              </optgroup>
            ) : null}
            {makes.status === "ready" ? (
              <optgroup label="Все марки">
                {allMakes.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className={styles.select}>
          <span>Модель</span>
          <select
            disabled={!make || models.status !== "ready"}
            onChange={(event) => {
              const next = families.find((item) => item.name === event.target.value);
              if (next) openFamily(next);
            }}
            value={family ?? ""}
          >
            <option value="">{!make ? "Сначала марка" : models.status === "loading" ? "Загружаем…" : "Выберите модель"}</option>
            {popular.length > 0 ? (
              <optgroup label="Популярные">
                {popular.map((item) => <option key={`p-${item.name}`} value={item.name}>{item.name}</option>)}
              </optgroup>
            ) : null}
            <optgroup label="Все модели">
              {families.map((item) => <option key={item.name} value={item.name}>{item.name}{yearsLabel(item.yearFrom, item.yearTo) ? ` (${yearsLabel(item.yearFrom, item.yearTo)})` : ""}</option>)}
            </optgroup>
          </select>
        </label>
        <label className={styles.select}>
          <span>Поколение</span>
          <select
            disabled={!family || generations.length === 0}
            onChange={(event) => {
              const next = generations.find((item) => String(item.id) === event.target.value);
              if (next && make) openModel(make, next);
            }}
            value={model ? String(model.id) : ""}
          >
            <option value="">{family ? "Выберите поколение" : "Сначала модель"}</option>
            {generations.map((item) => <option key={item.id} value={String(item.id)}>{generationLabel(item) || item.name}</option>)}
          </select>
        </label>
        <label className={styles.select}>
          <span>Двигатель</span>
          <select
            disabled={!model || modifications.status !== "ready"}
            onChange={(event) => {
              if (event.target.value === "unknown") { pick(null); return; }
              const next = modifications.status === "ready" ? modifications.data.modifications.find((item) => String(item.id) === event.target.value) : undefined;
              if (next) pick(next);
            }}
            value=""
          >
            <option value="">{!model ? "Сначала поколение" : modifications.status === "loading" ? "Загружаем…" : "Выберите двигатель"}</option>
            {modifications.status === "ready" ? modifications.data.modifications.map((item) => (
              <option key={item.id} value={String(item.id)}>{[engineTitle(item), item.powerPs ? `${item.powerPs} л.с.` : null, item.fuel].filter(Boolean).join(" · ")}</option>
            )) : null}
            {model ? <option value="unknown">Не знаю двигатель</option> : null}
          </select>
        </label>
      </div>

      {step === 1 ? (
        <>
          <h2 className={styles.title} id={`${inputId}-title`} ref={headingRef} tabIndex={-1}>Выберите марку</h2>
          <div className={styles.suggestBox}>
            <div className={styles.search}>
              <label className={shared.visuallyHidden} htmlFor={inputId}>Марка и модель</label>
              <Search20Regular aria-hidden="true" />
              <input
                aria-activedescendant={suggest[active] ? `${listId}-${active}` : undefined}
                aria-autocomplete="list"
                aria-controls={suggest.length ? listId : undefined}
                aria-expanded={suggest.length > 0}
                autoComplete="off"
                id={inputId}
                maxLength={60}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSuggestKey}
                placeholder="Например: Камри или Lada Vesta"
                role="combobox"
                value={query}
              />
            </div>
            {suggest.length ? (
              <ul className={styles.suggestList} id={listId} role="listbox">
                {suggest.map((item, index) => (
                  <li aria-selected={index === active} id={`${listId}-${index}`} key={`${item.make.id}-${item.model?.id ?? 0}`}
                    onClick={() => pickSuggestion(item)} onMouseEnter={() => setActive(index)} role="option">
                    <strong>{item.label}</strong>
                    <small>{item.model ? [item.family ? "поколение" : null, yearsLabel(item.model.yearFrom, item.model.yearTo)].filter(Boolean).join(" · ") || "модель"
                      : item.family ? "модель" : "марка"}</small>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {makes.status === "loading" ? <p className={shared.muted} role="status">Загружаем марки…</p> : null}
          {makes.status === "error" ? <p className={shared.muted} role="alert">{makes.message}</p> : null}
          {makes.status === "ready" ? (
            <>
              <p className={styles.groupLabel}>Популярные марки</p>
              <div className={styles.popular}>
                {makes.data.popular.map((item) => (
                  <button className={styles.makeButton} key={item.id} onClick={choose(() => openMake(item))} type="button">
                    <strong>{item.name}</strong>
                    {/* The Russian spelling is a reading aid: the button is named by the make alone. */}
                    {item.nameRu ? <small aria-hidden="true">{item.nameRu}</small> : null}
                  </button>
                ))}
              </div>
              <p className={styles.groupLabel}>Все марки · {makes.data.groups.reduce((sum, group) => sum + group.makes.length, 0)}</p>
              <div aria-label="Марки по первой букве" className={styles.letterBar} role="group">
                {makes.data.groups.map((group) => (
                  <button aria-pressed={group.letter === shownMakeLetter} key={group.letter} onClick={() => setMakeLetter(group.letter)} type="button">{group.letter}</button>
                ))}
              </div>
              <div aria-label={shownMakeLetter ? `Марки на ${shownMakeLetter}` : undefined} className={styles.makeList} role="group">
                {(makes.data.groups.find((group) => group.letter === shownMakeLetter)?.makes ?? []).map((item) => (
                  <button className={styles.makeLink} key={item.id} onClick={choose(() => openMake(item))} type="button">{item.name}</button>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {step === 2 && make ? (
        <>
          <h2 className={styles.title} id={`${inputId}-title`} ref={headingRef} tabIndex={-1}>{make.name}: выберите модель</h2>
          {models.status === "loading" ? <p className={shared.muted} role="status">Загружаем модели…</p> : null}
          {models.status === "error" ? <p className={shared.muted} role="alert">{models.message}</p> : null}
          {models.status === "ready" ? (
            <>
              {families.length > 12 ? (
                <div className={styles.search}>
                  <label className={shared.visuallyHidden} htmlFor={`${inputId}-filter`}>Найти модель</label>
                  <Search20Regular aria-hidden="true" />
                  <input autoComplete="off" id={`${inputId}-filter`} onChange={(event) => setFilter(event.target.value)} placeholder={`Найти модель ${make.name}`} value={filter} />
                </div>
              ) : null}
              {!browseAll ? (
                <div aria-label="Модели по первой букве" className={styles.letterBar} role="group">
                  {popular.length > 0 ? (
                    <button aria-pressed={letter === null && !needle} onClick={() => { setLetter(null); setFilter(""); }} type="button">Популярные</button>
                  ) : null}
                  {letters.map((item) => (
                    <button aria-pressed={letter === item && !needle} key={item} onClick={() => { setLetter(item); setFilter(""); }} type="button">{item}</button>
                  ))}
                </div>
              ) : null}
              <p className={styles.groupLabel}>{listTitle} · {visibleFamilies.length}</p>
              <div className={styles.modelGrid}>
                {visibleFamilies.map((item) => (
                  <button className={styles.choice} key={item.name} onClick={choose(() => openFamily(item))} type="button">
                    <strong>{item.name}</strong>
                    <small>{[yearsLabel(item.yearFrom, item.yearTo), item.generations.length > 1 ? `${item.generations.length} ${plural(item.generations.length, "поколение", "поколения", "поколений")}` : null].filter(Boolean).join(" · ") || "годы уточним"}</small>
                  </button>
                ))}
              </div>
              {visibleFamilies.length === 0 ? <p className={shared.muted}>Такой модели в списке нет. Напишите её в поиске деталей — мы поймём.</p> : null}
            </>
          ) : null}
        </>
      ) : null}

      {step === 3 && make && family ? (
        <>
          <h2 className={styles.title} id={`${inputId}-title`} ref={headingRef} tabIndex={-1}>{make.name} {family}: поколение и кузов</h2>
          <p className={shared.muted}>Код кузова есть в ПТС и на табличке под капотом. Не уверены — выберите по годам выпуска.</p>
          <div className={styles.generations}>
            {generations.map((item) => (
              <button className={styles.generation} key={item.id} onClick={choose(() => openModel(make, item))} type="button">
                <span className={styles.generationYears}>{yearsLabel(item.yearFrom, item.yearTo) || "годы не указаны"}</span>
                {item.bodyCode !== undefined ? (
                  <>
                    {item.series ? <strong>{family} {item.series}</strong> : null}
                    <span className={styles.generationTags}>
                      {item.bodyCode ? <span className={styles.codeTag}><span>Кузов</span>{item.bodyCode}</span> : null}
                      {item.body ? <span className={styles.bodyTag}>{capital(item.body)}</span> : null}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>{item.generation ?? item.name}</strong>
                    {item.body ? <small>{item.body}</small> : null}
                  </>
                )}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {step === 4 && make && model ? (
        <>
          <h2 className={styles.title} id={`${inputId}-title`} ref={headingRef} tabIndex={-1}>{make.name} {familyOf(model)}: двигатель</h2>
          {modifications.status === "loading" ? <p className={shared.muted} role="status">Загружаем двигатели…</p> : null}
          {modifications.status === "error" ? <p className={shared.muted} role="alert">{modifications.message}</p> : null}
          {modifications.status === "ready" ? (
            <div className={styles.engineGroups}>
              {engineGroups(modifications.data.modifications).map((group, _index, all) => (
                <section aria-label={all.length > 1 ? group.title : undefined} key={group.title}>
                  {all.length > 1 ? <p className={styles.groupLabel}>{group.title} · {group.items.length}</p> : null}
                  <div className={styles.engines}>
                    {group.items.map((item) => (
                      <button className={styles.engine} key={item.id} onClick={choose(() => pick(item))} type="button">
                        <span>
                          <strong>{engineTitle(item)}</strong>
                          <small>{[yearsLabel(item.yearFrom, item.yearTo), item.drive, item.body?.toLowerCase()].filter(Boolean).join(" · ") || item.label}</small>
                        </span>
                        {item.powerPs ? <span className={styles.enginePower}>{item.powerPs} л.с.</span> : null}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
          {modifications.status === "ready" && !modifications.data.available ? <p className={shared.muted}>{modifications.data.message}</p> : null}
          <button className={`${buttons.button} ${buttons.soft} ${styles.skipEngine}`} onClick={choose(() => pick(null))} type="button">
            Не знаю двигатель — продолжить с {make.name} {familyOf(model)}
            <ArrowRight20Regular aria-hidden="true" />
          </button>
        </>
      ) : null}
    </section>
  );
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  return units === 1 ? one : units >= 2 && units <= 4 ? few : many;
}

function firstLetter(name: string): string {
  const first = name.trim()[0]?.toUpperCase() ?? "#";
  return /[0-9]/u.test(first) ? "0–9" : first;
}
