/**
 * Client-side contract and wording for the "Подбор по автомобилю" page
 * (`/podbor`). The API (`/api/v1/parts-finder/*`) forwards the owner's
 * parts-finder service unchanged and adds `shop` offers from the АН-30
 * catalog to every part, so the shapes below mirror that service's JSON
 * (snake_case) plus the `shop` field. Everything is optional and read
 * defensively: an unknown field never breaks the page.
 */

export interface ShopOffer {
  availableQuantity: number;
  /** Why the shop calls it an analog (ShopOfferBasisSchema in packages/contracts). */
  basis?: "same_number" | "shop" | "maker" | "two_sources" | "supplier" | "catalogue" | "original_number" | "same_size";
  /** "exact" — the same article; "cross" — the shop's own confirmed analogue; "same_size" — the same standard size. */
  matchedVia?: "cross" | "exact" | "possible" | "same_size";
  brand: string | null;
  name: string;
  priceKopeks: number | null;
  productId: string;
  sku: string;
  slug: string;
}

export interface FinderPart {
  article: string;
  brand?: string;
  description?: string;
  manufacturer_id?: number;
  manufacturer_verified?: boolean;
  oem?: boolean;
  shop?: ShopOffer[];
  source?: string;
  source_url?: string;
}

export interface FinderOption { id: number; label: string }

export type FinderStatus =
  | "article" | "choose" | "confirm" | "found" | "keyword"
  | "need_detail" | "need_vehicle" | "no_data" | "reference";

export interface FinderResult {
  article?: string;
  category?: string;
  choices?: Record<string, number>;
  engine?: string;
  field?: string;
  message?: string;
  options?: FinderOption[];
  parts?: FinderPart[];
  query?: string;
  shop?: ShopOffer[];
  status: FinderStatus;
  vehicle?: string;
}

export interface CrossesResult {
  article: string;
  candidates?: FinderPart[];
  current?: FinderPart;
  groups?: Record<string, FinderPart[]>;
  part?: FinderPart;
  part_status?: "current" | "replaced";
  status: "choose_brand" | "found" | "no_data";
}

export interface VehicleResult {
  catalog_references?: Array<Record<string, unknown> & { manufacturer?: string; model?: string }>;
  chassis?: string;
  check_digit?: string;
  matches?: Array<{ manufacturer?: string; production_year?: number | string }>;
  source?: string | null;
  status?: string;
  type?: string;
  vehicle?: Record<string, unknown>;
  vin?: string;
  warnings?: string[];
}

export interface ShopAnalogsResult {
  article: string;
  offers: ShopOffer[];
  sameSize?: { label: string; offers: ShopOffer[] };
}

/** In-stock shop offers first, then priced ones, then the rest; stable otherwise. */
export function rankParts<T extends { shop?: ShopOffer[] }>(parts: readonly T[]): T[] {
  const score = (part: T) => {
    const offers = part.shop ?? [];
    if (offers.some((offer) => offer.availableQuantity > 0)) return 0;
    return offers.length > 0 ? 1 : 2;
  };
  return parts.map((part, index) => ({ index, part, score: score(part) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ part }) => part);
}

export class FinderError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
    this.name = "FinderError";
  }
}

const UNAVAILABLE = "Подбор по автомобилю временно недоступен. Попробуйте поиск по каталогу.";

export async function finderRequest<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/parts-finder/${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      method: body === undefined ? "GET" : "POST",
    });
  } catch {
    throw new FinderError("Нет связи с сервером. Проверьте интернет и повторите.", null, 0);
  }
  let data: unknown = null;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const record = (data && typeof data === "object" ? data : {}) as { code?: unknown; error?: unknown; message?: unknown };
    const message = typeof record.error === "string" ? record.error : typeof record.message === "string" ? record.message : UNAVAILABLE;
    throw new FinderError(response.status === 429 ? "Слишком много запросов подряд. Подождите минуту и повторите." : message,
      typeof record.code === "string" ? record.code : null, response.status);
  }
  if (!data || typeof data !== "object") throw new FinderError(UNAVAILABLE, null, response.status);
  return data as T;
}

/** Step names the service asks the customer to pick. */
export const CHOICE_LABELS: Record<string, { hint?: string; title: string }> = {
  article: { hint: "Артикул можно прочитать по-разному. Выберите верное написание.", title: "Уточните артикул" },
  engine: { hint: "От двигателя зависит, какая деталь подойдёт.", title: "Выберите двигатель" },
  local_variant: { title: "Выберите вариант автомобиля" },
  make: { title: "Выберите марку" },
  model: { title: "Выберите модель" },
  modification: { hint: "Двигатель и годы выпуска указаны в каждом варианте.", title: "Выберите модификацию" },
  node: { title: "Выберите группу деталей" },
  version: { hint: "Деталь менялась в течение выпуска. Сверьтесь с датой в техпаспорте.", title: "Выберите период выпуска" },
};

export const CROSS_GROUP_LABELS: Record<string, string> = {
  analogs: "Аналоги",
  oe: "Оригинальные номера",
  replaced_by: "Заменён на",
  replaces: "Заменяет",
};

export const VEHICLE_LABELS: Record<string, string> = {
  make: "Марка",
  model: "Модель",
  model_year: "Модельный год",
  model_year_candidates: "Возможные годы",
  trim: "Комплектация",
  series: "Серия",
  body: "Кузов",
  engine_model: "Двигатель",
  displacement_l: "Объём, л",
  engine_hp: "Мощность, л. с.",
  fuel: "Топливо",
  transmission: "Коробка передач",
  drive: "Привод",
  manufacturer: "Производитель",
  plant_country: "Страна сборки",
};

export const VEHICLE_WARNINGS: Record<string, string> = {
  api_ninjas_partial: "Источник вернул только основные сведения об автомобиле.",
  check_digit_mismatch: "Контрольный символ VIN не совпал. Проверьте, нет ли опечатки.",
  model_year_unconfirmed: "Год выпуска не подтверждён — уточните его по документам.",
  provider_make_conflict: "Источники расходятся по марке. Модель требует уточнения.",
  vpic_model_unavailable: "Модель по этому VIN в базе не найдена.",
};

/** A 17-character VIN or a Japanese frame number such as "NZE141-6012345". */
export function looksLikeVehicleId(value: string): boolean {
  const compact = value.trim().toUpperCase().replace(/\s+/gu, "");
  return /^[A-HJ-NPR-Z0-9]{17}$/u.test(compact) || /^[A-Z0-9]{2,8}-\d{3,8}$/u.test(compact);
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export interface VehicleSummary {
  /** "LADA Vesta 2018" — what goes in front of the part name. */
  label: string;
  /** Years the source could not choose between; shown, never auto-picked. */
  yearCandidates: string[];
}

/** The confirmed make/model/year from a VIN result, without guessing. */
export function summarizeVehicle(result: VehicleResult): VehicleSummary | null {
  const vehicle = result.vehicle ?? {};
  const make = text(vehicle.make) ?? text(vehicle.manufacturer) ?? text(result.catalog_references?.[0]?.manufacturer);
  const model = text(vehicle.model) ?? text(result.catalog_references?.[0]?.model);
  if (!make && !model) return null;
  const year = text(vehicle.model_year);
  const candidates = Array.isArray(vehicle.model_year_candidates)
    ? vehicle.model_year_candidates.map(text).filter((item): item is string => Boolean(item))
    : (result.matches ?? []).map((match) => text(match.production_year)).filter((item): item is string => Boolean(item));
  const engine = text(vehicle.engine_model);
  return {
    label: [make, model, year, engine].filter(Boolean).join(" "),
    yearCandidates: year ? [] : [...new Set(candidates)],
  };
}

export function vehicleRows(result: VehicleResult): Array<[string, string]> {
  const vehicle = result.vehicle ?? {};
  const rows: Array<[string, string]> = [];
  for (const [key, label] of Object.entries(VEHICLE_LABELS)) {
    const value = vehicle[key];
    const shown = Array.isArray(value) ? value.map(text).filter(Boolean).join(", ") : text(value);
    if (shown) rows.push([label, shown]);
  }
  return rows;
}

export const SAVED_VEHICLE_KEY = "an30:parts-finder:vehicle";

export function readSavedVehicle(): string | null {
  try {
    const value = window.localStorage.getItem(SAVED_VEHICLE_KEY);
    return value && value.length <= 120 ? value : null;
  } catch {
    return null;
  }
}

export function saveVehicle(label: string | null): void {
  try {
    if (label) window.localStorage.setItem(SAVED_VEHICLE_KEY, label.slice(0, 120));
    else window.localStorage.removeItem(SAVED_VEHICLE_KEY);
    // The header names the chosen car on every page: tell it, as savePickedVehicle does.
    window.dispatchEvent(new Event(PICKED_VEHICLE_EVENT));
  } catch {
    // The page still works for this visit without storage.
  }
}

/* ---------------- One search pipeline (POST /parts-finder/resolve) ---------------- */

export interface SupplierStock { deliveryTime: string | null; id: string; priceKopeks: number; quantity: number }
export interface SupplierPart {
  availability: "under_order";
  brand: string;
  crosses: SupplierPart[];
  guid: string;
  name: string;
  partNumber: string;
  stocks: SupplierStock[];
}

export interface ResolveResult {
  alternatives?: string[];
  article?: string;
  error?: string;
  kind: "article" | "text" | "vehicle_part" | "vin";
  query: string;
  search?: FinderResult;
  shop?: ShopOffer[];
  supplier?: { parts: SupplierPart[]; totalFound: number; truncated: boolean } | null;
  vehicle?: VehicleResult | null;
}

/* ---------------- Make -> model -> modification picker ---------------- */

export interface PickerMake { country: string | null; id: number; name: string; nameRu: string | null; slug: string }
export interface PickerModel {
  body?: string | null; family?: string; fapi: boolean; generation?: string | null;
  id: number; name: string; yearFrom: number | null; yearTo: number | null;
}
export interface PickerModification {
  body: string | null;
  capacity: string | null;
  engine: string | null;
  fuel?: string | null;
  powerPs?: number | null;
  id: number;
  label: string;
  yearFrom: number | null;
  yearTo: number | null;
}

/** A car picked from the list; ids let the search skip the questions already answered. */
export interface PickedVehicle {
  label: string;
  modelId?: number;
  modificationId?: number;
  /** Ids of the same choice in the TecDoc catalogue: applicability is checked against them. */
  tecdoc?: { genId?: number; mfaId?: number; msId: number };
  /** What the «Ваш автомобиль» card shows, line by line. */
  make?: string;
  model?: string;
  generation?: string;
  engine?: string;
}

/**
 * What the «Ваш автомобиль» card offers under the car. The car's parts catalogue exists only with TecDoc and only
 * while parts are picked for the car; saving the car to the garage depends on neither — the garage takes a car of
 * the shop's own catalogue as well. (The save button used to sit inside the TecDoc-only block and never showed
 * without a TecDoc key.)
 */
export function vehicleCardActions(state: {
  picked: PickedVehicle | null;
  saved: boolean;
  signedIn: boolean;
  source: "local" | "tecdoc";
  useVehicle: boolean;
}): { carCatalog: "needs-engine" | "open" | null; saveToGarage: boolean } {
  return {
    carCatalog: state.source === "tecdoc" && state.useVehicle ? (state.picked?.tecdoc?.genId ? "open" : "needs-engine") : null,
    saveToGarage: state.picked !== null && state.signedIn && !state.saved,
  };
}

/**
 * The car this browser shops for, as the header names it on every page: the one picked from the catalogue, or the
 * one known only as a line of text (typed, or read from a VIN).
 */
export function readChosenCar(): PickedVehicle | null {
  const picked = readPickedVehicle();
  if (picked) return picked;
  const label = readSavedVehicle();
  return label ? { label } : null;
}

/**
 * The header's caption for the chosen car and the fuller line for the hint and for screen readers. The header
 * keeps the place whether a car is chosen or not, so nothing in it moves when the browser's storage is read.
 */
export function chosenCarCaption(car: PickedVehicle | null): { caption: string; description: string } {
  if (!car) return { caption: "Выбрать авто", description: "Выбрать автомобиль для подбора запчастей" };
  const label = car.label.trim();
  const name = car.make && car.model ? `${car.make} ${car.model}` : label.split(" · ")[0]!.trim();
  return {
    caption: name || "Ваш автомобиль",
    description: label ? `Ваш автомобиль: ${label}. Открыть подбор` : "Ваш автомобиль. Открыть подбор",
  };
}

/** Subscribe to changes of the chosen car (other tabs and this page). */
export const PICKED_VEHICLE_EVENT = "an30:picked-vehicle";

export function finderGet<T>(path: string, parameters?: Record<string, string | number>): Promise<T> {
  const query = parameters ? `?${new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)])).toString()}` : "";
  return finderRequest<T>(`${path}${query}`);
}

export function yearsLabel(from: number | null, to: number | null): string {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "";
}

const PICKED_VEHICLE_KEY = "an30:parts-finder:picked-vehicle";

export function readPickedVehicle(): PickedVehicle | null {
  try {
    const raw = window.localStorage.getItem(PICKED_VEHICLE_KEY);
    if (!raw || raw.length > 900) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || typeof (value as PickedVehicle).label !== "string") return null;
    const { label, modelId, modificationId } = value as PickedVehicle;
    const line = (field: unknown) => (typeof field === "string" && field.trim() ? field.trim().slice(0, 80) : undefined);
    const details = Object.fromEntries((["make", "model", "generation", "engine"] as const)
      .flatMap((key) => { const text = line((value as PickedVehicle)[key]); return text ? [[key, text]] : []; }));
    const whole = (field: unknown): number | undefined => (Number.isInteger(field) && (field as number) > 0 ? field as number : undefined);
    const ids = (value as PickedVehicle).tecdoc as { genId?: unknown; mfaId?: unknown; msId?: unknown } | undefined;
    const msId = whole(ids?.msId);
    return {
      ...details,
      ...(msId ? { tecdoc: { msId, ...(whole(ids?.genId) ? { genId: whole(ids?.genId) } : {}), ...(whole(ids?.mfaId) ? { mfaId: whole(ids?.mfaId) } : {}) } } : {}),
      label: label.slice(0, 120),
      ...(Number.isInteger(modelId) && modelId! > 0 ? { modelId } : {}),
      ...(Number.isInteger(modificationId) && modificationId! > 0 ? { modificationId } : {}),
    };
  } catch {
    return null;
  }
}

export function savePickedVehicle(vehicle: PickedVehicle | null): void {
  try {
    if (vehicle) window.localStorage.setItem(PICKED_VEHICLE_KEY, JSON.stringify(vehicle));
    else window.localStorage.removeItem(PICKED_VEHICLE_KEY);
    window.dispatchEvent(new Event(PICKED_VEHICLE_EVENT));
  } catch {
    // The page still works for this visit without storage.
  }
}

/** Cheapest supplier stock line, for a one-line "под заказ" summary. */
export function bestSupplierStock(part: SupplierPart): SupplierStock | null {
  return [...part.stocks].sort((a, b) => a.priceKopeks - b.priceKopeks)[0] ?? null;
}

/* ---------------- From the parts finder into the catalog ---------------- */

/** Parts-finder categories (vehicle_parts CATEGORIES) that have a storefront section. */
const CATEGORY_SECTIONS: Readonly<Record<string, string>> = {
  "Масляный фильтр": "/catalog/filtry/maslyanye-filtry",
  "Воздушный фильтр": "/catalog/filtry/vozdushnye-filtry",
  "Салонный фильтр": "/catalog/filtry/salonnye-filtry",
  "Топливный фильтр": "/catalog/filtry/toplivnye-filtry",
  "Тормозные колодки": "/catalog/tormoznaya-sistema/tormoznye-kolodki",
  "Тормозной диск": "/catalog/tormoznaya-sistema/tormoznye-diski",
  "Щётки стеклоочистителя": "/catalog/shchetki",
};

/**
 * Where «Смотреть в каталоге» leads once the finder knows the part and the
 * car but has no confirmed article: the part's own section, with the car
 * carried along for the note on that page; a part without a section is a
 * catalog search for the part name, never for the raw query.
 */
export function catalogHrefForFinder(category: string | undefined, vehicle: string | undefined, query: string): string {
  const section = category ? CATEGORY_SECTIONS[category] : undefined;
  const parameters = new URLSearchParams();
  if (vehicle) parameters.set("vehicle", vehicle.slice(0, 120));
  if (section) return parameters.size ? `${section}?${parameters.toString()}` : section;
  parameters.set("q", (category ?? query).slice(0, 120));
  return `/catalog?${parameters.toString()}`;
}
