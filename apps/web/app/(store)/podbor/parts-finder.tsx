"use client";

import {
  ArrowCounterclockwise20Regular,
  ArrowRight20Regular,
  ArrowSwap20Regular,
  Bookmark20Regular,
  BookSearch20Regular,
  Box20Regular,
  Chat20Regular,
  Checkmark20Regular,
  Clock20Regular,
  Dismiss16Regular,
  Edit20Regular,
  Grid20Regular,
  Search20Regular,
  ShieldCheckmark20Regular,
  VehicleCar20Regular,
} from "@fluentui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { AddToCartButton } from "../_components/cart-actions";
import buttons from "../_components/store-button.module.css";
import { CarLineIcon } from "../_components/car-picture";
import { carLook, carLookPicture } from "../_lib/car-look";
import { umapiGet, umapiStatus } from "../_lib/umapi";
import { formatRubles } from "../_lib/catalog-format";
import {
  CHOICE_LABELS,
  CROSS_GROUP_LABELS,
  FinderError,
  VEHICLE_CATALOG_ID_BASE,
  VEHICLE_WARNINGS,
  finderRequest,
  bestSupplierStock,
  catalogHrefForFinder,
  looksLikeVehicleId,
  rankParts,
  readPickedVehicle,
  readSavedVehicle,
  savePickedVehicle,
  saveVehicle,
  summarizeVehicle,
  vehicleCardActions,
  vehicleRows,
  type CrossesResult,
  type FinderPart,
  type FinderResult,
  type PickedVehicle,
  type ResolveResult,
  type ShopAnalogsResult,
  type ShopOffer,
  type SupplierPart,
  type VehicleResult,
} from "../_lib/parts-finder";
import { activeCar, addGarageVehicle, signedIn, tecdocGet, type VinCandidate } from "../_lib/tecdoc";
import { EXPERT_HELP_VIN_STORAGE_KEY } from "../_lib/vin";
import { ExpertHelpQueryLink } from "../catalog/expert-help-query-link";
import styles from "./parts-finder.module.css";
import { CarCatalog } from "./car-catalog";
import { CarNeedsEngine, CarShowcase, CarStart } from "./car-showcase";
import { UmapiCarCatalogue } from "./umapi-car-catalogue";
import { numberMakers } from "./number-makers";
import { OfferRow } from "./offer-row";
import { VehiclePicker } from "./vehicle-picker";
import { normalizeVin } from "../_lib/input-masks";

type Mode = "parts" | "vin";

// One button hierarchy for the whole page: commit, secondary action, utility action.
const primaryButton = `${buttons.button} ${buttons.primary}`;
const softButton = `${buttons.button} ${buttons.soft}`;
const quietButton = `${buttons.button} ${buttons.quiet}`;

interface SearchState {
  choices: Record<string, number>;
  confirmed: boolean;
  query: string;
  /** A car picked from the list: the server adds it to the query and skips answered steps. */
  vehicle?: { modelId?: number; modificationId?: number };
}

type SupplierBlock = ResolveResult["supplier"];

type Load<T> = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const EXAMPLES = [
  "масляный фильтр Toyota Camry 2019 2,5",
  "колодки Лада Веста 2020",
  "масляный фильтр Пробокс",
];

function errorMessage(caught: unknown): string {
  return caught instanceof FinderError ? caught.message : "Не удалось выполнить подбор. Повторите попытку.";
}

/* ---------------- Shop offers ---------------- */

/* ---------------- Analogues: our base first, then the paid catalogue ---------------- */

function AnalogsPanel({ article, brand, description, manufacturerId }: { article: string; brand?: string; description?: string; manufacturerId?: number }) {
  const [shop, setShop] = useState<Load<ShopAnalogsResult>>({ status: "loading" });
  const [crosses, setCrosses] = useState<Load<CrossesResult>>({ status: "idle" });

  useEffect(() => {
    let active = true;
    // The catalogue's description says what the part is: our product of the number without a maker must be that kind.
    const name = description?.replace(/[\u0000-\u001F\u007F]+/gu, " ").trim().slice(0, 200);
    finderRequest<ShopAnalogsResult>("shop-analogs", { article, ...(brand ? { brand } : {}), ...(name ? { name } : {}) })
      .then((data) => { if (active) setShop({ data, status: "ready" }); })
      .catch((caught: unknown) => { if (active) setShop({ message: errorMessage(caught), status: "error" }); });
    return () => { active = false; };
  }, [article, brand, description]);

  const loadCrosses = useCallback(async (selected?: FinderPart) => {
    setCrosses({ status: "loading" });
    let emptyCatalogue: CrossesResult | undefined;
    if (!selected?.manufacturer_id) {
      const params = new URLSearchParams({ article });
      const maker = selected?.brand ?? brand;
      if (maker) params.set("brand", maker);
      try {
        const data = await umapiGet<CrossesResult>(`number/analogs?${params.toString()}`);
        if (data.status !== "no_data") {
          setCrosses({ data, status: "ready" });
          return;
        }
        emptyCatalogue = data;
      } catch {
        // The existing catalogue path remains available on a provider outage.
      }
    }
    try {
      const id = selected?.manufacturer_id ?? manufacturerId;
      const data = await finderRequest<CrossesResult>("crosses", { article, ...(id ? { manufacturer_id: id } : {}) });
      setCrosses({ data, status: "ready" });
    } catch (caught) {
      if (emptyCatalogue) setCrosses({ data: emptyCatalogue, status: "ready" });
      else setCrosses({ message: errorMessage(caught), status: "error" });
    }
  }, [article, brand, manufacturerId]);

  return (
    <div className={styles.analogs}>
      <p className={styles.analogsTitle}>Аналоги в магазине АН-30</p>
      {shop.status === "loading" ? <p className={styles.muted} role="status">Ищем по нашей базе…</p> : null}
      {shop.status === "error" ? <p className={styles.muted} role="alert">{shop.message}</p> : null}
      {shop.status === "ready" && shop.data.offers.length === 0
        ? <p className={styles.muted}>В нашей базе аналогов этого артикула пока нет.</p> : null}
      {shop.status === "ready" && shop.data.offers.length > 0
        ? <div className={styles.offers}>{shop.data.offers.map((offer) => <OfferRow key={offer.productId} offer={offer} />)}</div> : null}

      {crosses.status === "idle" || crosses.status === "error" ? (
        <button className={`${softButton} ${styles.selfStart}`} onClick={() => { void loadCrosses(); }} type="button">
          <BookSearch20Regular aria-hidden="true" />
          Аналоги и замены от производителей
        </button>
      ) : null}
      {crosses.status === "loading" ? <p className={styles.muted} role="status">Запрашиваем каталог производителей…</p> : null}
      {crosses.status === "error" ? <p className={styles.muted} role="alert">{crosses.message}</p> : null}
      {crosses.status === "ready" ? <CrossesView data={crosses.data} onChooseBrand={(candidate) => { void loadCrosses(candidate); }} /> : null}
    </div>
  );
}

function CrossesView({ data, onChooseBrand }: { data: CrossesResult; onChooseBrand: (candidate: FinderPart) => void }) {
  if (data.status === "choose_brand") {
    return (
      <div className={styles.step}>
        <p className={styles.stepTitle}>Артикул {data.article} есть у нескольких брендов. Какой нужен?</p>
        <div className={styles.options}>
          {(data.candidates ?? []).map((candidate) => (
            <button className={styles.option} key={`${candidate.manufacturer_id}-${candidate.article}`}
              onClick={() => onChooseBrand(candidate)} type="button">
              {candidate.brand}{candidate.description ? <small>{candidate.description}</small> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (data.status === "no_data") return <p className={styles.muted}>Производители не указали аналогов для {data.article}.</p>;
  const groups = Object.entries(data.groups ?? {}).filter(([, items]) => items.length > 0);
  return (
    <div className={styles.crossGroups}>
      {data.part_status === "replaced" && data.current
        ? <p className={styles.notice}>Артикул заменён на {data.current.brand} {data.current.article}.</p> : null}
      {groups.length === 0 ? <p className={styles.muted}>Аналогов не найдено.</p> : null}
      {groups.map(([key, items]) => (
        <section className={styles.crossGroup} key={key}>
          <h4>{CROSS_GROUP_LABELS[key] ?? key} · {items.length}</h4>
          <ul>
            {rankParts(items).slice(0, 40).map((item) => (
              <li key={`${item.manufacturer_id ?? item.brand}-${item.article}`}>
                <span className={styles.crossIdentity}><strong>{item.article}</strong> {item.brand}</span>
                {item.shop?.length
                  ? <div className={styles.offers}>{item.shop.map((offer) => <OfferRow key={offer.productId} offer={offer} />)}</div>
                  : <span className={styles.muted}>нет в магазине</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ---------------- Supplier "под заказ" (retail price, after our own stock) ---------------- */

function SupplierOffers({ supplier }: { supplier: SupplierBlock }) {
  if (!supplier || supplier.parts.length === 0) return null;
  const rows = supplier.parts.flatMap((part) => [part, ...part.crosses]).filter((part) => bestSupplierStock(part)).slice(0, 12);
  if (rows.length === 0) return null;
  return (
    <section className={styles.analogs} aria-label="Под заказ">
      <p className={styles.analogsTitle}>Под заказ</p>
      <div className={styles.offers}>
        {rows.map((part: SupplierPart) => {
          const stock = bestSupplierStock(part)!;
          return (
            <div className={styles.offer} key={`${part.guid}-${stock.id}`}>
              <div className={styles.offerIdentity}>
                <span>{part.name || part.partNumber}</span>
                <small>{part.brand ? `${part.brand} · ` : ""}{part.partNumber}</small>
              </div>
              <div className={styles.offerPrice}>
                <strong>{formatRubles(stock.priceKopeks)}</strong>
                <small>{stock.deliveryTime ? `Срок: ${stock.deliveryTime}` : "Срок уточним"}</small>
              </div>
              <div className={styles.offerAction}>
                <ExpertHelpQueryLink className={softButton}
                  prefillMessage={`Хочу заказать: ${part.brand ? `${part.brand} ` : ""}${part.partNumber}, ${part.name}.`}>
                  <Box20Regular aria-hidden="true" />
                  Заказать
                </ExpertHelpQueryLink>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- One found part ---------------- */

function PartCard({ part }: { part: FinderPart }) {
  const [showAnalogs, setShowAnalogs] = useState(false);
  const offers = part.shop ?? [];
  return (
    <article className={styles.part}>
      <header className={styles.partHeader}>
        <div>
          <p className={styles.partArticle}>{part.article}</p>
          <p className={styles.partMeta}>
            {part.brand ?? "Бренд не указан"}
            {part.oem ? <span className={styles.oemBadge}>Оригинал</span> : null}
          </p>
          {part.description ? <p className={styles.partDescription}>{part.description}</p> : null}
        </div>
        {part.source ? <span className={styles.partSource}>Источник: {part.source}</span> : null}
      </header>
      {offers.length > 0
        ? <div className={styles.offers}>{offers.map((offer) => <OfferRow key={offer.productId} offer={offer} />)}</div>
        : <p className={styles.notInShop}>Этого артикула нет в магазине — проверьте аналоги или спросите специалиста.</p>}
      <div className={styles.partActions}>
        <button aria-expanded={showAnalogs} className={softButton} onClick={() => setShowAnalogs((value) => !value)} type="button">
          <ArrowSwap20Regular aria-hidden="true" />
          {showAnalogs ? "Скрыть аналоги" : "Найти аналоги"}
        </button>
        {offers.length === 0 ? (
          <ExpertHelpQueryLink className={quietButton}
            prefillMessage={`Нужна деталь: ${part.brand ? `${part.brand} ` : ""}${part.article}${part.description ? `, ${part.description}` : ""}. Подскажите цену и срок.`}>
            <Chat20Regular aria-hidden="true" />
            Спросить специалиста
          </ExpertHelpQueryLink>
        ) : null}
      </div>
      {showAnalogs ? <AnalogsPanel key={`${part.article}:${part.brand ?? ""}`} article={part.article} brand={part.brand} description={part.description} manufacturerId={part.manufacturer_id} /> : null}
    </article>
  );
}

/**
 * A number typed in the search: when it belongs to several makers' products («3930» — a lamp of OSRAM and an oil of
 * LIQUI MOLY), the customer first says whose part is meant (number-makers.ts); then the part and its analogs are
 * those of that maker. Nothing paid is asked.
 */
function NumberAnswer({ article, shop }: { article: string; shop: ShopOffer[] }) {
  const makers = numberMakers(shop);
  // undefined — not chosen yet; "all" — every offer of the number.
  const [chosen, setChosen] = useState<string | null | "all" | undefined>(undefined);
  if (makers.length > 0 && chosen === undefined) {
    return (
      <div className={styles.makerChoice}>
        <p className={styles.stepTitle}>Номер {article} есть у нескольких производителей. Чья деталь вам нужна?</p>
        <ul>
          {makers.map((maker) => (
            <li key={maker.brand ?? "-"}>
              <button className={styles.makerOption} onClick={() => setChosen(maker.brand)} type="button">
                <strong>{maker.brand ?? "Производитель не указан"}</strong>
                <span>{maker.example}</span>
                <small>
                  {maker.fromKopeks === null ? "Цена по запросу" : `от ${formatRubles(maker.fromKopeks)}`}
                  {" · "}
                  <span className={maker.inStock ? styles.makerInStock : undefined}>{maker.inStock ? "в наличии" : "под заказ"}</span>
                </small>
              </button>
            </li>
          ))}
        </ul>
        <button className={quietButton} onClick={() => setChosen("all")} type="button"><Grid20Regular aria-hidden="true" />Показать все предложения</button>
      </div>
    );
  }
  const maker = chosen === "all" ? null : makers.find((item) => item.brand === chosen) ?? null;
  const part: FinderPart = maker ? { article, ...(maker.brand ? { brand: maker.brand } : {}), shop: maker.offers } : { article, shop };
  return (
    <>
      {makers.length > 0 ? (
        <button className={`${quietButton} ${styles.makerBack}`} onClick={() => setChosen(undefined)} type="button">
          <ArrowCounterclockwise20Regular aria-hidden="true" />Другой производитель
        </button>
      ) : null}
      <div className={styles.partList}>
        <PartCard part={part} />
      </div>
    </>
  );
}

/** Our vehicle catalog's modification of a picked car (a car picked before the switch to it has none). */
function catalogueModification(car: PickedVehicle): number | null {
  return car.modificationId !== undefined && car.modificationId >= VEHICLE_CATALOG_ID_BASE ? car.modificationId : null;
}

/* ---------------- Page ---------------- */

export function PartsFinder() {
  const parameters = useSearchParams();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>(parameters?.get("mode") === "vin" ? "vin" : "parts");
  const [input, setInput] = useState(parameters?.get("q") ?? "");
  const [vinInput, setVinInput] = useState(parameters?.get("vin") ?? "");
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedVehicle | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [articleExtra, setArticleExtra] = useState<{ alternatives: string[]; supplier: SupplierBlock }>({ alternatives: [], supplier: null });
  const [useVehicle, setUseVehicle] = useState(true);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [result, setResult] = useState<Load<FinderResult>>({ status: "idle" });
  const [decoded, setDecoded] = useState<Load<VehicleResult>>({ status: "idle" });
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  // "tecdoc": the picker and the car's parts catalogue come from TecDoc; "local": the shop's own list.
  const [source, setSource] = useState<"local" | "tecdoc">("local");
  // The chosen car's parts catalogue is opened by the visitor (a pick, a request, a button), never on page load.
  const [carBrowse, setCarBrowse] = useState<{ group?: string | null; query: string | null } | null>(null);
  // The car's parts catalogue from UMAPI: the vehicle catalog is UMAPI's own file and the catalogue answers.
  const [umapiCatalogue, setUmapiCatalogue] = useState(false);
  // «фильтр салона» handed over from a search («деталь + машина»): opened in the car's catalogue once a car is chosen.
  const [pendingPart, setPendingPart] = useState<string | null>(() => parameters?.get("part")?.trim().slice(0, 80) || null);
  const [vinCars, setVinCars] = useState<Load<VinCandidate[]>>({ status: "idle" });
  const [garage, setGarage] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const resultRef = useRef<HTMLDivElement>(null);
  const focusResultRef = useRef(false);

  // After a step the button that was pressed is gone; keep focus on the
  // new content instead of letting it fall back to the top of the page.
  useEffect(() => {
    if (result.status !== "ready" || !focusResultRef.current) return;
    focusResultRef.current = false;
    resultRef.current?.focus({ preventScroll: true });
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  useEffect(() => {
    const listed = readPickedVehicle();
    setPicked(listed);
    setVehicle(listed?.label ?? readSavedVehicle());
    // A signed-in customer who picked no car on this device shops for the main car of the garage.
    if (!listed) void activeCar().then((car) => { if (car) { setPicked(car); setVehicle(car.label); } });
    finderRequest<{ catalog?: string; enabled?: boolean }>("status")
      .then((data) => {
        setEnabled(data.enabled === true);
        setSource(data.catalog === "tecdoc" ? "tecdoc" : "local");
        if (data.catalog === "umapi") void umapiStatus().then((umapi) => setUmapiCatalogue(umapi.enabled));
      })
      .catch(() => setEnabled(false));
  }, []);

  // The car the UMAPI catalogue can open: one of our vehicle catalog with its engine chosen.
  const catalogueCar = umapiCatalogue && picked && catalogueModification(picked) ? { ...picked, modificationId: catalogueModification(picked)! } : null;
  // A search «фильтр салона ауди а4» hands over the car it named: the picker opens on that make and model.
  const presetMake = parameters?.get("make")?.trim();
  const presetModel = Number(parameters?.get("model"));
  const pickerPreset = presetMake && /^[a-z0-9-]{1,60}$/u.test(presetMake)
    ? { make: presetMake, ...(Number.isInteger(presetModel) && presetModel > 0 ? { model: presetModel } : {}) }
    : null;

  // Handed a part from a search: with a car already chosen its catalogue opens at once; without one — the picker.
  useEffect(() => {
    if (!umapiCatalogue || !pendingPart) return;
    if (catalogueCar && !pickerPreset) {
      setCarBrowse({ query: pendingPart });
      setPendingPart(null);
    } else {
      setShowPicker(true);
    }
    // Once, when the catalogue is known to answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [umapiCatalogue]);

  const run = useCallback((next: SearchState) => {
    setSearch(next);
    setResult({ status: "loading" });
    setArticleExtra({ alternatives: [], supplier: null });
    finderRequest<FinderResult>("search", {
      query: next.query,
      ...(next.confirmed ? { confirmed: true } : {}),
      ...(Object.keys(next.choices).length ? { choices: next.choices } : {}),
      ...(next.vehicle ? { vehicle: next.vehicle } : {}),
    })
      .then((data) => setResult({ data, status: "ready" }))
      .catch((caught: unknown) => setResult({ message: errorMessage(caught), status: "error" }));
  }, []);

  const decode = useCallback((raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setMode("vin");
    setPickedYear(null);
    setDecoded({ status: "loading" });
    finderRequest<VehicleResult>("vehicle", { vin: value })
      .then((data) => setDecoded({ data, status: "ready" }))
      .catch((caught: unknown) => setDecoded({ message: errorMessage(caught), status: "error" }));
  }, []);

  // One pipeline for free text: VIN, part number (our stock, own crosses, then
  // supplier offers), «деталь + машина» (guided steps) or a catalog search.
  const resolve = useCallback((text: string, log: boolean) => {
    setSearch({ choices: {}, confirmed: false, query: text });
    setResult({ status: "loading" });
    setArticleExtra({ alternatives: [], supplier: null });
    finderRequest<ResolveResult>("resolve", { query: text, ...(log ? {} : { log: false }) })
      .then((data) => {
        if (data.kind === "vin") {
          setVinInput(text);
          setMode("vin");
          setPickedYear(null);
          setResult({ status: "idle" });
          setDecoded(data.vehicle ? { data: data.vehicle, status: "ready" } : { message: data.error ?? "VIN расшифровать не удалось.", status: "error" });
        } else if (data.kind === "article" && data.article) {
          setArticleExtra({ alternatives: data.alternatives ?? [], supplier: data.supplier ?? null });
          setResult({ data: { article: data.article, shop: data.shop ?? [], status: "article" }, status: "ready" });
        } else if (data.kind === "vehicle_part" && data.search) {
          setResult({ data: data.search, status: "ready" });
        } else {
          setResult({ data: { message: "Это похоже на обычный поиск по каталогу: машина или деталь в запросе не распознаны.", status: "need_detail" }, status: "ready" });
        }
      })
      .catch((caught: unknown) => setResult({ message: errorMessage(caught), status: "error" }));
  }, []);

  // A VIN handed over from the header search opens already decoded.
  const initialVin = parameters?.get("vin");
  const initialQuery = parameters?.get("q");
  useEffect(() => {
    if (enabled !== true) return;
    if (initialVin) decode(initialVin);
    // The header search already counted this query in the search log.
    else if (initialQuery && initialQuery.trim().length >= 2) resolve(initialQuery.trim().slice(0, 140), parameters?.get("from") !== "header");
  }, [enabled, initialVin, initialQuery, decode, resolve, parameters]);

  function submitParts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (text.length < 2) return;
    if (looksLikeVehicleId(text)) {
      setVinInput(text);
      decode(text);
      return;
    }
    if ((source === "tecdoc" && picked?.tecdoc?.genId && useVehicle) || (catalogueCar && useVehicle)) {
      setResult({ status: "idle" });
      setCarBrowse({ query: text.slice(0, 80) });
      return;
    }
    setCarBrowse(null);
    if (picked && useVehicle && (picked.modelId || picked.modificationId)) {
      run({
        choices: {}, confirmed: false, query: text.slice(0, 140),
        vehicle: { ...(picked.modelId ? { modelId: picked.modelId } : {}), ...(picked.modificationId ? { modificationId: picked.modificationId } : {}) },
      });
      return;
    }
    const query = vehicle && useVehicle && !text.toLowerCase().includes(vehicle.toLowerCase()) ? `${text} ${vehicle}` : text;
    resolve(query.slice(0, 140), true);
  }

  function pickVehicle(next: PickedVehicle) {
    savePickedVehicle(next);
    saveVehicle(null);
    setPicked(next);
    setVehicle(next.label);
    setUseVehicle(true);
    setShowPicker(false);
    setResult({ status: "idle" });
    setGarage("idle");
    setMode("parts");
    // The car was just chosen: its parts catalogue is what the visitor came for. With the UMAPI catalogue the page shows
    // the car's sections as tiles (variant A), so the catalogue itself opens only for a part handed over from a search.
    const part = pendingPart;
    setPendingPart(null);
    setCarBrowse(umapiCatalogue
      ? (part && catalogueModification(next) ? { query: part } : null)
      : next.tecdoc?.genId ? { query: part } : null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function saveToGarage() {
    if (!picked) return;
    setGarage("saving");
    addGarageVehicle(picked, true).then(() => setGarage("saved")).catch(() => setGarage("error"));
  }
  // What the car's card offers under the car; saving to the garage does not depend on TecDoc (_lib/parts-finder.ts).
  const cardActions = vehicleCardActions({ picked, saved: garage === "saved", signedIn: signedIn(), source, umapi: umapiCatalogue, useVehicle });
  // Variant A of the canvas («Витрина машины»): a car of our vehicle catalog is chosen and the car catalogue answers.
  // Without it (no car, a typed car, TecDoc, the VIN tab, the picker open) the page stays as it was.
  const showcase = umapiCatalogue && mode === "parts" && !showPicker && vehicle !== null && picked !== null;

  // TecDoc names the exact modifications a VIN may be; asked only on the visitor's click.
  function findVinCars() {
    const vin = vinInput.trim().toUpperCase().replace(/\s+/gu, "");
    setVinCars({ status: "loading" });
    tecdocGet<{ vehicles: VinCandidate[] }>(`vin/${encodeURIComponent(vin)}`)
      .then((data) => setVinCars({ data: data.vehicles, status: "ready" }))
      .catch((caught: unknown) => setVinCars({ message: errorMessage(caught), status: "error" }));
  }

  function forgetVehicle() {
    saveVehicle(null);
    savePickedVehicle(null);
    setVehicle(null);
    setPicked(null);
    setCarBrowse(null);
  }

  function pickOption(field: string, id: number) {
    if (!search || result.status !== "ready") return;
    focusResultRef.current = true;
    run({ ...search, choices: { ...search.choices, ...(result.data.choices ?? {}), [field]: id } });
  }

  function useDecodedVehicle(label: string) {
    saveVehicle(label);
    savePickedVehicle(null);
    setPicked(null);
    setVehicle(label);
    setUseVehicle(true);
    setMode("parts");
    setResult({ status: "idle" });
    setInput("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  if (enabled === false) {
    return (
      <div className={styles.panel}>
        <div className={styles.unavailable}>
          <h1>Подбор по автомобилю скоро заработает</h1>
          <p>Пока найдите деталь в каталоге по названию или артикулу либо передайте VIN специалисту — он подберёт и проверит совместимость.</p>
          <div className={styles.unavailableActions}>
            <Link className={primaryButton} href="/catalog"><Grid20Regular aria-hidden="true" />Открыть каталог</Link>
            <Link className={softButton} href="/expert-help"><Chat20Regular aria-hidden="true" />Подбор у специалиста</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.finder} aria-busy={enabled === null || undefined}>
      {showcase && picked ? (
        <CarShowcase
          busy={enabled === null || result.status === "loading"}
          car={picked}
          input={input}
          onChange={() => setShowPicker(true)}
          onForget={forgetVehicle}
          onInput={setInput}
          onSave={saveToGarage}
          onSubmit={submitParts}
          onVin={() => setMode("vin")}
          save={garage === "saving" ? "saving" : cardActions.saveToGarage ? "offer" : null}
          status={garage === "saved" ? <p className={styles.heroStatus} role="status">Машина сохранена в «Моих автомобилях».</p>
            : garage === "error" ? <p className={styles.heroStatus} role="alert">Не удалось сохранить. Войдите в кабинет и повторите.</p> : null}
        />
      ) : (
      <section className={styles.hero} aria-labelledby="podbor-title">
        <div className={styles.heroBody}>
          <h1 id="podbor-title">Подбор запчастей по автомобилю</h1>
          <p className={styles.heroLead}>Напишите деталь и машину или вставьте VIN — покажем артикулы, наличие в магазине и аналоги.</p>
      <div className={styles.tabs} role="tablist" aria-label="Способ подбора">
        <button aria-selected={mode === "parts"} className={styles.tab} onClick={() => setMode("parts")} role="tab" type="button">
          Деталь и машина
        </button>
        <button aria-selected={mode === "vin"} className={styles.tab} onClick={() => setMode("vin")} role="tab" type="button">
          VIN или номер кузова
        </button>
      </div>

      {mode === "parts" ? (
        <section className={styles.mode} aria-label="Подбор по детали и машине">
          {vehicle && !showPicker ? (
            <div className={styles.garage} data-off={!useVehicle || undefined}>
              <CarLineIcon className={styles.garageIcon} />
              <div className={styles.garageBody}>
                <span className={styles.garageKicker}>Ваш автомобиль</span>
                <strong className={styles.garageName}>{picked?.make && picked.model ? `${picked.make} ${picked.model}` : vehicle}</strong>
                {picked?.generation || picked?.engine ? (
                  <dl className={styles.garageFacts}>
                    {picked.generation ? <div><dt>Поколение</dt><dd>{picked.generation}</dd></div> : null}
                    {picked.body ? <div><dt>Тип кузова</dt><dd>{picked.body}</dd></div> : null}
                    <div data-wide=""><dt>Двигатель</dt><dd data-missing={!picked.engine || undefined}>{picked.engine ?? "не выбран"}</dd></div>
                    {picked.power ? <div><dt>Мощность</dt><dd>{picked.power}</dd></div> : null}
                    {picked.fuel ? <div><dt>Топливо</dt><dd>{picked.fuel}</dd></div> : null}
                    {picked.drive ? <div><dt>Привод</dt><dd>{picked.drive}</dd></div> : null}
                    {picked.years && !picked.generation?.includes(picked.years) ? <div><dt>Выпуск</dt><dd>{picked.years}</dd></div> : null}
                  </dl>
                ) : null}
                <label className={styles.garageUse}>
                  <input checked={useVehicle} onChange={(event) => setUseVehicle(event.target.checked)} type="checkbox" />
                  <span>Подбирать детали для этой машины</span>
                </label>
                {cardActions.carCatalog || cardActions.saveToGarage || garage === "saved" || garage === "error" ? (
                  <div className={styles.garageLinks}>
                    {cardActions.carCatalog === "open" ? (
                      <button className={softButton} onClick={() => { setResult({ status: "idle" }); setCarBrowse({ query: null }); }} type="button">
                        <Grid20Regular aria-hidden="true" /> Каталог запчастей автомобиля
                      </button>
                    ) : cardActions.carCatalog === "needs-engine" ? (
                      <button className={softButton} onClick={() => setShowPicker(true)} type="button">
                        <Edit20Regular aria-hidden="true" /> Указать двигатель — откроется каталог запчастей
                      </button>
                    ) : null}
                    {cardActions.saveToGarage ? (
                      <button className={quietButton} disabled={garage === "saving"} onClick={saveToGarage} type="button">
                        <Bookmark20Regular aria-hidden="true" /> {garage === "saving" ? "Сохраняем…" : "Сохранить в гараж"}
                      </button>
                    ) : null}
                    {garage === "saved" ? <span className={styles.muted} role="status">Сохранено в гараже личного кабинета.</span> : null}
                    {garage === "error" ? <span className={styles.muted} role="alert">Не удалось сохранить. Войдите в кабинет и повторите.</span> : null}
                  </div>
                ) : null}
              </div>
              <div className={styles.garageActions}>
                <button className={`${buttons.button} ${buttons.quiet}`} onClick={() => setShowPicker(true)} type="button">
                  <ArrowSwap20Regular aria-hidden="true" /> Сменить
                </button>
                <button aria-label="Убрать автомобиль" className={styles.garageRemove} onClick={forgetVehicle} type="button">
                  <Dismiss16Regular aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
          {showPicker ? <VehiclePicker onCancel={() => setShowPicker(false)} onPick={pickVehicle} preset={pickerPreset} source={source} /> : null}
          <form className={styles.form} onSubmit={submitParts}>
            <label className={styles.visuallyHidden} htmlFor={inputId}>Деталь и машина или артикул</label>
            <Search20Regular aria-hidden="true" />
            <input
              autoComplete="off"
              disabled={enabled === null}
              id={inputId}
              maxLength={140}
              onChange={(event) => setInput(event.target.value)}
              placeholder={vehicle && useVehicle ? "Какая деталь нужна?" : "Деталь и машина или артикул"}
              ref={inputRef}
              type="search"
              value={input}
            />
            <button disabled={enabled === null || result.status === "loading" || input.trim().length < 2} type="submit">Подобрать</button>
          </form>
          {showPicker || vehicle ? null : (
            <div className={styles.pickerRow}>
              <span>Не знаете, как написать?</span>
              <button aria-expanded={false} className={styles.pickerToggle} onClick={() => setShowPicker(true)} type="button">
                <VehicleCar20Regular aria-hidden="true" /> Выбрать марку и модель
              </button>
            </div>
          )}
          {result.status === "idle" ? (
            <div className={styles.examples}>
              <span>Например:</span>
              {EXAMPLES.map((example) => (
                <button key={example} onClick={() => { setInput(example); run({ choices: {}, confirmed: false, query: example }); }} type="button">{example}</button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {mode === "vin" ? (
        <section className={styles.mode} aria-label="Подбор по VIN">
          <form className={styles.form} onSubmit={(event) => { event.preventDefault(); decode(vinInput); }}>
            <label className={styles.visuallyHidden} htmlFor={`${inputId}-vin`}>VIN или номер кузова</label>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              disabled={enabled === null}
              id={`${inputId}-vin`}
              maxLength={32}
              onChange={(event) => setVinInput(normalizeVin(event.target.value))}
              placeholder="VIN из 17 символов или номер кузова"
              spellCheck={false}
              value={vinInput}
            />
            <button disabled={enabled === null || decoded.status === "loading" || vinInput.trim().length < 5} type="submit">Расшифровать</button>
          </form>
          <p className={styles.hint}>VIN указан в СТС и ПТС. Для японских машин подойдёт номер кузова, например NZE141-6012345.</p>
          {source === "tecdoc" && /^[A-HJ-NPR-Z0-9]{17}$/iu.test(vinInput.trim()) ? (
            <div className={styles.vinCars}>
              {vinCars.status === "idle" || vinCars.status === "error" ? (
                <button className={softButton} onClick={findVinCars} type="button">
                  <VehicleCar20Regular aria-hidden="true" /> Найти автомобиль в каталоге и открыть его запчасти
                </button>
              ) : null}
              {vinCars.status === "loading" ? <p className={styles.hint} role="status">Ищем автомобиль в каталоге…</p> : null}
              {vinCars.status === "error" ? <p className={styles.hint} role="alert">{vinCars.message}</p> : null}
              {vinCars.status === "ready" && vinCars.data.length === 0 ? <p className={styles.hint}>По этому VIN каталог не нашёл автомобиль. Выберите марку и модель вручную.</p> : null}
              {vinCars.status === "ready" && vinCars.data.length > 0 ? (
                <div className={styles.vinCarList}>
                  {vinCars.data.map((car) => (
                    <button className={styles.vinCar} key={car.tecdoc.genId} type="button"
                      onClick={() => car.tecdoc.msId && pickVehicle({
                        engine: car.engine, generation: car.generation, label: [car.make, car.model, car.engine].filter(Boolean).join(" · ").slice(0, 120),
                        make: car.make, model: car.model, tecdoc: { genId: car.tecdoc.genId, msId: car.tecdoc.msId, ...(car.tecdoc.mfaId ? { mfaId: car.tecdoc.mfaId } : {}) },
                      })}>
                      <strong>{car.make} {car.model}</strong>
                      <small>{[car.generation, car.engine].filter(Boolean).join(" · ")}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
        </div>
        {/* With a car chosen, one of our blue cars of the same kind (body type, engine size, model — `_lib/car-look.ts`), as on
            the canvas «Подбор · вариант А»; without one, the shop's car. */}
        {vehicle && picked
          ? <img alt="" className={`${styles.heroCar} ${styles.heroLook}`} data-look={carLook(picked)} decoding="async" height={360} width={540} {...carLookPicture(carLook(picked))} />
          : <Image alt="" className={styles.heroCar} height={339} priority sizes="(max-width: 767px) 220px, 420px" src="/brand/car-side.webp" width={720} />}
      </section>
      )}

      {showcase && picked && !carBrowse && result.status === "idle" ? (
        catalogueCar
          ? <CarStart car={picked} onPart={(part) => { setInput(part); setCarBrowse({ query: part }); }} onSection={(group) => setCarBrowse({ group: group ?? "*", query: null })} />
          : <CarNeedsEngine onPick={() => setShowPicker(true)} />
      ) : null}

      {mode === "parts" && result.status === "idle" && !carBrowse && !showcase ? (
        <ol className={styles.stepsRow} aria-label="Как это работает">
          <li data-current><span>1</span><strong>Опишите деталь и машину</strong><small>Марка, модель, год — как в разговоре</small></li>
          <li><span>2</span><strong>Уточните двигатель</strong><small>Если вариантов несколько</small></li>
          <li><span>3</span><strong>Берите из наличия</strong><small>или аналог и под заказ</small></li>
        </ol>
      ) : null}

      {mode === "parts" && carBrowse && picked?.tecdoc?.genId && useVehicle ? (
        <div className={styles.body}>
          <CarCatalog car={picked} onClearQuery={() => { setInput(""); setCarBrowse({ query: null }); }} query={carBrowse.query} />
        </div>
      ) : null}

      {mode === "parts" && carBrowse && catalogueCar && useVehicle ? (
        <div className={styles.body}>
          <UmapiCarCatalogue car={catalogueCar} embedded={showcase} initialGroup={carBrowse.group ?? null} key={`${catalogueCar.modificationId}:${carBrowse.group ?? ""}`}
            onClearQuery={() => { setInput(""); setCarBrowse({ query: null }); }} onClose={() => { setInput(""); setCarBrowse(null); }} query={carBrowse.query} />
        </div>
      ) : null}

      {mode === "parts" ? (
        <div className={styles.body} id="podbor-result" ref={resultRef} tabIndex={-1}>
          <ResultView
            onConfirm={() => search && run({ ...search, confirmed: true })}
            onEdit={() => { setResult({ status: "idle" }); inputRef.current?.focus(); }}
            onPick={pickOption}
            onVin={() => setMode("vin")}
            query={search?.query ?? input}
            result={result}
            vehicle={vehicle}
            onSaveVehicle={(label) => { saveVehicle(label); savePickedVehicle(null); setPicked(null); setVehicle(label); setUseVehicle(true); }}
            onAlternative={(article) => resolve(article, false)}
            articleExtra={articleExtra}
          />
        </div>
      ) : (
        <section className={styles.body} aria-label="Результат расшифровки">
          {decoded.status === "loading" ? <p className={styles.status} role="status">Расшифровываем…</p> : null}
          {decoded.status === "error" ? <p className={styles.errorBox} role="alert">{decoded.message}</p> : null}
          {decoded.status === "ready" ? (
            <VehicleCard
              data={decoded.data}
              onPickYear={setPickedYear}
              onUse={useDecodedVehicle}
              pickedYear={pickedYear}
              raw={vinInput}
            />
          ) : null}
        </section>
      )}
    </div>
  );
}

function ResultView({ articleExtra, onAlternative, onConfirm, onEdit, onPick, onSaveVehicle, onVin, query, result, vehicle }: {
  articleExtra: { alternatives: string[]; supplier: SupplierBlock };
  onAlternative: (article: string) => void;
  onConfirm: () => void;
  onEdit: () => void;
  onPick: (field: string, id: number) => void;
  onSaveVehicle: (label: string) => void;
  onVin: () => void;
  query: string;
  result: Load<FinderResult>;
  vehicle: string | null;
}) {
  if (result.status === "idle") return null;
  if (result.status === "loading") return <p className={styles.status} role="status">Подбираем…</p>;
  if (result.status === "error") return <p className={styles.errorBox} role="alert">{result.message}</p>;
  const data = result.data;
  const context = [data.vehicle, data.engine, data.category].filter(Boolean).join(" · ");

  if (data.status === "choose") {
    const label = CHOICE_LABELS[data.field ?? ""] ?? { title: "Уточните вариант" };
    return (
      <Step chips={[data.vehicle, data.engine, data.category]} hint={label.hint} onEdit={onEdit} pending={label.title.replace(/^Выберите |^Уточните /u, "")} title={label.title}>
        <div className={styles.optionGrid}>
          {(data.options ?? []).map((option) => (
            <button className={styles.optionCard} key={option.id} onClick={() => data.field && onPick(data.field, option.id)} type="button">
              <strong>{option.label.split(" · ")[0]}</strong>
              {option.label.includes(" · ") ? <small>{option.label.split(" · ").slice(1).join(" · ")}</small> : null}
            </button>
          ))}
        </div>
      </Step>
    );
  }

  if (data.status === "confirm") {
    return (
      <Step chips={[data.vehicle, data.category]} hint={data.message} onEdit={onEdit} title="Всё верно?">
        <p className={styles.confirmLine}><strong>{data.vehicle}</strong>{data.category ? <> · {data.category}</> : null}</p>
        <div className={styles.partActions}>
          <button className={primaryButton} onClick={onConfirm} type="button"><Checkmark20Regular aria-hidden="true" />Да, подобрать</button>
          <button className={softButton} onClick={onEdit} type="button"><Edit20Regular aria-hidden="true" />Изменить запрос</button>
        </div>
      </Step>
    );
  }

  if (data.status === "reference" || data.status === "found") {
    const parts = rankParts(data.parts ?? []);
    const inShop = parts.filter((part) => (part.shop ?? []).length > 0);
    const rest = parts.filter((part) => (part.shop ?? []).length === 0);
    const carLabel = [data.vehicle, data.engine].filter(Boolean).join(" · ");
    return (
      <div className={styles.resultsLayout}>
      <div className={styles.results}>
        <div className={styles.resultsHead}>
          <div>
            <p className={styles.resultsContext}>{context}</p>
            {data.message ? <p className={styles.muted}>{data.message}</p> : null}
          </div>
          <button className={quietButton} onClick={onEdit} type="button"><ArrowCounterclockwise20Regular aria-hidden="true" />Новый подбор</button>
        </div>
        {inShop.length > 0 ? (
          <section>
            <h2 className={styles.groupTitle}>Есть в магазине АН-30</h2>
            <div className={styles.partList}>{inShop.map((part) => <PartCard key={`${part.brand}-${part.article}`} part={part} />)}</div>
          </section>
        ) : null}
        {rest.length > 0 ? (
          <section>
            <h2 className={styles.groupTitle}>{inShop.length > 0 ? "Другие подходящие артикулы" : "Подходящие артикулы"}</h2>
            <div className={styles.partList}>{rest.map((part) => <PartCard key={`${part.brand}-${part.article}`} part={part} />)}</div>
          </section>
        ) : null}
        {parts.length === 0 ? <p className={styles.muted}>Для этой модификации деталей не нашлось.</p> : null}
        {data.category ? (
          <Link className={`${quietButton} ${styles.selfStart}`} href={catalogHrefForFinder(data.category, carLabel || data.vehicle, query)}>
            <Grid20Regular aria-hidden="true" />
            Все товары раздела «{data.category}» в каталоге
          </Link>
        ) : null}
      </div>
      <aside className={styles.resultsAside}>
        {carLabel ? (
          <div className={styles.carCard}>
            <Image alt="" height={170} sizes="300px" src="/brand/car-side.webp" width={360} />
            <strong>{data.vehicle}</strong>
            {data.engine ? <span>{data.engine}</span> : null}
            {vehicle === carLabel
              ? <span className={styles.carSaved}>Сохранён как мой автомобиль</span>
              : <button className={`${quietButton} ${styles.carSave}`} onClick={() => onSaveVehicle(carLabel)} type="button"><Bookmark20Regular aria-hidden="true" />Сохранить как мой автомобиль</button>}
          </div>
        ) : null}
        <div className={styles.helpCard}>
          <strong>Не уверены в детали?</strong>
          <span>Пришлите VIN — специалист проверит совместимость.</span>
          <ExpertHelpQueryLink className={styles.helpCardAction} query={query}><Chat20Regular aria-hidden="true" />Спросить специалиста</ExpertHelpQueryLink>
        </div>
      </aside>
      </div>
    );
  }

  if (data.status === "article" && data.article) {
    return (
      <div className={styles.results}>
        <div className={styles.resultsHead}>
          <p className={styles.resultsContext}>Артикул {data.article}</p>
          <button className={quietButton} onClick={onEdit} type="button"><ArrowCounterclockwise20Regular aria-hidden="true" />Новый подбор</button>
        </div>
        {articleExtra.alternatives.length ? (
          <p className={`${styles.muted} ${styles.alternatives}`}>
            Возможно, имелся в виду{" "}
            {articleExtra.alternatives.map((article) => (
              <button className={quietButton} key={article} onClick={() => onAlternative(article)} type="button"><Search20Regular aria-hidden="true" />{article}</button>
            ))}
          </p>
        ) : null}
        <NumberAnswer article={data.article} key={data.article} shop={data.shop ?? []} />
        <SupplierOffers supplier={articleExtra.supplier} />
      </div>
    );
  }

  return (
    <div className={styles.emptyState}>
      <p>{data.message ?? "По этому запросу подобрать деталь не получилось."}</p>
      <div className={styles.partActions}>
        <Link className={softButton} href={catalogHrefForFinder(data.category, data.vehicle, query)}>
          <Grid20Regular aria-hidden="true" />
          {data.category ? `${data.category} в каталоге` : "Искать в каталоге"}
        </Link>
        <button className={softButton} onClick={onVin} type="button"><VehicleCar20Regular aria-hidden="true" />Подобрать по VIN</button>
        <ExpertHelpQueryLink className={quietButton} query={query}><Chat20Regular aria-hidden="true" />Спросить специалиста</ExpertHelpQueryLink>
      </div>
    </div>
  );
}

function Step({ children, chips, hint, onEdit, pending, title }: {
  children: ReactNode;
  chips?: Array<string | undefined>;
  hint?: string;
  onEdit?: () => void;
  pending?: string;
  title: string;
}) {
  const known = (chips ?? []).filter((chip): chip is string => Boolean(chip));
  return (
    <div className={styles.step}>
      {known.length || pending ? (
        <div className={styles.stepHead}>
          <div className={styles.knownChips}>
            {known.map((chip) => <span className={styles.knownChip} key={chip}>{chip} <span aria-hidden="true">✓</span></span>)}
            {pending ? <span className={styles.pendingChip}>{pending} — выберите</span> : null}
          </div>
          {onEdit ? <button className={quietButton} onClick={onEdit} type="button"><Edit20Regular aria-hidden="true" />Изменить запрос</button> : null}
        </div>
      ) : null}
      <p className={styles.stepTitle}>{title}</p>
      {hint ? <p className={styles.muted}>{hint}</p> : null}
      {children}
    </div>
  );
}

function VehicleCard({ data, onPickYear, onUse, pickedYear, raw }: {
  data: VehicleResult;
  onPickYear: (year: string) => void;
  onUse: (label: string) => void;
  pickedYear: string | null;
  raw: string;
}) {
  const summary = summarizeVehicle(data);
  const rows = vehicleRows(data);
  const warnings = (data.warnings ?? []).map((code) => VEHICLE_WARNINGS[code]).filter(Boolean);
  const needsYear = Boolean(summary && summary.yearCandidates.length > 1 && !pickedYear);
  const label = summary ? [summary.label, pickedYear ?? (summary.yearCandidates.length === 1 ? summary.yearCandidates[0] : null)].filter(Boolean).join(" ") : null;

  function toSpecialist() {
    try { window.sessionStorage.setItem(EXPERT_HELP_VIN_STORAGE_KEY, raw.trim().toUpperCase()); } catch { /* the form still opens */ }
  }

  if (!summary) {
    return (
      <div className={styles.emptyState}>
        <p>По этому номеру автомобиль определить не удалось. Проверьте символы — в VIN не бывает букв I, O и Q.</p>
        <Link className={`${softButton} ${styles.selfStart}`} href="/expert-help" onClick={toSpecialist}><Chat20Regular aria-hidden="true" />Передать VIN специалисту</Link>
      </div>
    );
  }

  return (
    <div className={styles.vehicleCard}>
      <p className={styles.vehicleTitle}>{summary.label}{pickedYear ? ` ${pickedYear}` : ""}</p>
      {data.status === "partial" ? <p className={styles.muted}>Определены не все характеристики — двигатель и комплектацию уточним на следующем шаге.</p> : null}
      {summary.yearCandidates.length > 1 ? (
        <div className={styles.step}>
          <p className={styles.stepTitle}>Год выпуска точно не определён. Выберите по документам:</p>
          <div className={styles.options}>
            {summary.yearCandidates.map((year) => (
              <button aria-pressed={pickedYear === year} className={styles.option} key={year} onClick={() => onPickYear(year)} type="button">{year}</button>
            ))}
          </div>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <dl className={styles.vehicleRows}>
          {rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
        </dl>
      ) : null}
      {warnings.map((warning) => <p className={styles.notice} key={warning}>{warning}</p>)}
      <div className={styles.partActions}>
        <button className={primaryButton} disabled={needsYear || !label} onClick={() => label && onUse(label)} type="button">
          Подобрать запчасть для этого автомобиля
          <ArrowRight20Regular aria-hidden="true" />
        </button>
        <Link className={quietButton} href="/expert-help" onClick={toSpecialist}><Chat20Regular aria-hidden="true" />Передать VIN специалисту</Link>
      </div>
    </div>
  );
}
