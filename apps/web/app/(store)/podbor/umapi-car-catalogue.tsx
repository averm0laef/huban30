"use client";

import { ArrowLeft20Regular, Chat20Regular, ChevronDown16Regular, Clock20Regular, Search20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import buttons from "../_components/store-button.module.css";
import { WheelLoader } from "../_components/wheel-loader";
import { FinderError, type PickedVehicle } from "../_lib/parts-finder";
import {
  carCategories, carParts, type CarCatalogueAnswer, type CarCategory, type CarCategoryMatch, type CarGroup, type CarPartsAnswer, type CarPartView,
} from "../_lib/umapi";
import { ExpertHelpQueryLink } from "../catalog/expert-help-query-link";
import { OfferRow } from "./offer-row";
import shared from "./parts-finder.module.css";
import styles from "./umapi-car-catalogue.module.css";

type Load<T> = { status: "idle" | "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };
type Catalogue = Extract<CarCatalogueAnswer, { status: "ok" }>;
type Parts = Exclude<CarPartsAnswer, { status: "unknown_car" | "unknown_category" }>;
type Opened = { id: number; name: string; type?: number | null };

const softButton = `${buttons.button} ${buttons.soft}`;
const quietButton = `${buttons.button} ${buttons.quiet}`;
/** What people come for most; each opens the matching section of this car. */
const FREQUENT = ["Колодки", "Масляный фильтр", "Воздушный фильтр", "Фильтр салона", "Свеча зажигания", "Амортизатор", "Ремень ГРМ", "Щётка стеклоочистителя"];

function message(caught: unknown): string {
  return caught instanceof FinderError ? caught.message : "Каталог запчастей сейчас недоступен. Поиск по нашему каталогу работает.";
}

function carName(car: PickedVehicle): string {
  return car.make && car.model ? `${car.make} ${car.model}` : car.label;
}

function findCategory(tree: readonly CarCategory[], id: number): CarCategory | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const inside = findCategory(node.children, id);
    if (inside) return inside;
  }
  return null;
}

/**
 * The parts catalogue of the chosen car (Claude Design canvas «совместимость и аналоги», boards «Каталог запчастей по
 * машине» and «Телефон: каталог по машине»): sections in plain words, a section's categories, then the parts — the
 * shop's own first, with price and «В корзину», the rest «под заказ». The car stays in sight on every step. Each step
 * is the visitor's own click: nothing is loaded ahead.
 */
export function UmapiCarCatalogue({ car, embedded = false, initialGroup = null, onClearQuery, onClose, query }: {
  car: PickedVehicle & { modificationId: number };
  /** Inside «Подбор» variant A (canvas «Подбор · вариант А»): the page above shows the car and the search, so no second
   *  plate, field or «Часто ищут» here; «Все разделы» goes back to the page's own section tiles. */
  embedded?: boolean;
  /** A section tile of the page was pressed («Тормоза»): open that section once the catalogue answers; «*» — every section. */
  initialGroup?: string | null;
  onClearQuery: () => void;
  onClose?: () => void;
  query: string | null;
}) {
  const modificationId = car.modificationId;
  const [catalogue, setCatalogue] = useState<Load<Catalogue>>({ status: "idle" });
  const [asked, setAsked] = useState<string | null>(query);
  const [typed, setTyped] = useState(query ?? "");
  const [group, setGroup] = useState<CarGroup | "all" | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [parts, setParts] = useState<Load<Parts>>({ status: "idle" });
  const [brand, setBrand] = useState<string | null>(null);
  const [more, setMore] = useState<"idle" | "loading">("idle");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const requestVersion = useRef(0);
  const moreFor = useRef<number | null>(null);
  const invalidatePartsRequests = useCallback(() => ++requestVersion.current, []);

  useEffect(() => { setAsked(query); setTyped(query ?? ""); }, [query]);

  useEffect(() => {
    let live = true;
    closeParts();
    setGroup(null);
    setCatalogue({ status: "loading" });
    carCategories(modificationId, asked)
      .then((data) => {
        if (!live) return;
        if (data.status !== "ok") { setCatalogue({ message: "Этой машины нет в каталоге запчастей. Выберите её заново или пришлите VIN.", status: "error" }); return; }
        setCatalogue({ data, status: "ready" });
        // The request names exactly one category: open it without one more click.
        const leaves = data.matches.filter((match) => match.leaf && !match.related);
        if (asked && leaves.length === 1 && data.matches.length <= 2) open({ id: leaves[0]!.id, name: leaves[0]!.name });
        else {
          // A tile of the page: its section of this car, or every section when this car's catalogue has none by that name.
          if (!asked && initialGroup) setGroup(data.groups.find((item) => item.name === initialGroup) ?? "all");
          bringIntoView();
        }
      })
      .catch((caught: unknown) => { if (live) setCatalogue({ message: message(caught), status: "error" }); });
    return () => { live = false; invalidatePartsRequests(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modificationId, asked]);

  function bringIntoView() {
    window.setTimeout(() => {
      headingRef.current?.focus({ preventScroll: true });
      // Above the screen after a long list, or below it under the car's card: brought into sight.
      const top = sectionRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight * 0.6) sectionRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }, 0);
  }

  function closeParts() {
    invalidatePartsRequests();
    setOpened(null);
    setParts({ status: "idle" });
    setMore("idle");
  }

  function open(next: Opened, filter: string | null = null) {
    const version = invalidatePartsRequests();
    setOpened(next);
    setBrand(filter);
    setMore("idle");
    setParts({ status: "loading" });
    carParts(modificationId, { brand: filter, category: next.id, type: next.type ?? null })
      .then((data) => {
        if (version !== requestVersion.current) return;
        if (!("category" in data)) {
          setParts({ message: "В этом разделе каталога для вашей машины ничего нет. Выберите другой или спросите специалиста.", status: "error" });
          return;
        }
        setParts({ data, status: "ready" });
        bringIntoView();
      })
      .catch((caught: unknown) => {
        if (version === requestVersion.current) setParts({ message: message(caught), status: "error" });
      });
  }

  function chooseMatch(match: CarCategoryMatch) {
    if (match.leaf) {
      open(match);
      return;
    }
    setGroup({ categoryIds: [match.id], hint: "", id: match.id, name: match.name });
    bringIntoView();
  }

  function showMore() {
    const version = requestVersion.current;
    if (moreFor.current === version || !opened || parts.status !== "ready" || parts.data.status !== "ok") return;
    const current = parts.data;
    moreFor.current = version;
    setMore("loading");
    carParts(modificationId, { brand, category: opened.id, page: current.page + 1, type: current.type.id })
      .then((data) => {
        if (version === requestVersion.current && data.status === "ok") {
          setParts({ data: { ...data, catalogue: [...current.catalogue, ...data.catalogue] }, status: "ready" });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (moreFor.current === version) moreFor.current = null;
        if (version === requestVersion.current) setMore("idle");
      });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = typed.trim();
    setAsked(text.length >= 2 ? text.slice(0, 80) : null);
  }

  const name = carName(car);
  const facts = [car.engine, car.power, car.years].filter(Boolean).join(" · ");
  const plate = embedded ? null : (
    <div className={styles.plate}>
      <span aria-hidden="true" className={styles.mark}>{(car.make ?? name).slice(0, 5).toUpperCase()}</span>
      <div>
        <strong>{name}{car.generation ? ` · ${car.generation}` : ""}</strong>
        <small>{facts ? `${facts} · ` : ""}подбираем запчасти именно для неё</small>
      </div>
    </div>
  );

  /* ---------- A category: its parts ---------- */
  if (opened) {
    const ready = parts.status === "ready" ? parts.data : null;
    const crumbs = ready ? ready.category.path : [];
    return (
      <section aria-labelledby="car-catalogue-title" className={styles.catalogue} ref={sectionRef}>
        {plate}
        <nav aria-label="Путь по каталогу" className={styles.crumbs}>
          <button onClick={closeParts} type="button">Все разделы</button>
          {crumbs.map((crumb) => <span key={crumb}><span aria-hidden="true">/</span>{crumb}</span>)}
        </nav>
        <div className={styles.head}>
          <h2 id="car-catalogue-title" ref={headingRef} tabIndex={-1}>{ready?.status === "ok" ? ready.type.name : opened.name}</h2>
          <button className={quietButton} onClick={closeParts} type="button">
            <ArrowLeft20Regular aria-hidden="true" /> Другой раздел
          </button>
        </div>
        {parts.status === "loading" ? <div className={styles.loading}><WheelLoader label="Подбираем детали для вашей машины…" /></div> : null}
        {parts.status === "error" ? (
          <div className={styles.empty} role="alert">
            <strong>{parts.message}</strong>
            <button className={softButton} onClick={() => open(opened, brand)} type="button">Повторить</button>
          </div>
        ) : null}
        {ready?.status === "choose_type" ? (
          <div className={styles.types}>
            <p className={shared.muted}>В разделе «{ready.category.name}» несколько видов деталей — выберите нужный:</p>
            <div className={styles.chips}>
              {ready.types.map((type) => <button className={styles.chip} key={type.id} onClick={() => open({ ...opened, type: type.id })} type="button">{type.name}</button>)}
            </div>
          </div>
        ) : null}
        {ready?.status === "ok" ? <PartsView car={car} data={ready} brand={brand} more={more} onBrand={(next) => open({ ...opened, type: ready.type.id }, next)}
          onMore={showMore} onType={(type) => open({ ...opened, type })} /> : null}
      </section>
    );
  }

  /* ---------- Sections ---------- */
  const data = catalogue.status === "ready" ? catalogue.data : null;
  const matches = data && asked ? data.matches : [];
  const shownGroup = group && group !== "all" ? group : null;
  return (
    <section aria-labelledby="car-catalogue-title" className={styles.catalogue} ref={sectionRef}>
      {plate}
      <div className={styles.head}>
        <h2 id="car-catalogue-title" ref={headingRef} tabIndex={-1}>
          {shownGroup ? shownGroup.name : group === "all" ? "Все разделы каталога" : "Каталог запчастей для вашей машины"}
        </h2>
        {group || (embedded && onClose) ? (
          <button className={quietButton} onClick={() => (embedded && onClose ? onClose() : setGroup(null))} type="button"><ArrowLeft20Regular aria-hidden="true" /> Все разделы</button>
        ) : null}
      </div>
      {embedded ? null : <form className={styles.find} onSubmit={submit} role="search">
        <label className={shared.visuallyHidden} htmlFor="car-catalogue-find">Что ищете для этой машины</label>
        <Search20Regular aria-hidden="true" />
        <input autoComplete="off" id="car-catalogue-find" onChange={(event) => setTyped(event.target.value)} placeholder="Что ищете: колодки, фильтр салона…" type="search" value={typed} />
        <button className={`${buttons.button} ${buttons.primary}`} type="submit">Найти</button>
      </form>}
      {!group && !embedded ? (
        <div className={styles.frequent}>
          <span>Часто ищут:</span>
          {FREQUENT.map((item) => (
            <button aria-pressed={asked?.toLowerCase() === item.toLowerCase()} className={styles.chip} key={item} onClick={() => { setTyped(item); setAsked(item); }} type="button">{item}</button>
          ))}
        </div>
      ) : null}
      {catalogue.status === "loading" ? <div className={styles.loading}><WheelLoader label="Открываем каталог вашей машины…" /></div> : null}
      {catalogue.status === "error" ? (
        <div className={styles.empty} role="alert">
          <strong>{catalogue.message}</strong>
          <ExpertHelpQueryLink className={softButton} prefillMessage={`Нужна деталь для ${car.label}. Пришлю VIN.`}>
            <Chat20Regular aria-hidden="true" /> Спросить специалиста
          </ExpertHelpQueryLink>
        </div>
      ) : null}
      {data && asked && !group ? (
        matches.length > 0 ? (
          <div className={styles.matches}>
            <p className={shared.groupTitle}>{matches[0]?.related ? `Ближайшие разделы по запросу «${asked}»` : `«${asked}» в каталоге вашей машины`}</p>
            {matches.map((match) => <MatchButton key={match.id} match={match} onOpen={chooseMatch} />)}
            <button className={quietButton} onClick={() => { setAsked(null); setTyped(""); onClearQuery(); if (embedded && onClose) onClose(); }} type="button">Показать все разделы</button>
          </div>
        ) : (
          <div className={styles.empty}>
            <strong>Раздел «{asked}» для этой машины не нашёлся</strong>
            <p>Выберите раздел ниже или <Link href={`/catalog?q=${encodeURIComponent(asked)}`}>поищите «{asked}» в нашем каталоге</Link>.</p>
            <ExpertHelpQueryLink className={softButton} prefillMessage={`Нужна деталь «${asked}» для ${car.label}. Пришлю VIN.`}>
              <Chat20Regular aria-hidden="true" /> Запросить подбор
            </ExpertHelpQueryLink>
          </div>
        )
      ) : null}
      {data && !group && (!asked || matches.length === 0) ? (
        <div className={styles.groups}>
          {data.groups.map((item) => (
            <button className={styles.group} key={item.id} onClick={() => { setGroup(item); bringIntoView(); }} type="button">
              <strong>{item.name}</strong>
              {item.hint ? <small>{item.hint}</small> : null}
            </button>
          ))}
          <button className={styles.group} data-all="" onClick={() => { setGroup("all"); bringIntoView(); }} type="button">
            <strong>Все разделы</strong>
            <small>{data.tree.length} разделов каталога</small>
          </button>
        </div>
      ) : null}
      {data && group ? (
        <div className={styles.tree}>
          {(shownGroup ? shownGroup.categoryIds.map((id) => findCategory(data.tree, id)).filter((node): node is CarCategory => node !== null) : data.tree)
            .map((node) => <TreeNode key={node.id} node={node} onPick={(leaf) => open({ id: leaf.id, name: leaf.name })} open={Boolean(shownGroup)} />)}
        </div>
      ) : null}
    </section>
  );
}

function MatchButton({ match, onOpen }: { match: CarCategoryMatch; onOpen: (match: CarCategoryMatch) => void }) {
  return (
    <button className={styles.match} onClick={() => onOpen(match)} type="button">
      <strong>{match.name}</strong>
      {match.path.length ? <small>{match.path.join(" › ")}</small> : null}
    </button>
  );
}

function TreeNode({ node, onPick, open }: { node: CarCategory; onPick: (leaf: CarCategory) => void; open: boolean }) {
  if (node.children.length === 0) return <button className={styles.leaf} onClick={() => onPick(node)} type="button">{node.name}</button>;
  return (
    <details className={styles.branch} open={open}>
      <summary><span>{node.name}</span><small>{node.children.length}</small><ChevronDown16Regular aria-hidden="true" /></summary>
      <div className={styles.branchBody}>{node.children.map((child) => <TreeNode key={child.id} node={child} onPick={onPick} open={false} />)}</div>
    </details>
  );
}

function PartsView({ brand, car, data, more, onBrand, onMore, onType }: {
  brand: string | null;
  car: PickedVehicle;
  data: Extract<Parts, { status: "ok" }>;
  more: "idle" | "loading";
  onBrand: (brand: string | null) => void;
  onMore: () => void;
  onType: (type: number) => void;
}) {
  const rest = data.total - data.ours.length;
  return (
    <div className={styles.parts}>
      {data.types.length > 1 ? (
        <div className={styles.chips} role="group" aria-label="Вид детали">
          {data.types.map((type) => <button aria-pressed={type.id === data.type.id} className={styles.chip} key={type.id} onClick={() => onType(type.id)} type="button">{type.name}</button>)}
        </div>
      ) : null}
      {data.ours.length > 0 ? (
        <div>
          <p className={shared.groupTitle}>Есть в АН-30 · {data.ours.length}</p>
          <div className={styles.list}>{data.ours.map((part) => <PartCard car={car} category={data.type.name} key={`ours-${part.brand}-${part.article}`} ours part={part} />)}</div>
        </div>
      ) : (
        <div className={styles.empty}>
          <strong>Этих деталей для вашей машины сейчас нет в нашем магазине</strong>
          <p>Ниже — всё, что подходит по каталогу производителей. Привезём под заказ: нажмите «Уточнить наличие», назовём цену и срок.</p>
        </div>
      )}
      {rest > 0 ? (
        <div>
          <p className={shared.groupTitle}>Ещё подходят по каталогу · {rest} — под заказ</p>
          {data.brands.length > 1 ? (
            <div className={styles.chips} role="group" aria-label="Бренд">
              <button aria-pressed={brand === null} className={styles.chip} onClick={() => onBrand(null)} type="button">Все бренды</button>
              {data.brands.map((item) => (
                <button aria-pressed={brand === item.name} className={styles.chip} key={item.name} onClick={() => onBrand(item.name)} type="button">{item.name} <small>{item.count}</small></button>
              ))}
            </div>
          ) : null}
          <div className={styles.list}>{data.catalogue.map((part) => <PartCard car={car} category={data.type.name} key={`all-${part.brand}-${part.article}`} ours={false} part={part} />)}</div>
          {data.hasMore ? (
            <button className={softButton} disabled={more === "loading"} onClick={onMore} type="button">{more === "loading" ? "Загружаем…" : "Показать ещё"}</button>
          ) : null}
          {data.truncated ? <p className={shared.muted}>В разделе больше 1000 деталей — показана первая тысяча. Нужен другой бренд — напишите нам.</p> : null}
        </div>
      ) : null}
      <div className={styles.note}>
        <span>Не уверены, что подойдёт? Пришлите VIN — менеджер сверит деталь по каталогу завода и ответит в чате.</span>
        <ExpertHelpQueryLink className={softButton} prefillMessage={`Подбор для ${car.label}: «${data.type.name}». Пришлю VIN — проверьте, пожалуйста, что подойдёт.`}>
          <Chat20Regular aria-hidden="true" /> Проверить по VIN
        </ExpertHelpQueryLink>
      </div>
      <p className={shared.muted}>Применимость — по каталогу производителей. Перед покупкой сверьте деталь со старой или пришлите нам VIN.</p>
    </div>
  );
}

function PartCard({ car, category, ours, part }: { car: PickedVehicle; category: string; ours: boolean; part: CarPartView }) {
  return (
    <article className={styles.part} data-ours={ours || undefined}>
      <div className={styles.partHead}>
        <div className={styles.photo}>
          {part.image ? (
            // The maker's picture of this very catalogue part, straight from the catalogue's image server.
            <img alt={`${part.brand} ${part.article}`} height={88} loading="lazy" referrerPolicy="no-referrer" src={part.image} width={88} />
          ) : <span>Фото по запросу</span>}
        </div>
        <div className={styles.identity}>
          <p className={styles.name}>{part.name ?? category}</p>
          <p className={styles.number}><strong>{part.brand}</strong> {part.article}</p>
          {part.criteria.length ? <p className={styles.criteria}>{part.criteria.map((item) => `${item.name}: ${item.value}`).join(" · ")}</p> : null}
        </div>
      </div>
      {part.shop.length > 0 ? (
        <div className={shared.offers}>{part.shop.map((offer) => <OfferRow key={offer.productId} offer={offer} />)}</div>
      ) : (
        <div className={shared.partActions}>
          <ExpertHelpQueryLink className={softButton}
            prefillMessage={`Нужна деталь под заказ: ${part.brand} ${part.article}${part.name ? `, ${part.name}` : ""} (${category}) для ${car.label}. Подскажите цену и срок.`}>
            <Clock20Regular aria-hidden="true" /> Уточнить наличие
          </ExpertHelpQueryLink>
        </div>
      )}
    </article>
  );
}
