#!/usr/bin/env node
/**
 * First check of the UMAPI API key (docs/UMAPI_INTEGRATION.md, «Первая проверка с ключом»).
 *
 *   node scripts/umapi-checks/probe.mjs
 *
 * The key is read from secrets/umapi_api_key.txt (one line; the secrets folder is not in Git) and
 * is never printed. About ten requests; nothing is written anywhere: answers about analogs and
 * applicability are only counted and compared with our own vehicle catalog in memory.
 *
 * What it answers:
 *  1. Does the key work (401 / 402 otherwise) and how long one request takes.
 *  2. Do the numbers of the API match the numbers of the file we bought
 *     (MFA_ID, MS_ID, PC_ID <-> PCS_PC_ID)? The whole car picker depends on it.
 *  3. The control product of the concept: AFW1272 (FILTRON K1288, MANN CU3569) on
 *     Mercedes-Benz Sprinter 3,5-t Фургон (B906): which brands the numbers resolve to, whether
 *     the catalog article id (ART_ID) can be reached from a number and a brand, and whether
 *     ArticleLinks lists our modifications of that Sprinter.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEY_FILE = path.join(root, "secrets/umapi_api_key.txt");
const CSV_FILE = path.join(root, "local-data/umapi/cb_passenger_cars.csv");
const BASE = process.env.UMAPI_BASE_URL ?? "https://api.umapi.ru";
const LOCALE = process.env.UMAPI_LOCALE ?? "ru-WWW";

// Control vehicle and product (ids from our UMAPI file; see the concept, section 8).
const MERCEDES = 74;
const SPRINTER_35T_VAN = 5590;
const CANDIDATES = [
  { article: "AFW1272", brand: null, note: "код из 1С (бренд не указан)" },
  { article: "K1288", brand: "FILTRON", note: "номер из скобок названия" },
  { article: "CU3569", brand: "MANN-FILTER", note: "номер из скобок названия" },
];

if (!existsSync(KEY_FILE)) {
  console.error(`Нет файла ключа: ${path.relative(root, KEY_FILE)}. Положите туда ключ одной строкой.`);
  process.exit(2);
}
const key = readFileSync(KEY_FILE, "utf8").trim();
if (!key) {
  console.error("Файл ключа пустой.");
  process.exit(2);
}

let calls = 0;
async function get(route, query = {}) {
  const url = new URL(`${BASE}${route}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  calls += 1;
  const started = Date.now();
  const response = await fetch(url, { headers: { Accept: "application/json", "X-App-Key": key }, signal: AbortSignal.timeout(20_000) });
  const ms = Date.now() - started;
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* reported below */ }
  if (!response.ok) {
    const message = body && typeof body === "object" ? body.message : text.slice(0, 200);
    const meaning = { 401: "ключ не принят", 402: "нужна оплата или метод не входит в тариф", 400: "неверный запрос" }[response.status] ?? "ошибка сервиса";
    console.log(`  ✗ ${route} → ${response.status} (${meaning}) ${ms} мс: ${JSON.stringify(message)}`);
    return null;
  }
  console.log(`  ✓ ${route} → 200, ${ms} мс`);
  return body;
}

const list = (value) => (Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []);
const shape = (row) => (row && typeof row === "object" ? Object.keys(row).join(", ") : String(row));

/** Our file, read with the same reader the import uses (packages/database must be built). */
async function ourCatalog() {
  if (!existsSync(CSV_FILE)) return null;
  const reader = path.join(root, "packages/database/dist/vehicle-catalog-csv.js");
  if (!existsSync(reader)) return null;
  const { readVehicleCatalog } = await import(reader);
  return readVehicleCatalog(readFileSync(CSV_FILE, "utf8").split("\n"));
}

const catalog = await ourCatalog();
const auto = `/v2/autocatalog/${LOCALE}`;

console.log("\n1. Ключ и марки");
const makes = list(await get(`${auto}/Manufacturers`, { type: "PC" }));
if (makes.length) {
  console.log(`  марок: ${makes.length}; поля: ${shape(makes[0])}`);
  const mercedes = makes.find((row) => Number(row.MFA_ID) === MERCEDES);
  console.log(`  MFA_ID ${MERCEDES} в API: ${mercedes ? JSON.stringify(mercedes.MFA_BRAND ?? mercedes.MANUFACTURER ?? mercedes) : "нет"} (в нашем файле — MERCEDES-BENZ)`);
  if (catalog) {
    const ours = new Map(catalog.makes.map((make) => [make.umapiId, make.name]));
    const same = makes.filter((row) => ours.has(Number(row.MFA_ID))).length;
    console.log(`  совпадают номера марок с нашим файлом: ${same} из ${makes.length} (в файле ${ours.size})`);
  }
}

console.log("\n2. Модели Mercedes-Benz и модификации Sprinter 3,5-t Фургон (B906)");
const models = list(await get(`${auto}/ModelSeries`, { MFA_ID: MERCEDES, type: "PC" }));
if (models.length) {
  const sprinter = models.find((row) => Number(row.MS_ID) === SPRINTER_35T_VAN);
  console.log(`  моделей: ${models.length}; MS_ID ${SPRINTER_35T_VAN}: ${sprinter ? JSON.stringify(sprinter.MODEL_SERIES ?? sprinter.MS_NAME ?? shape(sprinter)) : "нет"}`);
}
const cars = list(await get(`${auto}/Passangers`, { MS_ID: SPRINTER_35T_VAN, type: "PC" }));
const apiPcIds = new Set(cars.map((row) => Number(row.PC_ID)));
if (cars.length) {
  console.log(`  модификаций в API: ${cars.length}; поля: ${shape(cars[0])}`);
  if (catalog) {
    const ourIds = new Set(catalog.modifications.filter((row) => row.modelUmapiId === SPRINTER_35T_VAN).map((row) => row.umapiId));
    const both = [...ourIds].filter((id) => apiPcIds.has(id)).length;
    console.log(`  в нашем файле: ${ourIds.size}; совпадают по PC_ID ↔ PCS_PC_ID: ${both}`);
    console.log(both === ourIds.size && ourIds.size > 0 ? "  → номера машин совпадают: справочник подходит к API напрямую" : "  → номера НЕ совпадают полностью: нужна таблица соответствия");
  }
}

console.log("\n3. Контрольный товар AFW1272: чьи это номера");
const found = [];
for (const candidate of CANDIDATES) {
  const rows = list(await get(`${auto}/BrandRefinement/${encodeURIComponent(candidate.article)}`));
  const brands = rows.map((row) => `${row.BRAND}${row.TYPE ? ` [${row.TYPE}]` : ""}`);
  console.log(`  ${candidate.article} (${candidate.note}): ${rows.length ? brands.slice(0, 12).join(", ") : "не найден"}${rows.length > 12 ? ` и ещё ${rows.length - 12}` : ""}`);
  if (rows[0]) console.log(`    поля: ${shape(rows[0])}`);
  if (candidate.brand) {
    const match = rows.find((row) => String(row.BRAND).toUpperCase().replace(/[\s-]+/gu, "") === candidate.brand.replace(/[\s-]+/gu, ""));
    if (match) found.push({ ...candidate, apiBrand: match.BRAND });
  }
}

console.log("\n4. Каталожный номер (ART_ID) и применимость");
let checked = false;
for (const candidate of found) {
  // The API has no «article by number and brand» method; the searched article is expected among the analogs it returns.
  const analogs = await get(`${auto}/Analogs/${encodeURIComponent(candidate.article)}/${encodeURIComponent(candidate.apiBrand)}`, { limit: 50 });
  const rows = list(analogs);
  console.log(`  аналогов у ${candidate.apiBrand} ${candidate.article}: ${analogs?.rows ?? rows.length} (содержимое не выводится и не сохраняется)`);
  const self = rows.find((row) => String(row.ARTICLE_NR).replace(/[\s-]/gu, "").toUpperCase() === candidate.article && String(row.BRAND).toUpperCase() === String(candidate.apiBrand).toUpperCase());
  if (!self) {
    console.log("    сама деталь среди ответа не найдена: ART_ID придётся получать иначе (спросить UMAPI или /v2/cross/parts/Analogs/getCrossInfo)");
    continue;
  }
  console.log(`    ART_ID найден: ${self.ART_ID}`);
  const links = await get(`${auto}/ArticleLinks/${self.ART_ID}`);
  const pcs = list(links?.PC);
  const ours = pcs.filter((row) => apiPcIds.has(Number(row.PC_ID)));
  console.log(`    применимость: ${pcs.length} легковых модификаций; из них Sprinter 3,5-t Фургон (B906): ${ours.length}`);
  console.log(`    → вердикт для этого Sprinter: ${ours.length ? "подходит (по каталогу)" : pcs.some((row) => Number(row.MS_ID) === SPRINTER_35T_VAN) ? "подходит к модели, другая модификация" : "в применимости не указан"}`);
  const article = await get(`${auto}/Article/${self.ART_ID}`, { Medias: true, Criterias: true, OeCodes: true });
  if (article) console.log(`    карточка: фото ${list(article.MEDIAS).length}, характеристик ${list(article.CRITERIAS).length}, OE-номеров ${list(article.OE_CODES).length}`);
  checked = true;
  break;
}
if (!checked) console.log("  проверка применимости не выполнена: ни один номер не дал ART_ID");

console.log(`\nЗапросов к UMAPI: ${calls}. Ничего не сохранено.`);
