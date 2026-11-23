/**
 * How the UMAPI vehicle catalog (app.vehicle_catalog_*, docs/UMAPI.md) is
 * shown in the picker: readable make and model names, the model as people
 * call it, the engine line. Pure functions; the service reads the tables.
 */
import { normalizeBrand } from "@an30/contracts";

import { parseModelName } from "./engine/model-name.js";
import { VEHICLE_SEED, slugify, type SeedMake } from "./engine/vehicle-seed.js";

/**
 * Ids of this catalog start here (migration 0056): an id below it is a car
 * picked in the former list (app.parts_finder_vehicle_*) before the switch.
 */
export const CATALOG_ID_BASE = 100_000_001;

export function isCatalogId(id: number | undefined): boolean {
  return id !== undefined && id >= CATALOG_ID_BASE;
}

// The catalog writes some makes differently from the shop's own list.
const BRAND_ALIASES: Readonly<Record<string, string>> = { VW: "VOLKSWAGEN" };
const SEED_BY_KEY = new Map(VEHICLE_SEED.map((seed) => [normalizeBrand(seed.name), seed]));

export function seedFor(name: string): SeedMake | undefined {
  const key = normalizeBrand(name);
  return SEED_BY_KEY.get(BRAND_ALIASES[key] ?? key);
}

/** "ALFA ROMEO" -> "Alfa Romeo", "LAND CRUISER PRADO" -> "Land Cruiser Prado"; short words stay capitals (BMW, II, FX). */
export function prettyName(name: string): string {
  return name.trim().replace(/[A-Za-zА-Яа-яЁё]+/gu, (word) => (word.length <= 3 ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1).toLowerCase()));
}

export interface CatalogPickerMake { country: string | null; id: number; name: string; nameRu: string | null; slug: string }

export interface MakeRowLike { id: number; name: string; umapi_id: number }

/**
 * Picker makes: the shop's own name, Russian name and country for the makes
 * it knows (vehicle-seed.ts), a readable name for the rest. Slugs are unique:
 * a second make with the same slug gets its catalog number appended.
 */
export function makeViews(rows: readonly MakeRowLike[]): Array<CatalogPickerMake & { known: boolean; rank: number | null }> {
  const used = new Set<string>();
  return [...rows].sort((a, b) => a.umapi_id - b.umapi_id).map((row) => {
    const seed = seedFor(row.name);
    const name = seed?.name ?? prettyName(row.name);
    let slug = (seed?.slug ?? slugify(name)).slice(0, 50);
    if (used.has(slug)) slug = `${slug}-${row.umapi_id}`;
    used.add(slug);
    return { country: seed?.country ?? null, id: row.id, known: seed !== undefined, name, nameRu: seed?.nameRu ?? null, rank: seed?.rank ?? null, slug };
  });
}

function startsWithWord(text: string, prefix: string): boolean {
  const lower = text.toLowerCase();
  const head = prefix.toLowerCase();
  return lower === head || lower.startsWith(`${head} `) || lower.startsWith(`${head}(`);
}

const familyKey = (value: string) => value.toLowerCase().replace(/[\s-]+/gu, "");

/**
 * The model a catalog generation belongs to, as people say it. The catalog's
 * short name is right most of the time («COROLLA», «PROBOX / SUCCEED»); where
 * the shop's own list knows a shorter family that the short name starts with
 * («LAND CRUISER 80» -> «Land Cruiser»), the family wins and «80» becomes
 * part of the generation.
 */
export function familyOf(name: string, shortName: string | null, seedModels: readonly string[]): string | null {
  const seed = seedModels.filter((family) => startsWithWord(name, family)).sort((a, b) => b.length - a.length)[0];
  const short = shortName?.trim() || null;
  if (short && startsWithWord(name, short)) {
    if (short.includes("/")) return short;
    if (seed && seed.length >= short.length) return seed;
    // «LAND CRUISER 80» is a Land Cruiser; «COROLLA CROSS» and «COROLLA VERSO» are models of their own.
    if (seed && startsWithWord(short, seed) && /^(?:\d+|[IVX]{1,4})$/u.test(short.slice(seed.length).trim())) return seed;
    return short;
  }
  return seed ?? null;
}

export interface CatalogPickerModel {
  body: string | null;
  /** «E12», «ZVG1, ZSG1»: the body code from the catalog name, without its «_» marks. */
  bodyCode: string | null;
  family: string;
  fapi: true;
  generation: string | null;
  id: number;
  name: string;
  /** «Verso», «III», «80»: what tells this generation apart besides its body code. */
  series: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface ModelRowLike {
  id: number; make_id: number; name: string; produced_from: Date | string | null; produced_to: Date | string | null; short_name: string | null;
}

export function yearOf(value: Date | string | null): number | null {
  if (value === null) return null;
  const year = value instanceof Date ? value.getFullYear() : Number(String(value).slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : null;
}

export function modelView(row: ModelRowLike, seedModels: readonly string[]): CatalogPickerModel {
  const family = familyOf(row.name, row.short_name, seedModels);
  const parsed = parseModelName(row.name, family ? [family] : []);
  const shown = seedModels.find((seed) => familyKey(seed) === familyKey(parsed.family)) ?? prettyName(parsed.family);
  const open = row.name.indexOf("(");
  const bodyCode = (open === -1 ? "" : row.name.slice(open + 1).replace(/\)\s*$/u, ""))
    .split(",").map((code) => code.replace(/_/gu, "").trim()).filter(Boolean).join(", ") || null;
  const generation = parsed.generation ?? "";
  const series = (bodyCode && generation.endsWith(bodyCode) ? generation.slice(0, -bodyCode.length) : generation).replace(/\s*·\s*$/u, "").trim() || null;
  return {
    body: parsed.body, bodyCode, family: shown, fapi: true, generation: parsed.generation, id: row.id, name: row.name,
    series: series ? prettyName(series) : null, yearFrom: yearOf(row.produced_from), yearTo: yearOf(row.produced_to),
  };
}

export interface CatalogPickerModification {
  body: string | null;
  capacity: string | null;
  drive: string | null;
  engine: string | null;
  fuel: string | null;
  id: number;
  label: string;
  name: string;
  powerPs: number | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface ModificationRowLike {
  body_type: string | null; capacity_l: string | number | null; drive_type: string | null; fuel_type: string | null; id: number; name: string;
  power_ps: number | null; produced_from: Date | string | null; produced_to: Date | string | null;
}

/** Engine codes in a modification name: «1.4 (L08, L68)» -> L08, L68. A word without a digit («Ecotronic») is not a code. */
export function engineCodes(name: string): string[] {
  const inside = /\(([^)]*)\)/u.exec(name)?.[1] ?? "";
  return inside.split(",").map((code) => code.trim()).filter((code) => /\d/u.test(code) && /^[A-Z0-9][A-Z0-9 ./-]{0,15}$/iu.test(code));
}

/** «1.4 (L08, L68)» -> «1.4 л (L08, L68)»: a bare capacity reads as litres. */
export function modificationName(name: string): string {
  return name.replace(/^(\d{1,2}[.,]\d)(?=$|\s|\()(?!\s*л)/u, "$1 л").replace(/\s+\(/u, " (")
    // «(ZZE120_, ZZE120R)»: the catalog's «_» marks are noise to a customer.
    .replace(/\(([^)]*)\)/u, (_whole, inside: string) => `(${inside.replace(/_/gu, "").replace(/\s*,\s*/gu, ", ").trim()})`);
}

const DRIVE: Readonly<Record<string, string>> = {
  "Привод на все колеса": "полный привод",
  "Привод на задние колеса": "задний привод",
  "Привод на передние колеса": "передний привод",
};

function lowerFirst(value: string | null): string | null {
  return value ? value[0]!.toLowerCase() + value.slice(1) : null;
}

export function modificationView(row: ModificationRowLike): CatalogPickerModification {
  const capacity = row.capacity_l === null || row.capacity_l === "" ? null : Number(row.capacity_l);
  const fuel = lowerFirst(row.fuel_type);
  const name = modificationName(row.name);
  const codes = engineCodes(row.name);
  return {
    body: row.body_type,
    capacity: capacity !== null && Number.isFinite(capacity) && capacity > 0 ? capacity.toFixed(1) : null,
    drive: row.drive_type ? DRIVE[row.drive_type] ?? lowerFirst(row.drive_type) : null,
    engine: codes.slice(0, 3).join(", ") || null,
    fuel,
    id: row.id,
    label: [name, row.power_ps ? `${row.power_ps} л.с.` : null, fuel].filter(Boolean).join(" · "),
    name,
    powerPs: row.power_ps,
    yearFrom: yearOf(row.produced_from),
    yearTo: yearOf(row.produced_to),
  };
}

/** Engines by volume, then power, then the first year: the order a customer reads a list of engines in. */
export function sortModifications(list: CatalogPickerModification[]): CatalogPickerModification[] {
  return [...list].sort((a, b) => (a.capacity ?? "").localeCompare(b.capacity ?? "", "en", { numeric: true })
    || (a.powerPs ?? 0) - (b.powerPs ?? 0) || (a.yearFrom ?? 0) - (b.yearFrom ?? 0) || a.name.localeCompare(b.name, "ru"));
}
