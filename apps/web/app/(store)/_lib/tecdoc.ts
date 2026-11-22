/**
 * Browser client for the TecDoc-backed vehicle catalogue (apps/api/src/tecdoc)
 * and for the customer's garage. The catalogue answers only what the visitor
 * asks for; nothing here preloads or walks it.
 */

import { FinderError, PICKED_VEHICLE_EVENT, readPickedVehicle, savePickedVehicle, type PickedVehicle, type ShopOffer } from "./parts-finder";
import { apiRequest, StorefrontApiError } from "./storefront-api";

export interface TecdocIds { genId?: number; mfaId?: number; msId: number }
export interface CategoryNode { children: CategoryNode[]; id: number; name: string }
export interface CategoryMatch { id: number; leaf: boolean; name: string; path: string[] }
export interface CatalogPart {
  article: string; brand: string; criteria: Array<{ name: string; value: string }>; group: string | null; image: string | null;
  name: string; oems: Array<{ brand: string; number: string }>; shop: ShopOffer[];
}
export interface CarPartsResult { catalog: CatalogPart[] | null; catalogHasMore: boolean; checkedBrands: string[]; listedBrands: number; ours: CatalogPart[] }
export interface VinCandidate { engine: string; generation: string; make: string; model: string; tecdoc: { genId: number; mfaId?: number; msId?: number } }
export type FitmentVerdict = "fits" | "model" | "other_engine" | "not_listed";
export type ProductFitment =
  | { status: "not_applicable" | "not_found" | "unknown_part" }
  | {
    article: { brand: string; name: string; number: string };
    makes: Array<{ make: string; models: Array<{ generations: number | null; model: string; msId: number | null; series: string | null }> }>;
    oems: Array<{ brand: string; number: string }>;
    status: "ok";
    total: number;
    verdict: FitmentVerdict | null;
  };

const UNAVAILABLE = "Каталог автомобилей временно недоступен. Поиск по нашему каталогу работает.";

export async function tecdocGet<T>(path: string, parameters?: Record<string, string | number>): Promise<T> {
  const query = parameters ? `?${new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)])).toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/v1/tecdoc/${path}${query}`, { headers: { Accept: "application/json" } });
  } catch {
    throw new FinderError("Нет связи с сервером. Проверьте интернет и повторите.", null, 0);
  }
  let data: unknown = null;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const record = (data && typeof data === "object" ? data : {}) as { code?: unknown; error?: unknown };
    throw new FinderError(typeof record.error === "string" ? record.error : UNAVAILABLE, typeof record.code === "string" ? record.code : null, response.status);
  }
  if (!data || typeof data !== "object") throw new FinderError(UNAVAILABLE, null, response.status);
  return data as T;
}

let catalogSource: Promise<"tecdoc" | "local"> | null = null;

/** Which vehicle catalogue the site uses now; asked once per page. */
export function vehicleCatalogSource(): Promise<"tecdoc" | "local"> {
  catalogSource ??= fetch("/api/v1/parts-finder/status", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { catalog?: unknown } | null) => (data?.catalog === "tecdoc" ? "tecdoc" as const : "local" as const))
    .catch(() => "local" as const);
  return catalogSource;
}

/* ---------------- Garage (signed-in customers) ---------------- */

export interface GarageVehicle {
  catalog: { modelId: number; modificationId?: number } | null;
  createdAt: string;
  details: string | null;
  id: string;
  isPrimary: boolean;
  tecdoc: TecdocIds | null;
  title: string;
}

/** True when the browser holds a session (the CSRF cookie is readable; the session cookie is not). */
export function signedIn(): boolean {
  return typeof document !== "undefined" && /(?:^|;\s*)an30_csrf=/u.test(document.cookie);
}

export async function listGarage(): Promise<GarageVehicle[]> {
  try {
    return (await apiRequest<{ vehicles: GarageVehicle[] }>("/account/vehicles")).vehicles;
  } catch (error) {
    if (error instanceof StorefrontApiError && (error.status === 401 || error.status === 403)) return [];
    throw error;
  }
}

export function garageDraft(vehicle: PickedVehicle): { catalog?: { modelId: number; modificationId?: number }; details?: string; tecdoc?: TecdocIds; title: string } {
  const title = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.label;
  const details = [vehicle.generation, vehicle.engine].filter(Boolean).join(" · ");
  return {
    title: title.slice(0, 120),
    ...(details ? { details: details.slice(0, 200) } : {}),
    ...(vehicle.tecdoc ? { tecdoc: vehicle.tecdoc } : vehicle.modelId ? { catalog: { modelId: vehicle.modelId, ...(vehicle.modificationId ? { modificationId: vehicle.modificationId } : {}) } } : {}),
  };
}

export function addGarageVehicle(vehicle: PickedVehicle, primary = false): Promise<GarageVehicle> {
  return apiRequest<GarageVehicle>("/account/vehicles", { body: { ...garageDraft(vehicle), ...(primary ? { primary: true } : {}) }, method: "POST" });
}

export function removeGarageVehicle(id: string): Promise<unknown> {
  return apiRequest(`/account/vehicles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function makeGarageVehiclePrimary(id: string): Promise<GarageVehicle> {
  return apiRequest<GarageVehicle>(`/account/vehicles/${encodeURIComponent(id)}/primary`, { method: "PUT" });
}

/** A garage record as the car the site is shopping for. */
export function pickedFromGarage(vehicle: GarageVehicle): PickedVehicle {
  const [make, ...model] = vehicle.title.split(" ");
  const [generation, ...engine] = (vehicle.details ?? "").split(" · ").filter(Boolean);
  // "T21 · 1997–2002 · универсал · 2.0 л · 3S-FE": the engine starts at the part with litres.
  const parts = (vehicle.details ?? "").split(" · ").filter(Boolean);
  const engineAt = parts.findIndex((part) => /\d[.,]\d\s*л\b/u.test(part));
  return {
    label: [vehicle.title, vehicle.details].filter(Boolean).join(" · ").slice(0, 120),
    ...(make && model.length ? { make, model: model.join(" ") } : {}),
    ...(engineAt > 0 ? { engine: parts.slice(engineAt).join(" · "), generation: parts.slice(0, engineAt).join(" · ") }
      : generation ? { generation: [generation, ...engine].join(" · ") } : {}),
    ...(vehicle.tecdoc ? { tecdoc: vehicle.tecdoc } : {}),
    ...(vehicle.catalog ? { modelId: vehicle.catalog.modelId, ...(vehicle.catalog.modificationId ? { modificationId: vehicle.catalog.modificationId } : {}) } : {}),
  };
}

/**
 * The car the visitor shops for: the one picked on this device, or — for a
 * signed-in customer who picked none here — the main car of the garage.
 */
export async function activeCar(): Promise<PickedVehicle | null> {
  const local = readPickedVehicle();
  if (local || !signedIn()) return local;
  try {
    const main = (await listGarage()).find((vehicle) => vehicle.isPrimary);
    if (!main) return null;
    const picked = pickedFromGarage(main);
    savePickedVehicle(picked);
    return picked;
  } catch {
    return null;
  }
}

export function onActiveCarChange(listener: () => void): () => void {
  window.addEventListener(PICKED_VEHICLE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(PICKED_VEHICLE_EVENT, listener); window.removeEventListener("storage", listener); };
}
