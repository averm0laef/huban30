/**
 * One entry for a VIN or a Japanese chassis number. Port of identify_vehicle
 * (proxy.py) and the VINROKU / API Ninjas adapters (external_vehicle.py).
 * Caches and the VINROKU quota live in a {@link VehicleStore}.
 */

import { PartsFinderError } from "./errors.js";
import { UpstreamStatusError, type RequestJson } from "./http.js";
import {
  VpicUnavailableError, cleanValue, decodeVin, modelYear, normalizeChassis, normalizeVin, type Vehicle, type VpicLoader,
} from "./vin-decoder.js";

export const VINROKU_URL = "https://vinroku.jp/api/v1/lookup";
export const NINJAS_URL = "https://api.api-ninjas.com/v1/vinlookup";
export const VPIC_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";

const VINROKU_TTL_SECONDS = 30 * 86_400;
const VPIC_TTL_SECONDS = 30 * 86_400;

export type VehicleCacheKind = "vinroku" | "vpic";

export interface VehicleStore {
  getCached(kind: VehicleCacheKind, identifier: string): Promise<unknown>;
  getQuota(provider: string): Promise<{ remaining: number; resetAt: number } | null>;
  putCached(kind: VehicleCacheKind, identifier: string, payload: unknown, ttlSeconds: number): Promise<void>;
  saveQuota(provider: string, limit: number | null, remaining: number, resetAt: number): Promise<void>;
}

export interface VehicleIdentityOptions {
  ninjasKey?: () => string | undefined;
  ninjasMode?: () => string;
  now?: () => number;
  requestJson: RequestJson;
  store: VehicleStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonnegative(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value >= 0 ? value : null;
  if (typeof value === "string" && /^[0-9]{1,12}$/u.test(value)) return Number(value);
  return null;
}

function sourceLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

export function chassisResult(chassis: string, payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || payload.ok !== true || payload.type !== "chassis") throw new Error("Invalid chassis payload");
  if (!isRecord(payload.query) || payload.query.normalized !== chassis) throw new Error("Chassis response refers to a different query");
  const matches = payload.matches;
  const references = payload.catalogReferences ?? [];
  if (!Array.isArray(matches) || !Array.isArray(references)) throw new Error("Invalid chassis result lists");
  const [chassisCode, serial] = chassis.split("-") as [string, string];
  const result: Record<string, unknown> & { matches: Array<Record<string, unknown>>; catalog_references: Array<Record<string, unknown>> } = {
    type: "chassis", chassis, source: "vinroku", matches: [], catalog_references: [], status: "no_data",
  };
  for (const match of matches) {
    if (!isRecord(match) || (match.chassisCode ?? chassisCode) !== chassisCode) continue;
    const manufacturer = cleanValue(match.manufacturer);
    const year = modelYear(cleanValue(match.productionYear));
    if (!manufacturer || !year) continue;
    const low = match.serialStartText;
    const high = match.serialEndText;
    if (low != null || high != null) {
      const lowValue = readNonnegative(low);
      const highValue = readNonnegative(high);
      if (lowValue === null || highValue === null || !(lowValue <= Number(serial) && Number(serial) <= highValue)) continue;
    }
    result.matches.push({
      manufacturer, production_year: year,
      registration_type: cleanValue(match.registrationType),
      serial_start: cleanValue(low), serial_end: cleanValue(high),
      publisher: cleanValue(match.publisher),
      source_url: sourceLink(match.sourceUrl),
      source_page: readNonnegative(match.sourcePage),
    });
  }
  for (const item of references) {
    if (!isRecord(item) || (item.chassisCode ?? chassisCode) !== chassisCode) continue;
    const name = cleanValue(item.model);
    const maker = cleanValue(item.manufacturer);
    if (!name || !maker) continue;
    const reference: Record<string, unknown> = { manufacturer: maker, model: name, disposition: cleanValue(item.disposition) };
    for (const field of ["engines", "drives", "gearboxes", "displacements", "fuels"]) {
      const values = item[field];
      if (Array.isArray(values)) reference[field] = values.map(cleanValue).filter((value): value is string => value !== null);
    }
    result.catalog_references.push(reference);
  }
  const possibilities = new Set(result.matches.map((match) => JSON.stringify([
    String(match.manufacturer).toLowerCase(), match.production_year, String(match.registration_type ?? "").toLowerCase(),
  ])));
  if (possibilities.size > 0) result.status = possibilities.size > 1 ? "ambiguous" : "matched";
  else if (result.catalog_references.length > 0) result.status = "partial";
  return result;
}

export class VehicleIdentity {
  constructor(private readonly options: VehicleIdentityOptions) {}

  private now(): number {
    return (this.options.now ?? (() => Date.now() / 1000))();
  }

  /** VIN (17 characters) or chassis number ("MXPH14-0036630"). */
  async identify(raw: unknown): Promise<Record<string, unknown>> {
    const chassis = normalizeChassis(raw);
    if (chassis) return this.lookupChassis(chassis);
    const vin = normalizeVin(raw);
    let vpicUnavailable = false;
    let result: Record<string, unknown> & { vehicle: Vehicle; warnings: string[] };
    try {
      result = { ...(await decodeVin(vin, this.loadVpic)) };
    } catch (error) {
      if (!(error instanceof VpicUnavailableError)) throw error;
      vpicUnavailable = true;
      result = { vin, wmi: vin.slice(0, 3), status: "no_data", source: null, vehicle: {}, check_digit: "not_assessed", warnings: [] };
    }
    if (result.vehicle.model || vin.startsWith("XTA")) return result;
    let fallback: Vehicle = {};
    try {
      fallback = await this.ninjas(vin);
    } catch (error) {
      if (!(error instanceof PartsFinderError)) throw error;
      result.warnings.push(error.code);
    }
    if (Object.keys(fallback).length > 0) {
      const existing = String(result.vehicle.make ?? "").toLowerCase();
      if (!existing || existing === String(fallback.manufacturer).toLowerCase()) {
        return {
          vin, wmi: vin.slice(0, 3), source: "api_ninjas", vehicle: fallback,
          status: "partial", check_digit: "not_assessed", warnings: ["api_ninjas_partial"],
        };
      }
      result.warnings.push("provider_make_conflict");
    }
    if (vpicUnavailable) throw new PartsFinderError(503, "vpic_unavailable", "База vPIC сейчас недоступна.");
    return result;
  }

  /** NHTSA vPIC online, cached for 30 days (decoded VIN data does not change). */
  readonly loadVpic: VpicLoader = async (vin) => {
    const cached = await this.options.store.getCached("vpic", vin).catch(() => undefined);
    if (isRecord(cached)) return { record: cached, source: "nhtsa_vpic_online" };
    let record: unknown;
    try {
      const response = await this.options.requestJson(`${VPIC_URL}${vin}?format=json`, { timeoutMs: 8_000 });
      record = isRecord(response.data) && Array.isArray(response.data.Results) ? response.data.Results[0] : undefined;
    } catch {
      throw new VpicUnavailableError();
    }
    if (!isRecord(record)) throw new VpicUnavailableError();
    await this.options.store.putCached("vpic", vin, record, VPIC_TTL_SECONDS).catch(() => undefined);
    return { record, source: "nhtsa_vpic_online" };
  };

  private async lookupChassis(chassis: string): Promise<Record<string, unknown>> {
    let failure: PartsFinderError | null = null;
    let result: Record<string, unknown>;
    try {
      result = await this.vinroku(chassis);
    } catch (error) {
      if (!(error instanceof PartsFinderError)) throw error;
      failure = error;
      result = { type: "chassis", chassis, status: "no_data" };
    }
    const matches = result.matches;
    const references = result.catalog_references;
    if ((Array.isArray(matches) && matches.length > 0) || (Array.isArray(references) && references.length > 0)) return result;
    let fallback: Vehicle;
    try {
      fallback = await this.ninjas(chassis);
    } catch (error) {
      if (!(error instanceof PartsFinderError)) throw error;
      if (failure) throw failure;
      return { ...result, warnings: [error.code] };
    }
    if (Object.keys(fallback).length > 0) return { type: "chassis", chassis, source: "api_ninjas", status: "partial", vehicle: fallback };
    if (failure) throw failure;
    return result;
  }

  private async vinroku(chassis: string): Promise<Record<string, unknown>> {
    const { store } = this.options;
    const cached = await store.getCached("vinroku", chassis).catch(() => undefined);
    if (isRecord(cached)) return { ...cached, cached: true };
    const quota = await store.getQuota("vinroku").catch(() => null);
    if (quota && quota.remaining === 0 && quota.resetAt > this.now()) {
      throw new PartsFinderError(429, "vinroku_rate_limited", "Дневной лимит VINROKU исчерпан.");
    }
    let result: Record<string, unknown>;
    try {
      const response = await this.options.requestJson(`${VINROKU_URL}?${new URLSearchParams({ q: chassis }).toString()}`, { timeoutMs: 6_000 });
      await this.recordQuota(response.headers);
      result = chassisResult(chassis, response.data);
    } catch (error) {
      if (error instanceof UpstreamStatusError) {
        if (error.status === 429) {
          await this.recordQuota(error.headers, true);
          throw new PartsFinderError(429, "vinroku_rate_limited", "Дневной лимит VINROKU исчерпан.");
        }
        throw new PartsFinderError(502, "vinroku_http_error", "VINROKU не принял запрос.");
      }
      throw new PartsFinderError(502, "vinroku_unavailable", "VINROKU сейчас недоступен.");
    }
    await store.putCached("vinroku", chassis, result, VINROKU_TTL_SECONDS).catch(() => undefined);
    return { ...result, cached: false };
  }

  private async recordQuota(headers: Record<string, string>, exhausted = false): Promise<void> {
    const limit = readNonnegative(headers["ratelimit-limit"]);
    const remaining = exhausted ? 0 : readNonnegative(headers["ratelimit-remaining"]);
    if (remaining === null) return;
    const now = Math.floor(this.now());
    let reset = readNonnegative(headers["ratelimit-reset"]);
    if (reset === null || reset <= now) reset = (Math.floor(now / 86_400) + 1) * 86_400;
    await this.options.store.saveQuota("vinroku", limit, remaining, reset).catch(() => undefined);
  }

  /** Optional paid fallback; off unless API_NINJAS_MODE is demo/commercial and a key is set. Never cached. */
  private async ninjas(identifier: string): Promise<Vehicle> {
    const mode = (this.options.ninjasMode?.() ?? "off").trim().toLowerCase();
    const key = this.options.ninjasKey?.()?.trim();
    if (!["demo", "commercial"].includes(mode) || !key) return {};
    let raw: unknown;
    try {
      raw = (await this.options.requestJson(`${NINJAS_URL}?${new URLSearchParams({ vin: identifier }).toString()}`, {
        headers: { "X-Api-Key": key }, timeoutMs: 5_000,
      })).data;
    } catch (error) {
      const code = error instanceof UpstreamStatusError && error.status === 429 ? "api_ninjas_rate_limited" : "api_ninjas_unavailable";
      throw new PartsFinderError(502, code, "API Ninjas сейчас недоступен.");
    }
    if (!isRecord(raw) || raw.error) throw new PartsFinderError(502, "api_ninjas_unavailable", "API Ninjas вернул нераспознанный ответ.");
    const returned = cleanValue(raw.vin);
    if (!returned || returned.toUpperCase() !== identifier) return {};
    const manufacturer = cleanValue(raw.manufacturer || raw.make);
    const model = cleanValue(raw.model);
    if (!manufacturer || !model) return {};
    const fields: Vehicle = { manufacturer, model };
    const year = modelYear(cleanValue(raw.year));
    if (year) fields.model_year = year;
    const body = cleanValue(raw.class);
    if (body) fields.body = body;
    const country = cleanValue(raw.country);
    if (country) fields.manufacture_country = country;
    return fields;
  }
}
