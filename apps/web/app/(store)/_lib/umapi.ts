/**
 * Browser client for the product page's catalogue buttons (apps/api/src/umapi, docs/UMAPI_INTEGRATION.md):
 * compatibility with the customer's car, the cars a part fits, our products among its analogs, its photo. Every call
 * is a press of a button: nothing here runs when a page opens.
 */
import { FinderError, readableFailure, VEHICLE_CATALOG_ID_BASE, type PickedVehicle, type ShopOffer } from "./parts-finder";

export type UmapiVerdict = "fits" | "other_engine" | "model" | "not_listed";
/** `through`: the part stands in for a number without a card of its own (an original number, a maker without cards). */
export interface UmapiPart { article: string; artId: number; asked: string; brand: string; through?: { article: string; brand: string }; via: "own" | "name" }
export interface FitCar { mine: boolean; name: string; pcId: number }
export interface FitModel { cars: FitCar[]; mine: boolean; model: string; msId: number | null; yearFrom: number | null; yearTo: number | null }
export interface FitMake { make: string; mine: boolean; models: FitModel[] }

/** Answers about a product the catalogue cannot be asked about, or could not match. */
export type UmapiProductStatus = "not_found" | "not_applicable" | "unknown_part" | "ambiguous";

export type UmapiFitment =
  | { status: UmapiProductStatus | "vehicle_required" }
  | {
    makes: FitMake[];
    parts: Array<UmapiPart & { verdict: UmapiVerdict | null }>;
    status: "ok";
    total: number;
    /** For a check: null — the analogue numbers of the name disagree («не уверены»). */
    verdict: UmapiVerdict | null;
    via: "own" | "name";
  };

export type UmapiAnalogs = { status: UmapiProductStatus } | { offers: ShopOffer[]; parts: UmapiPart[]; status: "ok" };
export interface UmapiSpec { label: string; value: string }
export type UmapiPhotos = { status: UmapiProductStatus | "not_available" } | { part: UmapiPart; photos: string[]; specs?: UmapiSpec[]; status: "ok" | "none"; title?: string | null };

const UNAVAILABLE = "Проверка по каталогу сейчас недоступна. Попробуйте через несколько минут или спросите специалиста.";

let statusRequest: Promise<{ enabled: boolean; photos: boolean }> | null = null;

/** Whether the catalogue buttons are offered at all (a key is set and UMAPI answers): asked once per page. */
export function umapiStatus(): Promise<{ enabled: boolean; photos: boolean }> {
  statusRequest ??= fetch("/api/v1/umapi/status", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { enabled?: unknown; photos?: unknown } | null) => ({ enabled: data?.enabled === true, photos: data?.photos === true }))
    .catch(() => ({ enabled: false, photos: false }));
  return statusRequest;
}

export async function umapiGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/umapi/${path}`, { headers: { Accept: "application/json" } });
  } catch {
    throw new FinderError("Нет связи с сервером. Проверьте интернет и повторите.", null, 0);
  }
  let data: unknown = null;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const record = (data && typeof data === "object" ? data : {}) as { code?: unknown };
    throw new FinderError(readableFailure(data, UNAVAILABLE), typeof record.code === "string" ? record.code : null, response.status);
  }
  if (!data || typeof data !== "object") throw new FinderError(UNAVAILABLE, null, response.status);
  return data as T;
}

/** The car of the check in our vehicle catalog's numbers; a car picked before the switch to it has none. */
export function catalogCar(car: PickedVehicle | null): { model?: number; mod?: number } | null {
  if (!car) return null;
  const valid = (value: number | undefined) => (value !== undefined && value >= VEHICLE_CATALOG_ID_BASE ? value : undefined);
  const mod = valid(car.modificationId);
  const model = valid(car.modelId);
  return mod || model ? { ...(model ? { model } : {}), ...(mod ? { mod } : {}) } : null;
}

export function fitmentPath(productId: string, mode: "check" | "list", car: { model?: number; mod?: number } | null): string {
  const query = new URLSearchParams({ mode });
  if (car?.model) query.set("model", String(car.model));
  if (car?.mod) query.set("mod", String(car.mod));
  return `product/${encodeURIComponent(productId)}/fitment?${query.toString()}`;
}

/**
 * «MERCEDES-BENZ» -> «Mercedes-Benz», «COROLLA седан (_E12_)» -> «Corolla седан (E12)»: catalogue capitals read as
 * names, and the catalogue's «_» marks inside codes are dropped.
 */
export function readableName(name: string): string {
  return name
    .replace(/\(([^()]*)\)/gu, (_whole, inside: string) => `(${inside.replace(/_/gu, "").replace(/\s*,\s*/gu, ", ").trim()})`)
    .replace(/[A-ZА-ЯЁ][A-ZА-ЯЁ]{3,}/gu, (word) => word[0] + word.slice(1).toLowerCase());
}

/* ---------------- «Каталог запчастей по машине» (apps/api/src/umapi/umapi-car-catalogue.*) ---------------- */

export interface CarCategory { children: CarCategory[]; id: number; name: string }
export interface CarGroup { categoryIds: number[]; hint: string; id: number; name: string }
export interface CarCategoryMatch { id: number; leaf: boolean; name: string; path: string[]; related?: true }
export type CarCatalogueAnswer = { status: "unknown_car" } | { groups: CarGroup[]; matches: CarCategoryMatch[]; status: "ok"; tree: CarCategory[] };
export interface CarPartType { id: number; name: string; original: string }
export interface CarPartView {
  article: string;
  brand: string;
  criteria: Array<{ name: string; value: string }>;
  /** The maker's picture of this catalogue part, shown straight from the catalogue's image server. */
  image: string | null;
  name: string | null;
  shop: ShopOffer[];
}
export type CarPartsAnswer =
  | { status: "unknown_car" | "unknown_category" }
  | { category: { id: number; name: string; path: string[] }; status: "choose_type"; types: CarPartType[] }
  | {
    brands: Array<{ count: number; name: string }>;
    catalogue: CarPartView[];
    category: { id: number; name: string; path: string[] };
    hasMore: boolean;
    ours: CarPartView[];
    page: number;
    status: "ok";
    total: number;
    truncated: boolean;
    type: CarPartType;
    types: CarPartType[];
  };

export function carCategories(modificationId: number, query: string | null): Promise<CarCatalogueAnswer> {
  return umapiGet<CarCatalogueAnswer>(`car/${modificationId}/categories${query ? `?q=${encodeURIComponent(query.slice(0, 80))}` : ""}`);
}

export function carParts(modificationId: number, input: { brand?: string | null; category: number; page?: number; type?: number | null }): Promise<CarPartsAnswer> {
  const parameters = new URLSearchParams({ category: String(input.category) });
  if (input.type) parameters.set("type", String(input.type));
  if (input.brand) parameters.set("brand", input.brand);
  if (input.page && input.page > 1) parameters.set("page", String(input.page));
  return umapiGet<CarPartsAnswer>(`car/${modificationId}/parts?${parameters.toString()}`);
}
