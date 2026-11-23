/**
 * Reader of the UMAPI passenger-car file (cb_passenger_cars.csv) — the vehicle
 * catalog of the site (docs/UMAPI.md).
 *
 * The file is not a comma CSV: fields are separated by a colon, text is in
 * double quotes (a quote inside is doubled: "IR-9 ""Can-Am"""), an empty value
 * is a bare NULL. One row is one modification; its make and model repeat on
 * every row and are not always written the same way (a model named «SX4
 * седан» on ten rows and «SX4 Saloon» on one, an end date «1970-01-01» meaning
 * «unknown»), so a make and a model take the value most of their rows give.
 */

export interface CatalogMake { name: string; umapiId: number }

export interface CatalogModel {
  makeUmapiId: number;
  name: string;
  producedFrom: string | null;
  producedTo: string | null;
  series: string | null;
  shortName: string | null;
  umapiId: number;
  vehicleTypes: string[];
}

export interface CatalogModification {
  bodyType: string | null;
  brakeSystem: string | null;
  brakeType: string | null;
  capacityCc: number | null;
  capacityL: number | null;
  catalyst: string | null;
  countryId: number | null;
  cylinders: number | null;
  doors: number | null;
  driveType: string | null;
  engineType: string | null;
  fuelMixture: string | null;
  fuelType: string | null;
  gearType: string | null;
  hasAbs: boolean | null;
  hasAsr: boolean | null;
  modelUmapiId: number;
  name: string;
  powerKw: number | null;
  powerPs: number | null;
  producedFrom: string | null;
  producedTo: string | null;
  umapiId: number;
  valves: number | null;
  voltage: string | null;
}

export interface CatalogProblem { line: number; reason: string }

export interface VehicleCatalogFile {
  makes: CatalogMake[];
  models: CatalogModel[];
  modifications: CatalogModification[];
  problems: CatalogProblem[];
  /** Data rows read (the header not counted). */
  rows: number;
}

/** Columns the reader needs; the file has more, the rest are ignored. */
export const REQUIRED_COLUMNS = [
  "PCS_PC_ID", "PCS_COU_ID", "MFA_ID", "MFA_BRAND", "MS_ID", "MS_TYPE", "MS_CI_FROM", "MS_CI_TO", "MS_NAME_DES",
  "MS_SHORT_NAME1_DES", "MS_SHORT_NAME2_DES", "PC_MODEL_DES", "PCS_CI_FROM", "PCS_CI_TO", "PCS_POWER_KW", "PCS_POWER_PS",
  "PCS_CAPACITY_TECH", "PCS_CAPACITY_LT", "PCS_ABS", "PCS_ASR", "PCS_NUMBER_OF_VALVES", "PCS_NUMBER_OF_CYLINDERS",
  "PCS_ENGINE_TYPE", "PCS_BODY_TYPE", "PCS_GEAR_TYPE", "PCS_DRIVE_TYPE", "PCS_BRAKE_SYSTEM", "PCS_BRAKE_TYPE",
  "PCS_FUEL_TYPE", "PCS_CATALYSATOR_TYPE", "PCS_FUEL_MIXTURE", "PCS_NUMBER_OF_DOORS", "PCS_VOLTAGE",
] as const;

type Column = (typeof REQUIRED_COLUMNS)[number];

/**
 * One line of the file as its fields; `null` for NULL. Throws on a broken
 * line (an unclosed quote, garbage after a closing quote).
 */
export function parseCatalogLine(line: string): Array<string | null> {
  const fields: Array<string | null> = [];
  let index = 0;
  const length = line.length;
  for (;;) {
    if (line[index] === "\"") {
      let value = "";
      index += 1;
      for (;;) {
        const quote = line.indexOf("\"", index);
        if (quote === -1) throw new Error("unclosed quote");
        value += line.slice(index, quote);
        if (line[quote + 1] === "\"") {
          value += "\"";
          index = quote + 2;
          continue;
        }
        index = quote + 1;
        break;
      }
      fields.push(value);
    } else {
      const end = line.indexOf(":", index);
      const raw = end === -1 ? line.slice(index) : line.slice(index, end);
      // NULL or nothing is an empty value; a bare number is taken as written.
      fields.push(raw === "NULL" || raw === "" ? null : raw);
      index = end === -1 ? length : end;
    }
    if (index >= length) return fields;
    if (line[index] !== ":") throw new Error("text after a closing quote");
    index += 1;
    if (index === length) {
      fields.push(null);
      return fields;
    }
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** "2006-07-01" -> "2006-07-01"; anything else -> null. */
function date(value: string | null): string | null {
  if (!value) return null;
  const match = DATE.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const year = Number(match[1]);
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? value.trim() : null;
}

/** An end date before the start is the file's way of saying «unknown» (it writes 1970-01-01). */
function period(from: string | null, to: string | null): { from: string | null; to: string | null } {
  const start = date(from);
  const end = date(to);
  return { from: start, to: end !== null && start !== null && end < start ? null : end };
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^\d{1,10}$/u.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 2_147_483_647 ? number : null;
}

/** "66.0000" -> 66; "" / NULL / garbage -> null. */
function decimal(value: string | null, max: number): number | null {
  if (value === null || !/^\d{1,9}(?:\.\d+)?$/u.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function wholeNumber(value: string | null, max: number): number | null {
  const number = decimal(value, max);
  return number === null ? null : Math.round(number);
}

function text(value: string | null, max: number): string | null {
  const trimmed = value?.replace(/\s+/gu, " ").trim() ?? "";
  return trimmed ? trimmed.slice(0, max) : null;
}

function flag(value: string | null): boolean | null {
  return value === "1" ? true : value === "0" ? false : null;
}

/** Most frequent non-null value; ties go to the value seen first. */
class Votes<T extends string | number> {
  private readonly counts = new Map<T, number>();
  add(value: T | null) {
    if (value !== null) this.counts.set(value, (this.counts.get(value) ?? 0) + 1);
  }
  winner(): T | null {
    let best: T | null = null;
    let bestCount = 0;
    for (const [value, count] of this.counts) if (count > bestCount) { best = value; bestCount = count; }
    return best;
  }
}

interface ModelVotes {
  from: Votes<string>; make: Votes<number>; name: Votes<string>; series: Votes<string>; short: Votes<string>;
  to: Votes<string>; types: Set<string>;
}

/**
 * Reads the whole file. Rows that cannot be read (wrong number of fields, no
 * id, no name) are reported in `problems` with their line number and left
 * out; nothing is guessed.
 */
export function readVehicleCatalog(lines: Iterable<string>): VehicleCatalogFile {
  const problems: CatalogProblem[] = [];
  const makeNames = new Map<number, Votes<string>>();
  const models = new Map<number, ModelVotes>();
  const modifications = new Map<number, CatalogModification>();
  let header: string[] | null = null;
  let position: Record<Column, number> | null = null;
  let lineNumber = 0;
  let rows = 0;
  for (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.replace(/\r$/u, "").replace(/^\uFEFF/u, "");
    if (line.trim() === "") continue;
    if (header === null) {
      header = parseCatalogLine(line).map((name) => name ?? "");
      const missing = REQUIRED_COLUMNS.filter((name) => !header!.includes(name));
      if (missing.length > 0) throw new Error(`В файле нет колонок: ${missing.join(", ")}. Это не справочник легковых машин UMAPI.`);
      position = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, header!.indexOf(name)])) as Record<Column, number>;
      continue;
    }
    rows += 1;
    let fields: Array<string | null>;
    try {
      fields = parseCatalogLine(line);
    } catch (error) {
      problems.push({ line: lineNumber, reason: `строка не разбирается: ${error instanceof Error ? error.message : "ошибка"}` });
      continue;
    }
    if (fields.length !== header.length) {
      problems.push({ line: lineNumber, reason: `полей ${fields.length} вместо ${header.length}` });
      continue;
    }
    const get = (column: Column) => fields[position![column]] ?? null;
    const modificationId = positiveInteger(get("PCS_PC_ID"));
    const makeId = positiveInteger(get("MFA_ID"));
    const modelId = positiveInteger(get("MS_ID"));
    const makeName = text(get("MFA_BRAND"), 80);
    const modificationName = text(get("PC_MODEL_DES"), 120);
    if (!modificationId || !makeId || !modelId) {
      problems.push({ line: lineNumber, reason: "нет номера модификации, марки или модели" });
      continue;
    }
    if (!makeName || !modificationName) {
      problems.push({ line: lineNumber, reason: "нет названия марки или модификации" });
      continue;
    }
    if (modifications.has(modificationId)) {
      problems.push({ line: lineNumber, reason: `модификация ${modificationId} повторяется, взята первая` });
      continue;
    }

    const names = makeNames.get(makeId) ?? new Votes<string>();
    names.add(makeName);
    makeNames.set(makeId, names);

    const model = models.get(modelId) ?? {
      from: new Votes<string>(), make: new Votes<number>(), name: new Votes<string>(), series: new Votes<string>(),
      short: new Votes<string>(), to: new Votes<string>(), types: new Set<string>(),
    };
    const modelPeriod = period(get("MS_CI_FROM"), get("MS_CI_TO"));
    model.make.add(makeId);
    model.name.add(text(get("MS_NAME_DES"), 120));
    model.short.add(text(get("MS_SHORT_NAME1_DES"), 80));
    model.series.add(text(get("MS_SHORT_NAME2_DES"), 40));
    model.from.add(modelPeriod.from);
    // No end date is an answer too («still made»): it votes as "".
    model.to.add(modelPeriod.to ?? "");
    for (const type of (get("MS_TYPE") ?? "").split(",")) if (/^[A-Z-]{1,10}$/u.test(type.trim())) model.types.add(type.trim());
    models.set(modelId, model);

    const own = period(get("PCS_CI_FROM"), get("PCS_CI_TO"));
    modifications.set(modificationId, {
      bodyType: text(get("PCS_BODY_TYPE"), 80),
      brakeSystem: text(get("PCS_BRAKE_SYSTEM"), 80),
      brakeType: text(get("PCS_BRAKE_TYPE"), 80),
      capacityCc: wholeNumber(get("PCS_CAPACITY_TECH"), 100_000),
      capacityL: decimal(get("PCS_CAPACITY_LT"), 999),
      catalyst: text(get("PCS_CATALYSATOR_TYPE"), 120),
      countryId: (() => { const value = get("PCS_COU_ID"); return value !== null && /^\d{1,6}$/u.test(value) ? Number(value) : null; })(),
      cylinders: wholeNumber(get("PCS_NUMBER_OF_CYLINDERS"), 32_000),
      doors: wholeNumber(get("PCS_NUMBER_OF_DOORS"), 32_000),
      driveType: text(get("PCS_DRIVE_TYPE"), 80),
      engineType: text(get("PCS_ENGINE_TYPE"), 80),
      fuelMixture: text(get("PCS_FUEL_MIXTURE"), 120),
      fuelType: text(get("PCS_FUEL_TYPE"), 80),
      gearType: text(get("PCS_GEAR_TYPE"), 80),
      hasAbs: flag(get("PCS_ABS")),
      hasAsr: flag(get("PCS_ASR")),
      modelUmapiId: modelId,
      name: modificationName,
      powerKw: decimal(get("PCS_POWER_KW"), 99_999),
      powerPs: wholeNumber(get("PCS_POWER_PS"), 100_000),
      producedFrom: own.from,
      producedTo: own.to,
      umapiId: modificationId,
      valves: wholeNumber(get("PCS_NUMBER_OF_VALVES"), 32_000),
      voltage: text(get("PCS_VOLTAGE"), 40),
    });
  }
  if (header === null) throw new Error("Файл пустой.");

  const catalogModels: CatalogModel[] = [];
  const keptModels = new Set<number>();
  for (const [umapiId, votes] of models) {
    const makeUmapiId = votes.make.winner()!;
    const shortName = votes.short.winner();
    // Six models of the file have no name of their own: the model's short name stands for it.
    const name = votes.name.winner() ?? shortName;
    if (!name) {
      problems.push({ line: 0, reason: `у модели ${umapiId} нет названия, её модификации не загружены` });
      continue;
    }
    const from = votes.from.winner();
    const to = votes.to.winner() || null;
    catalogModels.push({
      makeUmapiId, name, producedFrom: from, producedTo: to !== null && from !== null && to < from ? null : to,
      series: votes.series.winner(), shortName, umapiId, vehicleTypes: [...votes.types].sort(),
    });
    keptModels.add(umapiId);
  }
  return {
    makes: [...makeNames].map(([umapiId, votes]) => ({ name: votes.winner()!, umapiId })),
    models: catalogModels,
    modifications: [...modifications.values()].filter((item) => keptModels.has(item.modelUmapiId)),
    problems,
    rows,
  };
}
