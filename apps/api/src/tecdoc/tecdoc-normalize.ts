/**
 * Provider answers (tecdoc.site API v2) reduced to the few fields the site
 * shows. Parsing is tolerant: a missing or oddly typed field drops that value,
 * never the whole answer. Only this reduced form is kept in the display cache.
 */

export interface TecdocMake { id: number; modelsCount: number | null; name: string }
export interface TecdocSeries { id: number; name: string }
export interface TecdocModel { id: number; makeId: number | null; name: string; yearFrom: number | null; yearTo: number | null }
export interface TecdocGeneration {
  body: string | null;
  capacityLiters: string | null;
  engineCodes: string[];
  fuel: string | null;
  id: number;
  makeId: number | null;
  modelId: number | null;
  name: string;
  powerPs: number | null;
  yearFrom: number | null;
  yearTo: number | null;
}
export interface TecdocCategory { children: TecdocCategory[]; id: number; name: string }
export interface TecdocOem { brand: string; number: string }
export interface TecdocPart {
  artId: number | null;
  article: string;
  brand: string;
  criteria: Array<{ name: string; value: string }>;
  /** How a number search reached this part: "ArticleNumber" for the number itself, else a cross type. */
  foundVia: string | null;
  group: string | null;
  image: string | null;
  name: string;
  oems: TecdocOem[];
}
export interface TecdocSupplierRow { article: string | null; brand: string; productGroup: string | null; supId: number | null }
export interface TecdocFitmentModel { generations: number | null; makeId: number | null; model: string; msId: number | null; series: string | null }
export interface TecdocFitmentMake { make: string; models: TecdocFitmentModel[] }
export interface TecdocPartDetail { fitment: TecdocFitmentMake[]; oems: TecdocOem[]; part: TecdocPart | null }
export interface TecdocVinCandidate {
  body: string | null; capacityLiters: string | null; engineCodes: string[]; fuel: string | null; genId: number;
  generation: string; make: string; makeId: number | null; model: string; msId: number | null; powerPs: number | null;
  yearFrom: number | null; yearTo: number | null;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d{1,12}$/u.test(value.trim()) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function year(value: unknown): number | null {
  const match = /^(\d{4})/u.exec(text(value));
  const parsed = match ? Number(match[1]) : Number.NaN;
  return parsed >= 1900 && parsed <= 2100 ? parsed : null;
}

/** "2.0000" -> "2.0"; "1957.0000" (cm³) -> "2.0". */
function liters(litres: unknown, cubic: unknown): string | null {
  const fromLitres = Number(text(litres).replace(",", "."));
  if (Number.isFinite(fromLitres) && fromLitres > 0 && fromLitres < 20) return fromLitres.toFixed(1);
  const fromCubic = Number(text(cubic).replace(",", "."));
  return Number.isFinite(fromCubic) && fromCubic > 0 ? (fromCubic / 1000).toFixed(1) : null;
}

function wholeNumber(value: unknown): number | null {
  const parsed = Math.round(Number(text(value).replace(",", ".")));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** `data.list` of an answer, wherever the provider put it. */
export function listOf(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : payload;
  return Array.isArray(data.list) ? data.list : [];
}

function records(values: unknown[]): Json[] {
  return values.filter(isRecord);
}

export function normalizeMakes(payload: unknown): TecdocMake[] {
  return records(listOf(payload)).flatMap((row) => {
    const id = positiveInteger(row.MFA_ID);
    const name = text(row.MFA_BRAND, 80);
    return id && name ? [{ id, modelsCount: positiveInteger(row.MFA_MODELS_COUNT), name }] : [];
  });
}

export function normalizeSeries(payload: unknown): TecdocSeries[] {
  return records(listOf(payload)).flatMap((row) => {
    const id = positiveInteger(row.SR_ID);
    const name = text(row.SR_NAME, 80);
    return id && name ? [{ id, name }] : [];
  });
}

export function normalizeModels(payload: unknown): TecdocModel[] {
  return records(listOf(payload)).flatMap((row) => {
    const id = positiveInteger(row.MS_ID);
    const name = text(row.NAME, 120);
    return id && name ? [{ id, makeId: positiveInteger(row.MFA_ID), name, yearFrom: year(row.DATE_FROM), yearTo: year(row.DATE_TO) }] : [];
  });
}

function engineCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(records(value).map((row) => text(row.ENG_CODE, 40)).filter(Boolean))].slice(0, 6);
}

export function normalizeGenerations(payload: unknown): TecdocGeneration[] {
  return records(listOf(payload)).flatMap((row) => {
    const id = positiveInteger(row.GEN_ID);
    if (!id) return [];
    return [{
      body: text(row.BODY, 60) || null,
      capacityLiters: liters(row.CAPACITY_LT, row.CAPACITY),
      engineCodes: engineCodes(row.ENG_CODES),
      fuel: text(row.FUEL, 40) || null,
      id,
      makeId: positiveInteger(row.MFA_ID),
      modelId: positiveInteger(row.MS_ID),
      name: text(row.NAME, 80),
      powerPs: wholeNumber(row.POWER_PS_FROM ?? row.POWER_PS),
      yearFrom: year(row.DATE_START ?? row.DATE_FROM),
      yearTo: year(row.DATE_END ?? row.DATE_TO),
    }];
  });
}

export function normalizeVin(payload: unknown): TecdocVinCandidate[] {
  const rows = isRecord(payload) && Array.isArray(payload.list) ? payload.list : listOf(payload);
  return records(rows).flatMap((row) => {
    const genId = positiveInteger(row.GEN_ID);
    const make = text(row.MANUFACTURER, 80);
    if (!genId || !make) return [];
    return [{
      body: text(row.BODY, 60) || null,
      capacityLiters: liters(row.CAPACITY_LT, row.CAPACITY),
      engineCodes: engineCodes(row.ENG_CODES),
      fuel: text(row.FUEL, 40) || null,
      genId,
      generation: text(row.GENERATION, 80),
      make,
      makeId: positiveInteger(row.MFA_ID),
      model: text(row.MODEL, 120),
      msId: positiveInteger(row.MS_ID),
      powerPs: wholeNumber(row.POWER_PS),
      yearFrom: year(row.DATE_FROM),
      yearTo: year(row.DATE_TO),
    }];
  });
}

const MAX_CATEGORY_DEPTH = 8;

/** Accepts the nested form (`as_tree=true`) and the flat one (PARENT_ID), returns a tree. */
export function normalizeCategories(payload: unknown): TecdocCategory[] {
  const rows = records(listOf(payload));
  const nested = (row: Json, depth: number): TecdocCategory | null => {
    const id = positiveInteger(row.STR_ID);
    const name = text(row.NAME, 120);
    if (!id || !name) return null;
    const children = depth < MAX_CATEGORY_DEPTH && Array.isArray(row.children)
      ? records(row.children).flatMap((child) => { const node = nested(child, depth + 1); return node ? [node] : []; })
      : [];
    return { children, id, name };
  };
  if (rows.some((row) => Array.isArray(row.children))) {
    return rows.flatMap((row) => { const node = nested(row, 0); return node ? [node] : []; });
  }
  const nodes = new Map<number, TecdocCategory>();
  for (const row of rows) {
    const id = positiveInteger(row.STR_ID);
    const name = text(row.NAME, 120);
    if (id && name) nodes.set(id, { children: [], id, name });
  }
  const roots: TecdocCategory[] = [];
  for (const row of rows) {
    const node = nodes.get(positiveInteger(row.STR_ID) ?? 0);
    if (!node) continue;
    const parent = nodes.get(positiveInteger(row.PARENT_ID) ?? 0);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Pictures are shown straight from the provider: only its own HTTPS addresses are passed on. */
function image(value: unknown): string | null {
  const first = Array.isArray(value) ? value.find((item) => typeof item === "string") : value;
  if (typeof first !== "string" || first.length > 400) return null;
  try {
    const url = new URL(first);
    return url.protocol === "https:" && (url.hostname === "tecdoc.site" || url.hostname.endsWith(".tecdoc.site")) ? url.href : null;
  } catch {
    return null;
  }
}

function oems(value: unknown): TecdocOem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return records(value).flatMap((row) => {
    const brand = text(row.BRAND ?? row.ARL_BRAND ?? row.ARL_BRA_BRAND, 80);
    const number = text(row.NUMBER ?? row.ARL_NUMBER ?? row.ARL_SEARCH_NUMBER, 64);
    const key = `${brand}\u0000${number}`;
    if (!brand || !number || seen.has(key)) return [];
    seen.add(key);
    return [{ brand, number }];
  }).slice(0, 30);
}

function part(row: Json): TecdocPart | null {
  const article = text(row.ART_ARTICLE_NR ?? row.ART_NUMBER ?? row.ART_DISPLAY_NR, 64);
  const brand = text(row.SUP_BRAND ?? row.ART_SUP_BRAND ?? row.BRAND ?? row.ART_BRA_BRAND, 80);
  if (!article || !brand) return null;
  const via = row.FOUND_VIA;
  return {
    artId: positiveInteger(row.ART_ID),
    article,
    brand,
    criteria: (Array.isArray(row.ARTICLE_CRITERIA) ? records(row.ARTICLE_CRITERIA) : []).flatMap((item) => {
      const name = text(item.CRI_SHORT_NAME ?? item.CRI_NAME, 80);
      const value = text(item.CRI_DES ?? item.CRI_VALUE, 120);
      return name && value ? [{ name, value }] : [];
    }).slice(0, 8),
    foundVia: (isRecord(via) ? text(via.ARL_TYPE, 40) : text(via, 40)) || null,
    group: text(row.PRODUCT_GROUP, 120) || null,
    image: image(row.IMAGES ?? row.IMAGE),
    name: text(row.ART_PRODUCT_NAME, 160) || text(row.PRODUCT_GROUP, 160),
    oems: oems(row.OEMS ?? row.OEM),
  };
}

export function normalizeParts(payload: unknown): TecdocPart[] {
  return records(listOf(payload)).flatMap((row) => { const item = part(row); return item ? [item] : []; });
}

/** `hasMore` of the simple pagination, or page < lastPage of the full one. */
export function hasMorePages(payload: unknown): boolean {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const pagination = data && isRecord(data.pagination) ? data.pagination : null;
  if (!pagination) return false;
  if (typeof pagination.hasMore === "boolean") return pagination.hasMore;
  const current = positiveInteger(pagination.currentPage);
  const last = positiveInteger(pagination.lastPage);
  return current !== null && last !== null && current < last;
}

export function normalizeSupplierRows(payload: unknown): TecdocSupplierRow[] {
  return records(listOf(payload)).flatMap((row) => {
    const brand = text(row.SUP_BRAND, 80);
    if (!brand) return [];
    return [{ article: text(row.ART_ARTICLE_NR, 64) || null, brand, productGroup: text(row.PT_NAME, 120) || null, supId: positiveInteger(row.SUP_ID) }];
  });
}

function fitmentModel(row: Json): TecdocFitmentModel | null {
  const model = text(row.MODEL, 120);
  if (!model) return null;
  return {
    generations: positiveInteger(row.GEN_TOTAL), makeId: positiveInteger(row.MFA_ID), model,
    msId: positiveInteger(row.MS_ID), series: text(row.SERIES, 80) || null,
  };
}

/** `{ "AUDI": [...] }` (by make) or `{ "PASSENGER_CAR": [...] }` (by vehicle type) -> makes with their models. */
export function normalizeFitment(value: unknown): TecdocFitmentMake[] {
  if (!isRecord(value)) return [];
  const makes = new Map<string, TecdocFitmentModel[]>();
  for (const [key, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) continue;
    for (const row of records(rows)) {
      const model = fitmentModel(row);
      if (!model) continue;
      const make = text(row.BRAND, 80) || key;
      makes.set(make, [...(makes.get(make) ?? []), model]);
    }
  }
  return [...makes.entries()]
    .map(([make, models]) => ({ make, models: models.sort((a, b) => a.model.localeCompare(b.model, "ru", { numeric: true })) }))
    .sort((a, b) => a.make.localeCompare(b.make, "ru"));
}

export function normalizePartDetail(payload: unknown): TecdocPartDetail {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const item = data && isRecord(data.item) ? data.item : null;
  if (!item) return { fitment: [], oems: [], part: null };
  return { fitment: normalizeFitment(item.APPLICABILITY), oems: oems(item.OEM ?? item.OEMS), part: part(item) };
}

export function normalizeApplicability(payload: unknown): TecdocFitmentMake[] {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  return normalizeFitment(data?.list);
}

/** Every vehicle (generation) id an applicability answer names, whatever its nesting. */
export function collectGenerationIds(payload: unknown): number[] {
  const found = new Set<number>();
  const visit = (value: unknown, depth: number, idList: boolean): void => {
    if (depth > 8 || found.size > 20_000) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (idList && (typeof item === "number" || typeof item === "string")) { const id = positiveInteger(item); if (id) found.add(id); }
        else visit(item, depth + 1, idList);
      }
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      const upper = key.toUpperCase();
      if (upper === "GEN_ID") { const id = positiveInteger(item); if (id) found.add(id); }
      // `id_only=true`: plain arrays of ids under list / GEN_IDS / a make name.
      else visit(item, depth + 1, idList || upper === "LIST" || upper === "GEN_IDS" || upper === "IDS");
    }
  };
  visit(isRecord(payload) && isRecord(payload.data) ? payload.data : payload, 0, false);
  return [...found];
}

const STOP_WORDS = new Set(["для", "на", "и", "в", "к", "с", "по", "под", "от"]);

function stem(word: string): string {
  return word.length <= 4 ? word : word.slice(0, Math.max(4, word.length - 2));
}

export interface CategoryMatch { id: number; leaf: boolean; name: string; path: string[] }

/**
 * Categories of a car's tree whose name contains every word of the request
 * («топливный фильтр» -> «Топливный фильтр»). Free: works on the tree the
 * visitor already loaded. Exact names first, then leaves, then by depth.
 */
export function matchCategories(tree: readonly TecdocCategory[], query: string, limit = 12): CategoryMatch[] {
  const words = (value: string) => value.toLowerCase().replace(/ё/gu, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
  const wanted = words(query).filter((word) => !STOP_WORDS.has(word) && word.length >= 2).map(stem);
  if (wanted.length === 0) return [];
  const matches: Array<CategoryMatch & { score: number }> = [];
  const visit = (node: TecdocCategory, path: string[]): void => {
    const own = words(node.name);
    if (wanted.every((want) => own.some((word) => word.startsWith(want)))) {
      matches.push({ id: node.id, leaf: node.children.length === 0, name: node.name, path, score: (own.length - wanted.length) * 2 + path.length + (node.children.length === 0 ? 0 : 1) });
    }
    for (const child of node.children) visit(child, [...path, node.name]);
  };
  for (const root of tree) visit(root, []);
  const seen = new Set<number>();
  return matches.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "ru"))
    .filter((match) => (seen.has(match.id) ? false : (seen.add(match.id), true)))
    .slice(0, limit)
    .map(({ score: _score, ...match }) => match);
}
