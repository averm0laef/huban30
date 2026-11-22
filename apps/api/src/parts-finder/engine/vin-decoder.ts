/**
 * VIN and Japanese chassis-number decoding. Port of vin_decoder.py.
 *
 * Local rules: the WMI manufacturer table and the AvtoVAZ (LADA) VIN
 * details of vininfo 2.0.0 (BSD-3-Clause). Other 17-character VINs are read
 * from NHTSA vPIC online (free, no key) because ultravin's offline vPIC
 * database has no JavaScript equivalent; results are cached by the caller.
 */

import { PartsFinderError } from "./errors.js";
import { WMI_MANUFACTURERS } from "./wmi-data.js";

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/u;
const CHASSIS_PATTERN = /^[A-Z0-9]{2,12}-[0-9]{4,10}$/u;
const CHECK_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const CHECK_VALUES: Readonly<Record<string, number>> = Object.fromEntries(
  [..."ABCDEFGHJKLMNPRSTUVWXYZ"].map((letter, index) => [letter, Number("12345678123457923456789"[index])]),
);
const YEAR_LETTERS = "ABCDEFGHJKLMNPRSTVWXY123456789";

// NHTSA's flat API names and its database variable names can differ.
const VPIC_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["make", ["Make"]],
  ["model", ["Model"]],
  ["model_year", ["ModelYear", "Model Year"]],
  ["trim", ["Trim"]],
  ["series", ["Series"]],
  ["body", ["BodyClass", "Body Class"]],
  ["vehicle_type", ["VehicleType", "Vehicle Type"]],
  ["doors", ["Doors"]],
  ["engine_cylinders", ["EngineCylinders", "Engine Number of Cylinders"]],
  ["engine_hp", ["EngineHP", "Engine Brake (hp) From"]],
  ["engine_model", ["EngineModel", "Engine Model"]],
  ["engine_configuration", ["EngineConfiguration", "Engine Configuration"]],
  ["displacement_l", ["DisplacementL", "Displacement (L)"]],
  ["fuel", ["FuelTypePrimary", "Fuel Type - Primary"]],
  ["transmission", ["TransmissionStyle", "Transmission Style"]],
  ["transmission_speeds", ["TransmissionSpeeds", "Transmission Speeds"]],
  ["drive", ["DriveType", "Drive Type"]],
  ["gvwr", ["GVWR", "Gross Vehicle Weight Rating From"]],
  ["plant_city", ["PlantCity", "Plant City"]],
  ["plant_state", ["PlantState", "Plant State"]],
  ["plant_country", ["PlantCountry", "Plant Country"]],
  ["manufacturer", ["Manufacturer", "Manufacturer Name"]],
];

// vininfo AvtoVazDetails: position in VDS (VIN[3..8]) or VIS (VIN[9..16]) -> value.
const AVTOVAZ: ReadonlyArray<readonly [field: string, section: "vds" | "vis", index: number, values: Readonly<Record<string, string>>]> = [
  ["body", "vds", 2, { B: "Hatchback", K: "Station Wagon", L: "Sedan" }],
  ["doors", "vds", 2, { B: "5", K: "5", L: "4" }],
  ["engine_model", "vds", 3, { "1": "21129", "2": "11189", "3": "21179", "4": "H4M", A: "21129 CNG" }],
  ["model", "vds", 1, { A: "XRAY", F: "Vesta" }],
  ["plant_city", "vis", 1, { "0": "Tolyatti", Y: "Izhevsk" }],
  ["transmission", "vds", 4, { "1": "Manual, 5-Gear (VAZ 21807)", "2": "Semi-automatic, 5-Gear (VAZ 21827)", "3": "Manual, 5-Gear (Renault JH3 514)" }],
];

export type Vehicle = Record<string, string | number | number[]>;

export interface VinResult {
  check_digit: string;
  source: string | null;
  status: string;
  vehicle: Vehicle;
  vin: string;
  vpic_error_codes?: number[];
  warnings: string[];
  wmi: string;
}

/** vPIC record loader; throws {@link VpicUnavailableError} when vPIC cannot answer. */
export type VpicLoader = (vin: string) => Promise<{ record: Record<string, unknown>; source: string }>;

export class VpicUnavailableError extends Error {
  constructor() {
    super("vPIC unavailable");
    this.name = "VpicUnavailableError";
  }
}

export function invalidVin(code: string, message: string): PartsFinderError {
  return new PartsFinderError(400, code, message);
}

export function normalizeChassis(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const candidate = raw.trim().replace(/[–—‑−]/gu, "-").replace(/\s*-\s*/gu, "-");
  if (/^[\x00-\x7F]*$/u.test(candidate) && CHASSIS_PATTERN.test(candidate.toUpperCase())) return candidate.toUpperCase();
  return null;
}

export function normalizeVin(raw: unknown, allowCheckPlaceholder = false): string {
  if (typeof raw !== "string" || !raw.trim()) throw invalidVin("invalid_vin", "Введите VIN.");
  const supplied = raw.trim();
  if (!/^[\x00-\x7F]*$/u.test(supplied)) throw invalidVin("invalid_vin", "Используйте латинские буквы и цифры.");
  const vin = supplied.toUpperCase();
  if (CHASSIS_PATTERN.test(vin)) {
    throw invalidVin("chassis_number", "Это номер шасси. Для его поиска нужна база номеров шасси этой марки.");
  }
  const validation = allowCheckPlaceholder && vin[8] === "?" ? `${vin.slice(0, 8)}0${vin.slice(9)}` : vin;
  if (!VIN_PATTERN.test(validation) || new Set(vin.replaceAll("?", "")).size === 1) {
    throw invalidVin("invalid_vin", "Введите 17 латинских букв и цифр без I, O и Q.");
  }
  return vin;
}

/** US check digit (49 CFR 565.15); `?` in position 9 asks for the expected digit. */
export function checkUsVin(raw: unknown) {
  if (normalizeChassis(raw)) {
    throw invalidVin("chassis_number", "Проверка контрольного символа США требует VIN из 17 символов.");
  }
  const vin = normalizeVin(raw, true);
  const total = [...vin].reduce((sum, char, index) => {
    const weight = CHECK_WEIGHTS[index]!;
    if (!weight) return sum;
    return sum + (/\d/u.test(char) ? Number(char) : CHECK_VALUES[char]!) * weight;
  }, 0);
  const digit = "0123456789X"[total % 11]!;
  const placeholder = vin[8] === "?";
  return {
    standard: "49 CFR 565.15",
    expected_check_digit: digit,
    actual_check_digit: placeholder ? null : vin[8]!,
    matches: placeholder ? null : vin[8] === digit,
    vin_with_check_digit: `${vin.slice(0, 8)}${digit}${vin.slice(9)}`,
  };
}

const EMPTY_VALUES = new Set(["", "-", "n/a", "not applicable", "not available", "null", "none", "unknown", "unsupportedbrand"]);

export function cleanValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return EMPTY_VALUES.has(text.toLowerCase()) ? null : text;
}

export function modelYear(value: string | null): number | null {
  return value && /^(?:19|20)[0-9]{2}$/u.test(value) ? Number(value) : null;
}

export function wmiManufacturer(vin: string): string | null {
  return WMI_MANUFACTURERS[vin.slice(0, 3)] ?? WMI_MANUFACTURERS[vin.slice(0, 2)] ?? null;
}

/** Possible model years from VIN position 10 (30-year cycle), newest first. */
export function vinYears(vin: string, now = new Date()): number[] {
  const delta = YEAR_LETTERS.indexOf(vin[9] ?? "");
  if (delta < 0) return [];
  const last = now.getUTCFullYear() + 1;
  const years = [1980 + delta];
  while (years.at(-1)! + YEAR_LETTERS.length <= last) years.push(years.at(-1)! + YEAR_LETTERS.length);
  return years.sort((a, b) => b - a);
}

export function decodeLocal(vin: string, now = new Date()): { vehicle: Vehicle; warnings: string[] } {
  const manufacturer = cleanValue(wmiManufacturer(vin));
  const vehicle: Vehicle = manufacturer ? { manufacturer } : {};
  const warnings: string[] = [];
  if (vin.startsWith("XTA")) {
    const sections = { vds: vin.slice(3, 9), vis: vin.slice(9, 17) };
    for (const [field, section, index, values] of AVTOVAZ) {
      const value = cleanValue(values[sections[section][index] ?? ""]);
      if (value) vehicle[field] = value;
    }
    vehicle.make = "LADA";
    if (vehicle.model) {
      let candidates = vinYears(vin, now).sort((a, b) => a - b);
      if (String(vehicle.model).toLowerCase() === "vesta") {
        // The LADA Izhevsk plant started production of Vesta in 2015.
        candidates = candidates.filter((year) => year >= 2015);
        if (candidates.length === 1) vehicle.model_year = candidates[0]!;
      }
      if (candidates.length > 0 && !("model_year" in vehicle)) vehicle.model_year_candidates = candidates;
      if (!("model_year" in vehicle)) warnings.push("model_year_unconfirmed");
    }
  }
  return { vehicle, warnings };
}

export function decodeVpic(raw: Record<string, unknown>): { check: string; codes: number[]; vehicle: Vehicle } {
  const vehicle: Vehicle = {};
  for (const [field, names] of VPIC_FIELDS) {
    for (const name of names) {
      const value = cleanValue(raw[name]);
      if (value) {
        vehicle[field] = value;
        break;
      }
    }
  }
  if ("model_year" in vehicle) {
    const year = modelYear(String(vehicle.model_year));
    delete vehicle.model_year;
    if (year) vehicle.model_year = year;
  }
  const codes = String(raw.ErrorCode ?? "").split(",").map((code) => code.trim()).filter((code) => /^[0-9]{1,3}$/u.test(code)).map(Number);
  const serious = codes.length === 0 || codes.some((code) => ![0, 1, 10, 14].includes(code));
  if (serious || !(vehicle.make && vehicle.model)) {
    // vPIC can return speculative models, years and defaults with an unmatched VIN.
    const identity: Vehicle = {};
    for (const key of ["make", "manufacturer"]) if (key in vehicle) identity[key] = vehicle[key]!;
    return { check: "not_assessed", codes, vehicle: identity };
  }
  return { check: codes.includes(1) ? "mismatch" : codes.includes(0) ? "match" : "not_assessed", codes, vehicle };
}

export async function decodeVin(raw: unknown, loadVpic: VpicLoader, now = new Date()): Promise<VinResult> {
  const vin = normalizeVin(raw);
  const local = decodeLocal(vin, now);
  const result: VinResult = {
    vin, wmi: vin.slice(0, 3), status: "partial", source: "vininfo",
    vehicle: local.vehicle, check_digit: "not_assessed", warnings: [...local.warnings],
  };
  if (vin.startsWith("XTA") && local.vehicle.model) {
    if (local.vehicle.model_year) result.status = "decoded";
    return result;
  }
  let loaded: Awaited<ReturnType<VpicLoader>>;
  try {
    loaded = await loadVpic(vin);
  } catch (error) {
    if (!(error instanceof VpicUnavailableError) || Object.keys(local.vehicle).length === 0) throw error;
    result.warnings.push("vpic_unavailable");
    return result;
  }
  const remote = decodeVpic(loaded.record);
  const hasRemote = Object.keys(remote.vehicle).length > 0;
  if (remote.vehicle.model || (hasRemote && !local.vehicle.model)) {
    Object.assign(result, { source: loaded.source, vehicle: remote.vehicle, check_digit: remote.check, vpic_error_codes: remote.codes });
    result.warnings = [];
    if (remote.check === "mismatch") result.warnings.push("check_digit_mismatch");
    if (remote.codes.length === 0 || remote.codes.some((code) => code !== 0 && code !== 1)) result.warnings.push("vpic_decode_warning");
    if (remote.vehicle.model && !remote.vehicle.model_year) result.warnings.push("model_year_unconfirmed");
    if (remote.vehicle.make && remote.vehicle.model && remote.vehicle.model_year && result.warnings.length === 0) result.status = "decoded";
  } else if (Object.keys(local.vehicle).length === 0) {
    Object.assign(result, { status: "no_data", source: null });
  } else if (!local.vehicle.model) {
    result.warnings.push("vpic_model_unavailable");
  }
  return result;
}
