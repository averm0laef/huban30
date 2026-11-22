"use client";

import { ArrowLeft20Regular, Chat20Regular, ChevronDown16Regular, Clock20Regular, List20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";

import buttons from "../_components/store-button.module.css";
import { FinderError, type PickedVehicle } from "../_lib/parts-finder";
import { tecdocGet, type CarPartsResult, type CatalogPart, type CategoryMatch, type CategoryNode } from "../_lib/tecdoc";
import { ExpertHelpQueryLink } from "../catalog/expert-help-query-link";
import styles from "./car-catalog.module.css";
import { OfferRow } from "./offer-row";
import shared from "./parts-finder.module.css";

type Load<T> = { status: "idle" | "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const softButton = `${buttons.button} ${buttons.soft}`;
const quietButton = `${buttons.button} ${buttons.quiet}`;

function message(caught: unknown): string {
  return caught instanceof FinderError ? caught.message : "Каталог автомобилей временно недоступен. Поиск по нашему каталогу работает.";
}

function carName(car: PickedVehicle): string {
  return car.make && car.model ? `${car.make} ${car.model}` : car.label;
}

/**
 * The parts catalogue of the chosen car: its sections, then what fits in a
 * section — the shop's own products first, the rest of the catalogue on
 * request. Nothing is loaded ahead: each step is the visitor's own request.
 */
export function CarCatalog({ car, onClearQuery, query }: {
  car: PickedVehicle;
  /** Back to all sections from a text request. */
  onClearQuery: () => void;
  /** What the visitor typed («топливный фильтр»): narrows the sections. */
  query: string | null;
}) {
  const genId = car.tecdoc?.genId;
  const [tree, setTree] = useState<Load<{ matches: CategoryMatch[]; tree: CategoryNode[] }>>({ status: "idle" });
  const [category, setCategory] = useState<{ id: number; name: string } | null>(null);
  const [parts, setParts] = useState<Load<CarPartsResult>>({ status: "idle" });
  const [more, setMore] = useState<"idle" | "loading">("idle");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!genId) return;
    let live = true;
    setCategory(null);
    setParts({ status: "idle" });
    setTree({ status: "loading" });
    tecdocGet<{ matches: CategoryMatch[]; tree: CategoryNode[] }>("categories", { gen: genId, ...(query ? { q: query.slice(0, 80) } : {}) })
      .then((data) => {
        if (!live) return;
        setTree({ data, status: "ready" });
        // The request names exactly one section: open it without one more click.
        const leaves = data.matches.filter((match) => match.leaf);
        if (query && leaves.length === 1 && data.matches.length <= 2) openCategory(leaves[0]!, genId);
      })
      .catch((caught: unknown) => { if (live) setTree({ message: message(caught), status: "error" }); });
    return () => { live = false; };
  }, [genId, query]);

  function openCategory(next: { id: number; name: string }, gen: number) {
    setCategory({ id: next.id, name: next.name });
    setParts({ status: "loading" });
    tecdocGet<CarPartsResult>("parts", { category: next.id, gen })
      .then((data) => { setParts({ data, status: "ready" }); headingRef.current?.focus({ preventScroll: true }); })
      .catch((caught: unknown) => setParts({ message: message(caught), status: "error" }));
  }

  function loadCatalogue() {
    if (!genId || !category || parts.status !== "ready") return;
    setMore("loading");
    tecdocGet<CarPartsResult>("parts", { all: 1, category: category.id, gen: genId })
      .then((data) => setParts({ data, status: "ready" }))
      .catch((caught: unknown) => setParts({ message: message(caught), status: "error" }))
      .finally(() => setMore("idle"));
  }

  if (!genId) return null;
  const name = carName(car);

  if (category) {
    return (
      <section aria-labelledby="car-catalog-title" className={styles.catalog}>
        <div className={styles.head}>
          <div>
            <p className={styles.kicker}>{name}</p>
            <h2 id="car-catalog-title" ref={headingRef} tabIndex={-1}>{category.name}</h2>
          </div>
          <button className={quietButton} onClick={() => { setCategory(null); setParts({ status: "idle" }); }} type="button">
            <ArrowLeft20Regular aria-hidden="true" /> Другой раздел
          </button>
        </div>
        {parts.status === "loading" ? <p className={shared.status} role="status">Ищем подходящие детали…</p> : null}
        {parts.status === "error" ? <p className={shared.errorBox} role="alert">{parts.message}</p> : null}
        {parts.status === "ready" ? (
          <>
            {parts.data.ours.length > 0 ? (
              <div>
                <p className={shared.groupTitle}>В магазине АН-30 — подходит для {name}</p>
                <div className={shared.partList}>{parts.data.ours.map((part) => <PartRow car={car} category={category.name} key={`${part.brand}-${part.article}`} part={part} />)}</div>
              </div>
            ) : (
              <div className={styles.empty}>
                <strong>В нашем каталоге пока нет деталей этого раздела для {name}</strong>
                <p>Ниже — что подходит по каталогу производителей. Привезём под заказ: напишите нам, назовём цену и срок.</p>
              </div>
            )}
            {parts.data.catalog ? (
              <div>
                <p className={shared.groupTitle}>Подходит по каталогу производителей — под заказ</p>
                <div className={shared.partList}>{parts.data.catalog.map((part) => <PartRow car={car} category={category.name} key={`all-${part.brand}-${part.article}`} part={part} />)}</div>
                {parts.data.catalogHasMore ? <p className={shared.muted}>Показаны первые 50 деталей раздела. Нужен конкретный бренд — напишите нам.</p> : null}
              </div>
            ) : (
              <button className={softButton} disabled={more === "loading"} onClick={loadCatalogue} type="button">
                <List20Regular aria-hidden="true" />
                {more === "loading" ? "Загружаем…" : `Показать все подходящие детали (${parts.data.listedBrands} ${plural(parts.data.listedBrands, "бренд", "бренда", "брендов")})`}
              </button>
            )}
            <p className={shared.muted}>Применимость — по каталогу TecDoc. Перед покупкой сверьте деталь со старой или пришлите нам VIN.</p>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="car-catalog-title" className={styles.catalog}>
      <div className={styles.head}>
        <div>
          <p className={styles.kicker}>{name}{car.engine ? ` · ${car.engine}` : ""}</p>
          <h2 id="car-catalog-title">{query ? `«${query}»: выберите раздел` : "Каталог запчастей для автомобиля"}</h2>
        </div>
        {query ? <button className={quietButton} onClick={onClearQuery} type="button"><List20Regular aria-hidden="true" /> Все разделы</button> : null}
      </div>
      {tree.status === "loading" ? <p className={shared.status} role="status">Открываем каталог автомобиля…</p> : null}
      {tree.status === "error" ? <p className={shared.errorBox} role="alert">{tree.message}</p> : null}
      {tree.status === "ready" && query ? (
        tree.data.matches.length > 0 ? (
          <div className={styles.matches}>
            {tree.data.matches.map((match) => (
              <button className={styles.match} key={match.id} onClick={() => openCategory(match, genId)} type="button">
                <strong>{match.name}</strong>
                {match.path.length ? <small>{match.path.join(" › ")}</small> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <strong>Раздел «{query}» для этого автомобиля не нашёлся</strong>
            <p>Выберите раздел из списка ниже или напишите нам — подберём вручную.</p>
          </div>
        )
      ) : null}
      {tree.status === "ready" && (!query || tree.data.matches.length === 0) ? (
        tree.data.tree.length > 0 ? (
          <div className={styles.tree}>
            {tree.data.tree.map((node) => <TreeNode key={node.id} node={node} onPick={(leaf) => openCategory(leaf, genId)} />)}
          </div>
        ) : (
          <div className={styles.empty}>
            <strong>Для этой модификации каталог разделов пуст</strong>
            <p>Пришлите VIN — подберём деталь вручную.</p>
            <ExpertHelpQueryLink className={softButton} prefillMessage={`Нужна деталь для ${car.label}. Пришлю VIN.`}>
              <Chat20Regular aria-hidden="true" /> Спросить специалиста
            </ExpertHelpQueryLink>
          </div>
        )
      ) : null}
    </section>
  );
}

function TreeNode({ node, onPick }: { node: CategoryNode; onPick: (leaf: CategoryNode) => void }) {
  if (node.children.length === 0) {
    return <button className={styles.leaf} onClick={() => onPick(node)} type="button">{node.name}</button>;
  }
  return (
    <details className={styles.group}>
      <summary><span>{node.name}</span><small>{node.children.length}</small><ChevronDown16Regular aria-hidden="true" /></summary>
      <div className={styles.groupBody}>
        {node.children.map((child) => <TreeNode key={child.id} node={child} onPick={onPick} />)}
      </div>
    </details>
  );
}

function PartRow({ car, category, part }: { car: PickedVehicle; category: string; part: CatalogPart }) {
  return (
    <article className={shared.part}>
      <header className={styles.partHead}>
        {part.image ? (
          // The provider's own picture, shown straight from its server.
          <img alt="" className={styles.partImage} height={64} loading="lazy" referrerPolicy="no-referrer" src={part.image} width={64} />
        ) : null}
        <div className={styles.partIdentity}>
          <p className={shared.partArticle}>{part.article}</p>
          <p className={shared.partMeta}>{part.brand}{part.name ? ` · ${part.name}` : ""}</p>
          {part.criteria.length ? <p className={styles.criteria}>{part.criteria.map((item) => `${item.name}: ${item.value}`).join(" · ")}</p> : null}
          {part.oems.length ? <p className={styles.oems}>Оригинальные номера: {part.oems.map((oem) => `${oem.brand} ${oem.number}`).join(", ")}</p> : null}
        </div>
      </header>
      {part.shop.length > 0 ? (
        <div className={shared.offers}>{part.shop.map((offer) => <OfferRow key={offer.productId} offer={offer} />)}</div>
      ) : (
        <div className={shared.partActions}>
          <ExpertHelpQueryLink className={softButton}
            prefillMessage={`Нужна деталь под заказ: ${part.brand} ${part.article}${part.name ? `, ${part.name}` : ""} (${category}) для ${car.label}. Подскажите цену и срок.`}>
            <Clock20Regular aria-hidden="true" /> Узнать цену и срок
          </ExpertHelpQueryLink>
        </div>
      )}
    </article>
  );
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  return units === 1 ? one : units >= 2 && units <= 4 ? few : many;
}
