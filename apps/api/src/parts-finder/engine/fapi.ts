/** FAPI part cards and account usage. Port of fapi_catalog.py. */

import { PartsFinderError } from "./errors.js";
import { UpstreamStatusError, type RequestJson } from "./http.js";

export const FAPI_URL = "https://fapi.iisis.ru/fapi/v2";

const PART_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ["oe", "oe"],
  ["analogs", "analogs"],
  ["replacedBy", "replaced_by"],
  ["replaces", "replaces"],
];

const ACCOUNT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["pl", "plan"], ["st", "status"], ["inc", "included_credits"], ["rem", "remaining_credits"],
  ["u", "used_credits"], ["ts", "observed_at"], ["ps", "period_start"], ["pe", "period_end"],
];

const KNOWN_ERRORS: Readonly<Record<number, readonly [string, string]>> = {
  400: ["fapi_invalid_query", "FAPI отклонил параметры поиска."],
  401: ["fapi_key_expired", "FAPI отклонил ключ. Проверьте срок его действия."],
  402: ["fapi_credits_unavailable", "FAPI ограничил доступ по тарифу или балансу. Проверьте остаток кредитов."],
  403: ["fapi_access_denied", "FAPI не распознал ключ или не дал ему доступ к каталогу."],
  429: ["fapi_rate_limited", "FAPI ограничил частоту запросов. Повторите позже."],
};

export type FapiParams = Record<string, string | number>;

export interface FapiPart {
  article: string;
  brand: string;
  description?: string;
  manufacturer_id: number;
  manufacturer_verified?: true;
  votes_against?: number;
  votes_for?: number;
}

export interface FapiUsage {
  included_credits?: number | string;
  observed_at?: number | string;
  period_end?: number | string;
  period_start?: number | string;
  plan?: number | string;
  remaining_credits?: number | string;
  status: string;
  used_credits?: number | string;
}

/** Anything that can answer a metered FAPI call (the budget in production, FAPI itself in tests). */
export interface FapiGateway {
  fetch(endpoint: string, params: FapiParams, credits: number): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function fapiUrl(path: string, params?: FapiParams): string {
  const query = params && Object.keys(params).length > 0
    ? `?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()}`
    : "";
  return `${FAPI_URL}${path}${query}`;
}

export async function fapiRequest(path: string, key: string | undefined, requestJson: RequestJson, params?: FapiParams): Promise<unknown> {
  if (!key) throw new PartsFinderError(503, "fapi_key_missing", "Ключ FAPI не настроен.");
  let response: unknown;
  try {
    response = (await requestJson(fapiUrl(path, params), { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 10_000 })).data;
  } catch (error) {
    if (error instanceof UpstreamStatusError && KNOWN_ERRORS[error.status]) {
      const [code, message] = KNOWN_ERRORS[error.status]!;
      throw new PartsFinderError(error.status, code, message);
    }
    throw new PartsFinderError(502, "fapi_unavailable", "Каталог FAPI сейчас недоступен.");
  }
  if (typeof response !== "object" || response === null) {
    throw new PartsFinderError(502, "fapi_invalid_response", "FAPI вернул ответ неизвестного формата.");
  }
  return response;
}

export function partRef(raw: unknown): FapiPart | null {
  if (!isRecord(raw)) return null;
  const article = raw.n || raw.ns;
  const brand = raw.ds;
  const manufacturerId = raw.mfi;
  if (typeof article !== "string" || !article || typeof brand !== "string" || !brand) return null;
  if (!isPositiveInteger(manufacturerId)) return null;
  const part: FapiPart = { article, brand, manufacturer_id: manufacturerId };
  if (typeof raw.d === "string" && raw.d.trim()) part.description = raw.d.trim();
  if (raw.mfc === true) part.manufacturer_verified = true;
  for (const [key, name] of [["rp", "votes_for"], ["rm", "votes_against"]] as const) {
    const value = raw[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) part[name] = value;
  }
  return part;
}

function partList(raw: Record<string, unknown>, key: string): FapiPart[] {
  const items = raw[key] ?? [];
  if (!Array.isArray(items)) {
    throw new PartsFinderError(502, "fapi_invalid_response", "FAPI вернул список деталей неизвестного формата.");
  }
  return items.flatMap((item) => {
    const part = partRef(item);
    return part ? [part] : [];
  });
}

export interface FapiPartForm {
  article?: unknown;
  manufacturer_id?: unknown;
}

/** Article card with crosses: 1 credit per new card, free from the shared cache. */
export async function findPart(form: FapiPartForm, gateway: FapiGateway): Promise<Record<string, unknown>> {
  const article = typeof form.article === "string" ? form.article.trim() : "";
  if (!article || article.length > 64) {
    throw new PartsFinderError(400, "invalid_article", "Введите артикул длиной до 64 символов.");
  }
  if (/[\p{C}]/u.test(article) || !/[\p{L}\p{N}]/u.test(article)) {
    throw new PartsFinderError(400, "invalid_article", "Проверьте написание артикула.");
  }
  const params: FapiParams = { n: article, limit: 100 };
  if (form.manufacturer_id !== undefined && form.manufacturer_id !== null) {
    if (!isPositiveInteger(form.manufacturer_id)) {
      throw new PartsFinderError(400, "invalid_manufacturer", "Выберите бренд из результатов поиска.");
    }
    params.mfi = form.manufacturer_id;
  }
  const raw = await gateway.fetch("/part", params, 1);
  if (!isRecord(raw) || !("candidates" in raw)) {
    throw new PartsFinderError(502, "fapi_invalid_response", "FAPI вернул ответ неизвестного формата.");
  }
  const part = partRef(raw.part);
  if (!part) {
    const candidates = partList(raw, "candidates");
    return { article, status: candidates.length > 0 ? "choose_brand" : "no_data", candidates };
  }
  const groups = Object.fromEntries(PART_GROUPS.map(([key, label]) => [label, partList(raw, key)]));
  const result: Record<string, unknown> = { article, status: "found", part, groups };
  if (raw.status === "current" || raw.status === "replaced") result.part_status = raw.status;
  const current = partRef(raw.current);
  if (current) result.current = current;
  return result;
}

const ACCOUNT_STATUSES = new Set(["unbilled", "allowed", "denied_unpaid", "denied_quota", "denied_balance"]);

/** Package balance and plan (free call). */
export async function readUsage(key: string | undefined, requestJson: RequestJson): Promise<FapiUsage> {
  const raw = await fapiRequest("/usage", key, requestJson);
  const account = isRecord(raw) ? raw.account : null;
  if (!isRecord(account) || typeof account.st !== "string" || !ACCOUNT_STATUSES.has(account.st)) {
    throw new PartsFinderError(502, "fapi_invalid_response", "FAPI вернул сведения о тарифе неизвестного формата.");
  }
  const usage: Record<string, string | number> = {};
  for (const [field, name] of ACCOUNT_FIELDS) {
    const value = account[field];
    if (typeof value === "string" || (typeof value === "number" && Number.isInteger(value))) usage[name] = value;
  }
  return usage as unknown as FapiUsage;
}
