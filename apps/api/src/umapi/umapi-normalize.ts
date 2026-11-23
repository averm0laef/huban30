/**
 * UMAPI answers (OpenAPI 2.1.1, /v2/autocatalog/{locale}/…) reduced to the few
 * fields the site shows. Parsing is tolerant: a missing or oddly typed field
 * drops that value, never the whole answer. Only this reduced form is kept in
 * the Redis display cache; nothing of it is written to PostgreSQL.
 */

export interface UmapiBrandRow { article: string; brand: string; brandId: number | null; title: string | null; type: string | null }
export interface UmapiArticleRow { artId: number; article: string; brand: string; name: string | null; supId: number | null }
export interface UmapiCarLink {
  car: string;
  make: string;
  makeId: number | null;
  model: string;
  msId: number | null;
  pcId: number;
  yearFrom: number | null;
  yearTo: number | null;
}
export interface UmapiMedia { file: string; supId: number | null }
/** getCrossInfo: the catalogue part for a number and a maker, with its photos. */
export interface UmapiCrossInfo { article: string; artId: number; brand: string; medias: UmapiMedia[]; title: string | null }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** An answer is either a list or `{ data: [...] }` (the paged methods). */
function rows(payload: unknown, key?: string): Array<Record<string, unknown>> {
  const source = key ? record(payload)?.[key] : Array.isArray(payload) ? payload : record(payload)?.data;
  return Array.isArray(source) ? source.flatMap((item) => { const row = record(item); return row ? [row] : []; }) : [];
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).replace(/\s+/gu, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function id(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d{1,12}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function year(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d{4})/u.exec(value.trim()) : null;
  const number = match ? Number(match[1]) : null;
  return number && number > 1900 && number < 2100 ? number : null;
}

/** BrandRefinement/{number}: who makes a part with this number. */
export function normalizeBrandRows(payload: unknown): UmapiBrandRow[] {
  return rows(payload).flatMap((row) => {
    const brand = text(row.BRAND, 80);
    const article = text(row.DISPLAY_NR ?? row.SEARCH_NUMBER, 64);
    return brand && article ? [{ article, brand, brandId: id(row.BRA_ID), title: text(row.TITLE ?? row.DES, 160), type: text(row.TYPE, 40) }] : [];
  });
}

/** Analogs/{number}/{brand}: catalogue articles, the asked one among them. */
export function normalizeArticleRows(payload: unknown): UmapiArticleRow[] {
  return rows(payload).flatMap((row) => {
    const artId = id(row.ART_ID);
    const article = text(row.ARTICLE_NR, 64);
    const brand = text(row.BRAND, 80);
    return artId && article && brand ? [{ artId, article, brand, name: text(row.COMPLETE_DES ?? row.DES, 200), supId: id(row.SUP_ID) }] : [];
  });
}

/** ArticleLinks/{ART_ID}: the passenger cars a part is listed for (lorries, axles and engines are not shown). */
export function normalizeCarLinks(payload: unknown): UmapiCarLink[] {
  return rows(payload, "PC").flatMap((row) => {
    const pcId = id(row.PC_ID);
    const make = text(row.MANUFACTURER, 80);
    const model = text(row.MODEL_SERIES, 120);
    const car = text(row.PASSENGER_CAR, 120);
    return pcId && make && model && car
      ? [{ car, make, makeId: id(row.MFA_ID), model, msId: id(row.MS_ID), pcId, yearFrom: year(row.CI_FROM), yearTo: year(row.CI_TO) }]
      : [];
  });
}

/** Article/{ART_ID}?Medias=true (and getCrossInfo's `td`): the article's photo files, in the catalogue's order. */
export function normalizeMedias(payload: unknown, supplier: number | null = null): UmapiMedia[] {
  const list = rows(payload, "MEDIAS")
    .map((row) => ({ file: text(row.FILE_NAME, 300), sort: typeof row.SORT === "number" ? row.SORT : 0, supId: id(row.SUP_ID) ?? supplier }))
    .filter((row): row is { file: string; sort: number; supId: number | null } => row.file !== null && /\.(?:jpe?g|png|webp|gif)$/iu.test(row.file));
  return list.sort((a, b) => a.sort - b.sort).slice(0, 8).map(({ file, supId }) => ({ file, supId }));
}

/**
 * /v2/cross/parts/Analogs/getCrossInfo?article&brand: the one call that names a part's catalogue id (`catalogId`,
 * `td.ART_ID`) for a number and a maker — the autocatalog methods need that id and offer no other way to it
 * (checked with the owner's key on 23.11.2026). null when the catalogue has no such part.
 */
export function normalizeCrossInfo(payload: unknown): UmapiCrossInfo | null {
  const body = record(payload);
  const detail = record(body?.td);
  const artId = id(detail?.ART_ID) ?? id(body?.catalogId);
  const article = text(detail?.ARTICLE_NR ?? body?.article, 64);
  const brand = text(detail?.BRAND ?? body?.brand, 80);
  if (!artId || !article || !brand) return null;
  return { article, artId, brand, medias: detail ? normalizeMedias(detail, id(detail.SUP_ID)) : [], title: text(detail?.COMPLETE_DES ?? body?.title, 200) };
}
