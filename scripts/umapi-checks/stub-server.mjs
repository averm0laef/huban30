#!/usr/bin/env node
/**
 * A local stand-in for the UMAPI API, to try the product page's catalogue buttons without a key and without a
 * single paid request (docs/UMAPI_INTEGRATION.md). It answers in the shapes the real API gave with the owner's key
 * on 23.11.2026 (BrandRefinement, getCrossInfo, Analogs without the part itself, ArticleLinks) with MADE-UP data:
 * the makers and analogs below are not real catalogue facts. Numbers arrive bare, as the API asks them: «W9142».
 *
 *   node scripts/umapi-checks/stub-server.mjs            # http://127.0.0.1:4100
 *
 * Then start the API with
 *   UMAPI_API_KEY=stub UMAPI_BASE_URL=http://127.0.0.1:4100 UMAPI_MEDIA_BASE_URL=http://127.0.0.1:4100/media
 *
 * The cars a part «fits» are Toyota Corolla sedan E12 (all engines but the first) and Mercedes-Benz Sprinter
 * 3,5-t van B906, taken from our vehicle file (local-data/umapi/cb_passenger_cars.csv) so that a car picked on the
 * site matches.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4100);

// Our demo products' numbers -> a maker; any other number is answered with no maker.
const MAKERS = { "3397004587": "BOSCH", BKR6E: "NGK", C25114: "MANN-FILTER", GDB1550: "TRW", K1288: "FILTRON", CU3569: "MANN-FILTER", W9142: "MANN-FILTER" };
// Made-up analogs, so that «Найти ещё аналоги в каталоге» has something of ours to show.
const ANALOGS = { GDB1550: [["W914/2", "MANN-FILTER"]], C25114: [["BKR6E", "NGK"]], K1288: [["CU3569", "MANN-FILTER"]] };
const bare = (number) => number.toUpperCase().replace(/[^0-9A-Z]/gu, "");

function cars() {
  const csv = path.join(root, "local-data/umapi/cb_passenger_cars.csv");
  const reader = path.join(root, "packages/database/dist/vehicle-catalog-csv.js");
  if (!existsSync(csv) || !existsSync(reader)) return Promise.resolve([]);
  return import(reader).then(({ readVehicleCatalog }) => {
    const file = readVehicleCatalog(readFileSync(csv, "utf8").split("\n"));
    const makes = new Map(file.makes.map((make) => [make.umapiId, make.name]));
    const wanted = file.models.filter((model) => model.name === "COROLLA седан (_E12_)" || model.name === "SPRINTER 3,5-t Фургон (B906)");
    return wanted.flatMap((model) => file.modifications.filter((item) => item.modelUmapiId === model.umapiId)
      .slice(model.name.startsWith("COROLLA") ? 1 : 0)
      .map((item) => ({
        CI_FROM: item.producedFrom, CI_TO: item.producedTo, MANUFACTURER: makes.get(model.makeUmapiId), MFA_ID: model.makeUmapiId,
        MODEL_SERIES: model.name, MS_ID: model.umapiId, PASSENGER_CAR: item.name, PC_ID: item.umapiId,
      })));
  });
}

const artIdOf = (number) => 900_000 + [...number].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 90_000, 7);
const links = await cars();
const media = readFileSync(path.join(root, "apps/web/public/categories/tormoznye-kolodki.webp"));

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const send = (status, body) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/media/")) { response.writeHead(200, { "Content-Type": "image/webp" }); response.end(media); return; }
  if (request.headers["x-app-key"] !== "stub") return send(401, { message: "Unauthorized", statusCode: 401 });
  const route = decodeURIComponent(url.pathname.replace(/^\/v2\/autocatalog\/[a-z]{2}-[A-Z]{1,3}/u, ""));
  console.log(`${request.method} ${route}${url.search}`);
  let match = /^\/BrandRefinement\/(.+)$/u.exec(route);
  if (match) {
    const brand = MAKERS[match[1]];
    return send(200, brand ? [{ BRAND: brand, BRA_ID: 1, DISPLAY_NR: match[1], TITLE: "Деталь (заглушка)", TYPE: "ArticleNumber" }] : []);
  }
  if (url.pathname === "/v2/cross/parts/Analogs/getCrossInfo") {
    const number = bare(url.searchParams.get("article") ?? "");
    const brand = url.searchParams.get("brand");
    if (!MAKERS[number] || MAKERS[number] !== brand) return send(404, { message: "Not found", statusCode: 404 });
    const medias = [{ FILE_NAME: "part.webp", SORT: 1 }];
    return send(200, { article: number, brand, catalogId: artIdOf(number), title: "Деталь (заглушка)", td: { ARTICLE_NR: number, ART_ID: artIdOf(number), BRAND: brand, COMPLETE_DES: "Деталь (заглушка)", MEDIAS: medias, SUP_ID: 1 } });
  }
  match = /^\/Analogs\/([^/]+)\/(.+)$/u.exec(route);
  if (match) {
    // As in the real API: the analogs only, never the asked part itself.
    const rows = (ANALOGS[match[1]] ?? []).map(([article, maker]) => ({ ARTICLE_NR: article, ART_ID: artIdOf(bare(article)), BRAND: maker, COMPLETE_DES: "Деталь (заглушка)" }));
    return send(200, { data: rows, limit: 50, offset: 0, rows: rows.length });
  }
  if (/^\/ArticleLinks\/\d+$/u.test(route)) return send(200, { PC: links });
  return send(404, { message: "Not found", statusCode: 404 });
}).listen(PORT, "127.0.0.1", () => console.log(`UMAPI stub on http://127.0.0.1:${PORT} (${links.length} car links)`));
