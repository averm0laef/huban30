/**
 * The shop's own fitment rows (port of local_fitment.py): CSV validation for
 * the import CLI and grouping of matching rows into vehicle variants.
 */

import { PartsFinderError } from "./errors.js";
import { ALIASES, words } from "./part-query.js";
import { variantId, type FitmentVariant, type ReferencePart } from "./vehicle-parts.js";

export const FITMENT_FIELDS = [
  "make", "model", "category", "configuration", "engine", "liters", "year_from", "year_to",
  "article", "brand", "oem", "source",
] as const;

export interface FitmentRow {
  article: string;
  brand: string;
  category: string;
  configuration: string;
  engine: string;
  liters: number | null;
  make: string;
  makeKey: string;
  model: string;
  modelKey: string;
  oem: boolean;
  source: string;
  yearFrom: number | null;
  yearTo: number | null;
}

export function lookupKey(value: string): string {
  return words(value).map((token) => ALIASES[token] ?? token).join(" ");
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF; a UTF-8 BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === "\"" && field === "") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV: незакрытая кавычка.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ""));
}

const INTEGER = /^-?\d+$/u;
const DECIMAL = /^\d+(?:\.\d+)?$/u;

/** Validates every row; any error names its line (header is line 1). Article text is kept as is (leading zeros). */
export function parseFitmentCsv(text: string, categories: ReadonlySet<string>): FitmentRow[] {
  const [header, ...records] = parseCsv(text);
  if (!header || header.join(",") !== FITMENT_FIELDS.join(",")) {
    throw new Error(`Нужны столбцы в таком порядке: ${FITMENT_FIELDS.join(",")}`);
  }
  const rows = records.map((cells, offset) => {
    const line = offset + 2;
    const fail = () => new Error(`Проверьте формат и обязательные поля в строке ${line}.`);
    if (cells.length !== FITMENT_FIELDS.length) throw fail();
    const data = Object.fromEntries(FITMENT_FIELDS.map((name, index) => [name, cells[index]!.trim()])) as Record<(typeof FITMENT_FIELDS)[number], string>;
    if (!["make", "model", "category", "configuration", "article", "brand", "source"].every((name) => data[name as keyof typeof data])
      || data.article.length > 64 || !categories.has(data.category)) throw fail();
    if ((data.year_from && !INTEGER.test(data.year_from)) || (data.year_to && !INTEGER.test(data.year_to))
      || (data.liters && !DECIMAL.test(data.liters))) throw fail();
    const yearFrom = data.year_from ? Number(data.year_from) : null;
    const yearTo = data.year_to ? Number(data.year_to) : null;
    const liters = data.liters ? Number(data.liters) : null;
    if (!["0", "1"].includes(data.oem) || (yearFrom && yearTo && yearFrom > yearTo) || (liters !== null && !(liters > 0 && liters < 30))) throw fail();
    return {
      article: data.article, brand: data.brand, category: data.category, configuration: data.configuration,
      engine: data.engine.toUpperCase(), liters, make: data.make, makeKey: lookupKey(data.make), model: data.model,
      modelKey: lookupKey(data.model), oem: data.oem === "1", source: data.source, yearFrom, yearTo,
    };
  });
  if (rows.length === 0) throw new Error("В CSV нет данных для импорта.");
  return rows;
}

/** All 1..4-word windows of the vehicle words: candidate make and model keys. */
export function vehicleKeys(tokens: readonly string[]): string[] {
  const keys = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    for (let size = 1; size <= 4 && index + size <= tokens.length; size += 1) keys.add(tokens.slice(index, index + size).join(" "));
  }
  return [...keys].sort();
}

/** Groups matching rows (already ordered by make, model, configuration, article) into variants. */
export function groupVariants(
  rows: readonly FitmentRow[], year: number | null, engine: string | null, liters: number | null,
): Map<number, FitmentVariant> {
  const groups = new Map<string, { fields: unknown[]; parts: Map<string, ReferencePart> }>();
  for (const row of rows) {
    if (year && ((row.yearFrom && year < row.yearFrom) || (row.yearTo && year > row.yearTo))) continue;
    if ((engine && row.engine !== engine) || (liters && (row.liters === null || Math.round(row.liters * 10) / 10 !== liters))) continue;
    const fields = [row.make, row.model, row.configuration, row.engine, row.liters, row.yearFrom, row.yearTo];
    const key = JSON.stringify(fields);
    const group = groups.get(key) ?? { fields, parts: new Map<string, ReferencePart>() };
    group.parts.set(`${row.brand}\u0000${row.article}`, {
      article: row.article, brand: row.brand, description: row.configuration, oem: row.oem, source: row.source,
    });
    groups.set(key, group);
  }
  const variants = new Map<number, FitmentVariant>();
  for (const { fields, parts } of groups.values()) {
    const [make, model, variant, code, capacity, start, end] = fields as [string, string, string, string, number | null, number | null, number | null];
    const id = variantId(fields);
    const years = start && end ? `${start}–${end}` : start ? `с ${start}` : end ? `до ${end}` : null;
    const label = [variant, capacity ? `${capacity} л` : null, code || null, years].filter(Boolean).join(" · ");
    variants.set(id, { id, label, parts: [...parts.values()], vehicle: `${make} ${model}` });
  }
  return variants;
}

export function fitmentUnavailable(): PartsFinderError {
  return new PartsFinderError(503, "local_fitment_unavailable", "Сейчас недоступен справочник магазина.");
}
