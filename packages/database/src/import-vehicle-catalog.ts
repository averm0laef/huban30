/**
 * Loads the UMAPI passenger-car catalog into app.vehicle_catalog_* (docs/UMAPI.md).
 *
 *   node packages/database/dist/import-vehicle-catalog.js local-data/umapi/cb_passenger_cars.csv [--dry-run] [--allow-retire]
 *
 * --dry-run       reads the file and prints what it holds; the database is not touched.
 * --allow-retire  lets a file hide more than 10% of the catalog (a smaller new edition).
 *
 * Everything goes in one transaction: a broken file changes nothing. Loading
 * the same file again changes nothing either; a record missing from a new
 * file is hidden (is_active = false), never deleted.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client, type ClientBase } from "pg";

import { getDatabaseConfig } from "./config.js";
import { log } from "./logger.js";
import { readVehicleCatalog, type CatalogModel, type CatalogModification, type VehicleCatalogFile } from "./vehicle-catalog-csv.js";

/** A file with fewer modifications than this is not the catalog (a cut or wrong file). */
export const MIN_MODIFICATIONS = 1_000;
/** Share of the shown catalog a new file may hide without --allow-retire. */
export const MAX_RETIRE_SHARE = 0.1;
const CHUNK = 2_000;

export interface TableChanges { added: number; changed: number; retired: number }
export interface ImportChanges { makes: TableChanges; models: TableChanges; modifications: TableChanges }

/** Why a run must stop before it commits; null when it may. */
export function retireRefusal(active: number, retired: number, allowRetire: boolean): string | null {
  if (allowRetire || active === 0) return null;
  return retired / active > MAX_RETIRE_SHARE
    ? `Новый файл скрыл бы ${retired} из ${active} модификаций (больше ${Math.round(MAX_RETIRE_SHARE * 100)}%). Проверьте файл; если так и задумано — запустите с --allow-retire.`
    : null;
}

function chunks<T>(list: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < list.length; index += CHUNK) result.push(list.slice(index, index + CHUNK));
  return result;
}

async function upsert(client: ClientBase, sql: string, items: readonly unknown[]): Promise<{ added: number; changed: number }> {
  let added = 0;
  let changed = 0;
  for (const part of chunks(items)) {
    const result = await client.query<{ inserted: boolean }>(sql, [JSON.stringify(part)]);
    for (const row of result.rows) if (row.inserted) added += 1; else changed += 1;
  }
  return { added, changed };
}

async function retire(client: ClientBase, table: string, ids: readonly number[]): Promise<number> {
  const result = await client.query(
    `UPDATE app.${table} SET is_active = false, updated_at = clock_timestamp() WHERE is_active AND NOT (umapi_id = ANY($1::int[]))`,
    [ids],
  );
  return result.rowCount ?? 0;
}

const MAKES_SQL = `
  INSERT INTO app.vehicle_catalog_makes AS target (umapi_id, name)
  SELECT item.umapi_id, item.name FROM jsonb_to_recordset($1::jsonb) AS item(umapi_id integer, name text)
  ON CONFLICT (umapi_id) DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = clock_timestamp()
  WHERE (target.name, target.is_active) IS DISTINCT FROM (EXCLUDED.name, true)
  RETURNING (xmax = 0) AS inserted`;

const MODELS_SQL = `
  INSERT INTO app.vehicle_catalog_models AS target (make_id, umapi_id, name, short_name, series, vehicle_types, produced_from, produced_to)
  SELECT make.id, item.umapi_id, item.name, item.short_name, item.series, item.vehicle_types, item.produced_from, item.produced_to
  FROM jsonb_to_recordset($1::jsonb) AS item(
    make_umapi_id integer, umapi_id integer, name text, short_name text, series text, vehicle_types text[], produced_from date, produced_to date)
  JOIN app.vehicle_catalog_makes AS make ON make.umapi_id = item.make_umapi_id
  ON CONFLICT (umapi_id) DO UPDATE SET make_id = EXCLUDED.make_id, name = EXCLUDED.name, short_name = EXCLUDED.short_name,
    series = EXCLUDED.series, vehicle_types = EXCLUDED.vehicle_types, produced_from = EXCLUDED.produced_from,
    produced_to = EXCLUDED.produced_to, is_active = true, updated_at = clock_timestamp()
  WHERE (target.make_id, target.name, target.short_name, target.series, target.vehicle_types, target.produced_from, target.produced_to, target.is_active)
    IS DISTINCT FROM (EXCLUDED.make_id, EXCLUDED.name, EXCLUDED.short_name, EXCLUDED.series, EXCLUDED.vehicle_types,
      EXCLUDED.produced_from, EXCLUDED.produced_to, true)
  RETURNING (xmax = 0) AS inserted`;

const MODIFICATION_COLUMNS = [
  "name", "produced_from", "produced_to", "power_kw", "power_ps", "capacity_cc", "capacity_l", "cylinders", "valves", "doors",
  "engine_type", "body_type", "drive_type", "gear_type", "fuel_type", "fuel_mixture", "catalyst", "brake_system", "brake_type",
  "voltage", "has_abs", "has_asr", "country_id",
] as const;

const MODIFICATION_TYPES: Record<(typeof MODIFICATION_COLUMNS)[number], string> = {
  body_type: "text", brake_system: "text", brake_type: "text", capacity_cc: "integer", capacity_l: "numeric", catalyst: "text",
  country_id: "integer", cylinders: "smallint", doors: "smallint", drive_type: "text", engine_type: "text", fuel_mixture: "text",
  fuel_type: "text", gear_type: "text", has_abs: "boolean", has_asr: "boolean", name: "text", power_kw: "numeric", power_ps: "integer",
  produced_from: "date", produced_to: "date", valves: "smallint", voltage: "text",
};

const MODIFICATIONS_SQL = `
  INSERT INTO app.vehicle_catalog_modifications AS target (model_id, umapi_id, ${MODIFICATION_COLUMNS.join(", ")})
  SELECT model.id, item.umapi_id, ${MODIFICATION_COLUMNS.map((column) => `item.${column}`).join(", ")}
  FROM jsonb_to_recordset($1::jsonb) AS item(model_umapi_id integer, umapi_id integer,
    ${MODIFICATION_COLUMNS.map((column) => `${column} ${MODIFICATION_TYPES[column]}`).join(", ")})
  JOIN app.vehicle_catalog_models AS model ON model.umapi_id = item.model_umapi_id
  ON CONFLICT (umapi_id) DO UPDATE SET model_id = EXCLUDED.model_id,
    ${MODIFICATION_COLUMNS.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}, is_active = true, updated_at = clock_timestamp()
  WHERE (target.model_id, ${MODIFICATION_COLUMNS.map((column) => `target.${column}`).join(", ")}, target.is_active)
    IS DISTINCT FROM (EXCLUDED.model_id, ${MODIFICATION_COLUMNS.map((column) => `EXCLUDED.${column}`).join(", ")}, true)
  RETURNING (xmax = 0) AS inserted`;

function modelRow(model: CatalogModel) {
  return {
    make_umapi_id: model.makeUmapiId, name: model.name, produced_from: model.producedFrom, produced_to: model.producedTo,
    series: model.series, short_name: model.shortName, umapi_id: model.umapiId, vehicle_types: model.vehicleTypes,
  };
}

function modificationRow(item: CatalogModification) {
  return {
    body_type: item.bodyType, brake_system: item.brakeSystem, brake_type: item.brakeType, capacity_cc: item.capacityCc,
    capacity_l: item.capacityL === null ? null : Math.round(item.capacityL * 10) / 10, catalyst: item.catalyst, country_id: item.countryId,
    cylinders: item.cylinders, doors: item.doors, drive_type: item.driveType, engine_type: item.engineType, fuel_mixture: item.fuelMixture,
    fuel_type: item.fuelType, gear_type: item.gearType, has_abs: item.hasAbs, has_asr: item.hasAsr, model_umapi_id: item.modelUmapiId,
    name: item.name, power_kw: item.powerKw === null ? null : Math.round(item.powerKw * 10) / 10, power_ps: item.powerPs,
    produced_from: item.producedFrom, produced_to: item.producedTo, umapi_id: item.umapiId, valves: item.valves, voltage: item.voltage,
  };
}

/** Writes the read file in one transaction; rolls back when the guard refuses. */
export async function writeVehicleCatalog(
  client: ClientBase,
  file: VehicleCatalogFile,
  meta: { allowRetire: boolean; fileName: string; sha256: string; startedAt: Date },
): Promise<ImportChanges> {
  await client.query("BEGIN");
  try {
    const before = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM app.vehicle_catalog_modifications WHERE is_active");
    const activeBefore = Number(before.rows[0]?.count ?? 0);
    const makes = await upsert(client, MAKES_SQL, file.makes.map((make) => ({ name: make.name, umapi_id: make.umapiId })));
    const models = await upsert(client, MODELS_SQL, file.models.map(modelRow));
    const modifications = await upsert(client, MODIFICATIONS_SQL, file.modifications.map(modificationRow));
    const changes: ImportChanges = {
      makes: { ...makes, retired: await retire(client, "vehicle_catalog_makes", file.makes.map((make) => make.umapiId)) },
      models: { ...models, retired: await retire(client, "vehicle_catalog_models", file.models.map((model) => model.umapiId)) },
      modifications: { ...modifications, retired: await retire(client, "vehicle_catalog_modifications", file.modifications.map((item) => item.umapiId)) },
    };
    const refusal = retireRefusal(activeBefore, changes.modifications.retired, meta.allowRetire);
    if (refusal) throw new Error(refusal);
    await client.query(
      `INSERT INTO app.vehicle_catalog_imports (source, file_name, file_sha256, rows_total, rows_rejected, changes, started_at)
       VALUES ('umapi', $1, $2, $3, $4, $5::jsonb, $6)`,
      [meta.fileName.slice(0, 255), meta.sha256, file.rows, file.problems.length, JSON.stringify(changes), meta.startedAt],
    );
    await client.query("COMMIT");
    return changes;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(argv: string[]): Promise<void> {
  const flags = new Set(argv.filter((value) => value.startsWith("--")));
  const unknown = [...flags].filter((value) => value !== "--dry-run" && value !== "--allow-retire");
  const files = argv.filter((value) => !value.startsWith("--"));
  if (files.length !== 1 || unknown.length > 0) {
    throw new Error("Использование: node dist/import-vehicle-catalog.js <путь к cb_passenger_cars.csv> [--dry-run] [--allow-retire]");
  }
  const filePath = path.resolve(files[0]!);
  const startedAt = new Date();
  const bytes = readFileSync(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = readVehicleCatalog(bytes.toString("utf8").split("\n"));
  const summary = {
    file: path.basename(filePath), makes: file.makes.length, models: file.models.length, modifications: file.modifications.length,
    rejected: file.problems.length, rows: file.rows, sha256,
  };
  log("info", "vehicle_catalog.read", { ...summary, problems: file.problems.slice(0, 20) });
  if (file.modifications.length < MIN_MODIFICATIONS) {
    throw new Error(`В файле ${file.modifications.length} модификаций — это не полный справочник. Ничего не загружено.`);
  }
  if (flags.has("--dry-run")) {
    log("info", "vehicle_catalog.dry_run", { note: "База не изменялась." });
    return;
  }
  const config = getDatabaseConfig();
  const client = new Client({ application_name: "an30-vehicle-catalog-import", connectionString: config.connectionString, ssl: config.ssl });
  await client.connect();
  try {
    const changes = await writeVehicleCatalog(client, file, { allowRetire: flags.has("--allow-retire"), fileName: path.basename(filePath), sha256, startedAt });
    log("info", "vehicle_catalog.imported", { changes, file: summary.file, seconds: Math.round((Date.now() - startedAt.getTime()) / 1000) });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    log("error", "vehicle_catalog.failed", { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
