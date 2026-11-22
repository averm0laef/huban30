/**
 * Text lookup for vehicle parts with a verified local Probox reference, the
 * shop's own fitment table and the metered FAPI catalogue walk.
 * Port of vehicle_parts.py (guided flow) from the owner's module.
 *
 * Statuses: choose (pick `field` from `options`), confirm (paid lookup ahead),
 * reference (local data), found (FAPI list), article (a part number),
 * need_detail / need_vehicle (ask for more), no_data.
 * The Autodoc "keyword" branch of the original is not part of v1.
 */

import { createHash } from "node:crypto";

import { PartsFinderError } from "./errors.js";
import { partRef, type FapiGateway, type FapiPart } from "./fapi.js";
import {
  ALIASES, EMPTY_VOCABULARY, MAKES, articleCandidate, categoryMatches, findCapacity, findEngine, findYears, isChassisCode,
  normalizeQuery, stripEngineAndCapacity, titleCase, toLatinLayout, vehicleHint, words,
  type Category, type CategoryRule, type VehicleVocabulary,
} from "./part-query.js";

const CATALOG = "/catalogList/dt/";
const DENSO = "https://am.denso.com/search/sof/soundList.cgi?Line=5&maker=01toyota";
const TOYOTA_EPC = "https://toyotaepc.com/toyota/probox-succeed/JP/oil-filter";

const PROBOX_FILTERS: ReadonlyArray<readonly [article: string, codes: string, engine: string, years: string, source: string]> = [
  ["04152-40060", "NSP160V", "1NR-FE", "с 09.2014", DENSO],
  ["90915-10003", "NCP160V NCP165V", "1NZ-FE", "09.2014–02.2023", TOYOTA_EPC],
  ["90915-10009", "NCP160V NCP165V", "1NZ-FE", "с 03.2023", TOYOTA_EPC],
  ["90915-10003", "NHP160V", "1NZ-FXE", "12.2018–02.2023", TOYOTA_EPC],
  ["90915-10009", "NHP160V", "1NZ-FXE", "с 03.2023", TOYOTA_EPC],
  ["90915-10003", "NCP50V", "2NZ-FE", "06.2002–09.2014", DENSO],
  ["90915-10003", "NCP51V NCP55V", "1NZ-FE", "06.2002–09.2014", DENSO],
  ["90915-10003", "NCP52V", "1NZ-FNE", "04.2003–09.2014", DENSO],
  ["90915-10003", "NCP58G NCP59G", "1NZ-FE", "06.2002–10.2013", DENSO],
  ["90915-20003", "NLP51V", "1ND-TV", "06.2002–07.2008", DENSO],
];

const PROBOX_ENGINES: Readonly<Record<string, string>> = {
  "1NR-FE": "1.3 л · бензин", "2NZ-FE": "1.3 л · бензин",
  "1NZ-FE": "1.5 л · бензин", "1NZ-FXE": "1.5 л · гибрид",
  "1NZ-FNE": "1.5 л · газ (CNG)", "1ND-TV": "1.4 л · дизель",
};

const PROBOX_FUEL: ReadonlyArray<readonly [readonly string[], string]> = [
  [["гибрид", "hybrid"], "гибрид"],
  [["дизел", "diesel"], "дизель"],
  [["бензин", "gasoline", "petrol"], "бензин"],
  [["cng"], "газ (CNG)"],
];

const W = "[\\p{L}\\p{N}_]";
const MONTH_YEAR = new RegExp(`(?<!${W})(0[1-9]|1[0-2])[./]((?:19|20)\\d{2})(?!${W})`, "gu");

export const CATEGORIES: readonly Category[] = [
  ["Масляный фильтр", [["фильтр", "масл"], ["oil", "filter"], ["масляник"], ["маслофильтр"], ["oilfilter"]]],
  ["Воздушный фильтр", [["фильтр", "воздуш"], ["air", "filter"], ["воздушник"], ["airfilter"]]],
  ["Салонный фильтр", [["фильтр", "салон"], ["cabin", "filter"], ["pollen", "filter"], ["салонник"]]],
  ["Топливный фильтр", [["фильтр", "топлив"], ["fuel", "filter"]]],
  ["Тормозные колодки", [["колод"], ["brake", "pad"]]],
  ["Тормозной диск", [["диск", "тормоз"], ["brake", "disc"], ["brake", "rotor"]]],
  ["Свечи зажигания", [["свеч", "зажиган"], ["spark", "plug"]]],
  ["Свечи накаливания", [["свеч", "накал"], ["glow", "plug"]]],
  ["Амортизатор", [["амортизатор"], ["shock", "absorber"]]],
  ["Стойка стабилизатора", [["стойк", "стабилизатор"], ["stabilizer", "link"], ["sway", "link"]]],
  ["Ступичный подшипник", [["подшипник", "ступиц"], ["подшипник", "ступич"], ["wheel", "bearing"]]],
  ["Щётки стеклоочистителя", [["щетк", "стеклоочистител"], ["дворник"], ["wiper", "blade"]]],
];

export const CATEGORY_NAMES: ReadonlySet<string> = new Set(CATEGORIES.map(([name]) => name));

export const CHOICE_KEYS = ["make", "model", "modification", "node", "engine", "version", "article", "local_variant"] as const;
export type Choices = Partial<Record<(typeof CHOICE_KEYS)[number], number>>;

export interface Option {
  id: number;
  label: string;
  [key: string]: unknown;
}

export type SearchResult = Record<string, unknown> & { status: string };

export interface ReferencePart {
  article: string;
  brand: string;
  description: string;
  oem: boolean;
  source: string;
  source_url?: string;
}

export interface FitmentVariant {
  id: number;
  label: string;
  parts: ReferencePart[];
  vehicle: string;
}

/** The shop's imported fitment rows (local_fitment.py). */
export interface FitmentLookup {
  variants(tokens: readonly string[], category: string, year: number | null, engine: string | null, liters: number | null): Promise<Map<number, FitmentVariant>>;
}

export interface SearchDependencies {
  fapi: FapiGateway;
  fapiFitmentEnabled: boolean;
  fitment: FitmentLookup;
  /** Car names from the shop's vehicle catalog (see buildVehicleVocabulary). */
  vocabulary?: VehicleVocabulary;
}

export interface SearchForm {
  choices?: unknown;
  confirmed?: unknown;
  query?: unknown;
}

function containsWords(tokens: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0) return false;
  for (let index = 0; index + sequence.length <= tokens.length; index += 1) {
    if (sequence.every((word, offset) => tokens[index + offset] === word)) return true;
  }
  return false;
}

export function detectCategories(tokens: readonly string[]): Category[] {
  const cabinAir = containsWords(tokens, ["cabin", "air", "filter"]);
  return CATEGORIES.filter((entry) => categoryMatches(tokens, entry[1]) && !(cabinAir && entry[0] === "Воздушный фильтр"));
}

function monthStamps(text: string): string[] {
  return [...text.matchAll(MONTH_YEAR)].map((match) => `${match[2]}${match[1]}`);
}

export function selected<T extends { id: number }>(available: Iterable<T>, choice: Choices, key: keyof Choices, automatic = false): T | null {
  const list = [...available];
  const ident = choice[key];
  if (ident) {
    const found = list.find((item) => item.id === ident);
    if (found) return found;
    throw new PartsFinderError(400, "invalid_catalog_choice", "Обновите поиск и выберите вариант из каталога.");
  }
  return automatic && list.length === 1 ? list[0]! : null;
}

function choose(key: string, available: readonly unknown[], confirmed: Choices): SearchResult {
  if (available.length > 0) return { status: "choose", field: key, options: available, choices: confirmed };
  return { status: "no_data", message: "В каталоге для этого запроса нет вариантов." };
}

export function proboxFilters(text: string, tokens: readonly string[], choice: Choices | null): SearchResult {
  const chassis = new Set(tokens.filter(isChassisCode));
  const dates = findYears(text);
  const builtMatch = [...text.matchAll(MONTH_YEAR)][0];
  const built = builtMatch ? `${builtMatch[2]}${builtMatch[1]}` : null;
  const engineInput = findEngine(text);
  const capacityInput = findCapacity(text);
  const fuel = new Set(PROBOX_FUEL.filter(([stems]) => tokens.some((token) => stems.some((stem) => token.startsWith(stem)))).map(([, label]) => label));
  let choices: Array<{ body: string; engine: string; ident: number; part: ReferencePart }> = [];
  PROBOX_FILTERS.forEach(([article, codes, engine, years, source], index) => {
    const ident = index + 1;
    const endpoints = findYears(years);
    const months = monthStamps(years);
    const description = PROBOX_ENGINES[engine]!;
    if (
      (chassis.size > 0 && !codes.split(" ").some((code) => chassis.has(code.toLowerCase()) || chassis.has(code.slice(0, -1).toLowerCase())))
      || (engineInput && engineInput.toUpperCase() !== engine)
      || (capacityInput && !description.startsWith(`${capacityInput.replace(",", ".")} `))
      || (fuel.size > 0 && !fuel.has(description.split(" · ").at(-1)!))
      || (dates.length === 1 && (dates[0]! < endpoints[0]! || (endpoints.length > 1 && dates[0]! > endpoints.at(-1)!)))
      || (built && (built < months[0]! || (months.length > 1 && built > months.at(-1)!)))
    ) return;
    const body = `${codes.replaceAll(" ", " / ")} · ${years}`;
    choices.push({
      body, engine, ident,
      part: {
        article, brand: "Toyota", description: `${body} · ${engine}`,
        source: source === DENSO ? "DENSO" : "Toyota EPC", source_url: source, oem: true,
      },
    });
  });
  const context: Record<string, string> = { vehicle: "Toyota Probox", category: "Масляный фильтр" };
  if (choices.length === 0) {
    return {
      status: "need_vehicle",
      ...context, message: "Для указанных кузова, двигателя и года нет совместимого варианта. Проверьте данные машины.",
    };
  }
  if (choice !== null) {
    const engines = new Map<string, Option>();
    for (const { engine } of choices) {
      if (engines.has(engine)) continue;
      // The first reference for an engine remains its identifier across filtered queries.
      const engineId = PROBOX_FILTERS.findIndex((record) => record[2] === engine) + 1;
      const codes = [...new Set(PROBOX_FILTERS.filter((record) => record[2] === engine).flatMap((record) => record[1].split(" ")))].sort();
      const body = codes.length <= 2 ? ` · ${codes.join(", ")}` : "";
      engines.set(engine, { id: engineId, label: `${PROBOX_ENGINES[engine]} · ${engine}${body}` });
    }
    const picked = selected(engines.values(), choice, "engine");
    if (!picked) return { ...choose("engine", [...engines.values()], {}), ...context };
    const chosenEngine = [...engines.entries()].find(([, item]) => item === picked)![0];
    context.engine = picked.label;
    choices = choices.filter((item) => item.engine === chosenEngine);
    if (new Set(choices.map((item) => item.part.article)).size > 1) {
      const versions = choices.map((item) => ({ id: item.ident, label: item.body }));
      const version = selected(versions, choice, "version");
      if (!version) return { ...choose("version", versions, { engine: picked.id }), ...context };
      choices = choices.filter((item) => item.ident === version.id);
    }
  }
  let parts = choices.map((item) => item.part);
  if (choice !== null && parts.length > 1) {
    parts = [{ ...parts[0]!, description: choices.map((item) => item.body).join(" · ") }];
  }
  return { status: "reference", ...context, parts, message: "Сверьте кузов и месяц выпуска перед покупкой." };
}

async function catalogRows(deps: SearchDependencies, name: string, credits: number, params: Record<string, number> = {}, key?: string): Promise<Array<Record<string, unknown>>> {
  let rows = await deps.fapi.fetch(CATALOG + name, params, credits);
  if (key && rows && typeof rows === "object" && !Array.isArray(rows)) rows = (rows as Record<string, unknown>)[key];
  if (!Array.isArray(rows)) {
    throw new PartsFinderError(502, "fapi_invalid_response", "FAPI вернул список каталога неизвестного формата.");
  }
  return rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row));
}

function yearOf(milliseconds: unknown): number | null {
  if (typeof milliseconds === "number" && Number.isInteger(milliseconds) && milliseconds) {
    const year = new Date(milliseconds).getUTCFullYear();
    return Number.isFinite(year) ? year : null;
  }
  return null;
}

interface CatalogOption extends Option {
  capacity?: unknown;
  end?: number | null;
  engine?: unknown;
  start?: number | null;
  title: string;
}

function options(rows: ReadonlyArray<Record<string, unknown>>, idKey: string, labelKey: string, full = false): CatalogOption[] {
  const found = new Map<number, CatalogOption>();
  for (const row of rows) {
    const ident = row[idKey];
    const title = row[labelKey];
    if (typeof ident !== "number" || !Number.isInteger(ident) || ident <= 0 || typeof title !== "string" || !title.trim()) continue;
    const fullLabel = full ? row.fd : null;
    let label = typeof fullLabel === "string" && fullLabel.trim() ? fullLabel : title;
    const item: CatalogOption = { id: ident, label, title };
    if (full) {
      const start = yearOf(row.cb);
      const end = yearOf(row.ce);
      const engine = row.engineCode;
      const capacity = row.capacity;
      if (start) label += end ? ` · ${start}–${end}` : ` · с ${start}`;
      if (typeof engine === "string" && engine && !label.includes(engine)) label += ` · ${engine}`;
      Object.assign(item, { label, start, end, engine, capacity });
    }
    found.set(ident, item);
  }
  return [...found.values()];
}

export function matchingNodes(tree: ReadonlyArray<Record<string, unknown>>, rules: readonly CategoryRule[]): CatalogOption[] {
  const sections = options(tree, "i", "d");
  const titles = new Map(sections.map((item) => [item.id, item.title]));
  const parents = new Map<number, number>();
  for (const row of tree) {
    if (typeof row.i === "number" && Number.isInteger(row.i) && typeof row.pi === "number" && Number.isInteger(row.pi)) parents.set(row.i, row.pi);
  }
  const matches: CatalogOption[] = [];
  for (const item of sections) {
    const title = words(item.title);
    if (!categoryMatches(title, rules) || title.some((word) => /^(?:корпус|крыш|проклад|уплотн|housing|cover|gasket)/u.test(word))) continue;
    const path = [item.title];
    let ancestor = parents.get(item.id);
    const seen = new Set([item.id]);
    while (ancestor !== undefined && titles.has(ancestor) && !seen.has(ancestor)) {
      seen.add(ancestor);
      path.push(titles.get(ancestor)!);
      ancestor = parents.get(ancestor);
    }
    matches.push({ ...item, label: path.reverse().join(" → ") });
  }
  // A car's tree also lists motorcycle groups: never make the customer pick one.
  const moto = (option: CatalogOption) => /мотоцикл|motorcycle/iu.test(option.label);
  return matches.some((option) => !moto(option)) ? matches.filter((option) => !moto(option)) : matches;
}

function coversYear(item: CatalogOption, year: number): boolean {
  return (item.start == null || item.start <= year) && (item.end == null || item.end >= year);
}

export function parseChoices(raw: unknown): Choices {
  const choice = raw === undefined ? {} : raw;
  if (typeof choice !== "object" || choice === null || Array.isArray(choice) || Object.entries(choice).some(([key, value]) => (
    !(CHOICE_KEYS as readonly string[]).includes(key) || typeof value !== "number" || !Number.isInteger(value) || value <= 0
  ))) {
    throw new PartsFinderError(400, "invalid_catalog_choice", "Выберите вариант из каталога.");
  }
  return choice as Choices;
}

const DISPLAY_NAMES: Readonly<Record<string, string>> = { vw: "Volkswagen", bmw: "BMW", rav4: "RAV4" };

export async function searchVehicleParts(form: SearchForm, deps: SearchDependencies, guided = true): Promise<SearchResult> {
  const query = form.query;
  if (typeof query !== "string" || !query.trim() || query.trim().length > 140) {
    throw new PartsFinderError(400, "invalid_parts_query", "Введите название детали, марку и модель автомобиля.");
  }
  const choice = parseChoices(form.choices);
  const vocabulary = deps.vocabulary ?? EMPTY_VOCABULARY;
  const { corrected, tokens: normalized } = normalizeQuery(query, CATEGORIES, vocabulary);
  const categories = detectCategories(normalized);
  if (categories.length === 1 && categories[0]![0] === "Масляный фильтр" && normalized.includes("probox")) {
    return proboxFilters(corrected, normalized, guided ? choice : null);
  }
  const hint = vehicleHint(normalized, CATEGORIES);
  const knownMakeWords = new Set([...vocabulary.makes.values()].flatMap((make) => make.split(" ")));
  const isMake = (token: string) => MAKES.has(token) || knownMakeWords.has(token);
  if (guided && categories.length === 0 && !hint.some(isMake)) {
    const article = articleCandidate(query);
    if (article) {
      const spelling: Option[] = [{ id: 1, label: article }];
      if (/[а-яё]/iu.test(article)) {
        const converted = articleCandidate(toLatinLayout(article.toLowerCase()).toUpperCase());
        if (converted) spelling.push({ id: 2, label: converted });
      }
      const exact = selected(spelling, choice, "article", true);
      if (!exact) return choose("article", spelling, {});
      return { status: "article", article: exact.label };
    }
  }
  if (categories.length !== 1) {
    return {
      status: "need_detail",
      message: "Укажите одну деталь, например «масляный фильтр Toyota Camry 2019» или «колодки Лада Веста».",
    };
  }
  const category = categories[0]!;
  const dates = findYears(corrected);
  const year = dates.length === 1 ? Number(dates[0]) : null;
  const engineInput = findEngine(corrected);
  const capacityInput = findCapacity(corrected);
  const liters = capacityInput ? Number(capacityInput.replace(",", ".")) : null;
  let display = "";
  if (guided) {
    const carTokens = normalizeQuery(stripEngineAndCapacity(corrected), CATEGORIES, vocabulary).tokens;
    const carWords = vehicleHint(carTokens, CATEGORIES);
    display = carWords.map((token) => DISPLAY_NAMES[token] ?? titleCase(token)).join(" ");
    if (carWords.filter((token) => /\p{L}/u.test(token)).length < 2 && (carWords.length < 2 || !isMake(carWords[0]!))) {
      return { status: "need_vehicle", message: "Добавьте марку и модель, например «масляный фильтр Toyota Camry»." };
    }
    let variants: Map<number, FitmentVariant>;
    try {
      variants = await deps.fitment.variants(carWords, category[0], year, engineInput ? engineInput.toUpperCase() : null, liters);
    } catch {
      throw new PartsFinderError(503, "local_fitment_unavailable", "Сейчас недоступен справочник магазина.");
    }
    if (variants.size > 0) {
      const context = { vehicle: display, category: category[0] };
      const variant = selected(variants.values(), choice, "local_variant");
      if (!variant) {
        return { ...choose("local_variant", [...variants.values()].map((row) => ({ id: row.id, label: row.label })), {}), ...context };
      }
      return {
        ...context, vehicle: variant.vehicle, engine: variant.label,
        status: "reference", parts: variant.parts, message: "По каталогу магазина.",
      };
    }
  }
  if (!deps.fapiFitmentEnabled) {
    return {
      // The storefront opens the matching catalog section for this car.
      category: category[0], ...(display ? { vehicle: display } : {}),
      status: "no_data",
      message: "Для этой машины пока нет данных в местном справочнике. Можно продолжить по известному артикулу.",
    };
  }
  if (guided && form.confirmed !== true) {
    const configuration = [display];
    if (year) configuration.push(String(year));
    if (capacityInput) configuration.push(`${capacityInput.replace(".", ",")} л`);
    if (engineInput) configuration.push(engineInput.toUpperCase());
    return { status: "confirm", vehicle: configuration.join(" · "), category: category[0], message: "Проверьте автомобиль и деталь." };
  }

  const tokens = [...normalized];
  if (tokens.includes("mercedes") && !tokens.includes("benz")) tokens.splice(tokens.indexOf("mercedes") + 1, 0, "benz");
  const makeRows = await catalogRows(deps, "manufacturerList", 3, {}, "mf");
  const makes = options(makeRows, "dbi", "ds").filter((item) => containsWords(tokens, words(item.title).map((token) => ALIASES[token] ?? token)));
  if (makes.length === 0) return { status: "need_vehicle", message: "Укажите марку и модель, например «масляный фильтр Toyota Camry»." };
  const make = selected(makes, choice, "make", true);
  if (!make) return { ...choose("make", makes, {}), category: category[0] };
  const confirmed: Choices = { make: make.id };

  const modelRows = await catalogRows(deps, "modelList", 8, { mfi: make.id }, "m");
  const makeWords = words(make.title);
  let models = options(modelRows, "dbi", "d", true).filter((item) => {
    let name = words(item.title.split("(", 1)[0]!);
    if (makeWords.every((word, index) => name[index] === word)) name = name.slice(makeWords.length);
    if (name.length === 0) return false;
    // "NOAH/VOXY": either name finds the generation.
    const second = item.title.split("(", 1)[0]!.includes("/") ? name[1] : undefined;
    return containsWords(tokens, [ALIASES[name[0]!] ?? name[0]!]) || (second !== undefined && tokens.includes(second));
  });
  if (year) models = models.filter((item) => coversYear(item, year));
  if (models.length === 0) return { status: "need_vehicle", message: `В каталоге ${make.title} такой модели или года нет. Проверьте данные.` };
  const model = selected(models, choice, "model", true);
  if (!model) return { ...choose("model", models, confirmed), vehicle: make.label, category: category[0] };
  confirmed.model = model.id;

  const modificationRows = await catalogRows(deps, "modificationList", 8, { mi: model.id }, "m");
  let modifications = options(modificationRows, "dbi", "d", true);
  if (year) modifications = modifications.filter((item) => coversYear(item, year));
  if (engineInput) {
    modifications = modifications.filter((item) => typeof item.engine === "string"
      && item.engine.toUpperCase().split(/[,;/\s]+/u).includes(engineInput.toUpperCase()));
  }
  if (capacityInput) {
    modifications = modifications.filter((item) => {
      const capacity = /^\d+(?:[.,]\d+)?/u.exec(String(item.capacity || item.title));
      return capacity !== null && Math.round(Number(capacity[0].replace(",", ".")) * 10) / 10 === liters;
    });
  }
  const modification = selected(modifications, choice, "modification");
  if (!modification) return { ...choose("modification", modifications, confirmed), vehicle: model.label, category: category[0] };
  confirmed.modification = modification.id;

  const tree = await catalogRows(deps, "treeList", 8, { mi: modification.id });
  const nodes = matchingNodes(tree, category[1]);
  if (nodes.length === 0) return { status: "no_data", message: "Для этой модификации в каталоге нет подходящей группы деталей." };
  const node = selected(nodes, choice, "node", true);
  if (!node) return { ...choose("node", nodes, confirmed), vehicle: modification.label, category: category[0] };
  const rows = await catalogRows(deps, "productList", 8, { modi: modification.id, nodei: node.id });
  const parts = new Map<string, FapiPart>();
  for (const row of rows) {
    const part = partRef({ ...row, ds: row.mfd });
    // "LIFETIME", "LIFE-TIME-FILTER": a filter built into the tank, not a part number.
    if (part && /\d/u.test(part.article)) parts.set(`${part.manufacturer_id}\u0000${part.article}`, part);
  }
  return {
    status: "found", vehicle: modification.label, category: node.title,
    parts: [...parts.values()].slice(0, 120),
    message: "Подходящие артикулы по каталогу производителей. Перед покупкой сверьте применимость детали.",
  };
}

/** Stable positive identifier for a fitment variant (fits in a JS safe integer). */
export function variantId(fields: readonly unknown[]): number {
  return Number.parseInt(createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 12), 16);
}
