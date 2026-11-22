// How many requests ONE visitor makes the storefront send to the API within a minute, by rate-limit area. The
// API counts requests per visitor (60 or 120 a minute, apps/api/src/catalog/catalog-public.controller.ts), and a
// page that asks too often makes the visitor trip the limit himself: on 22.11.2026 the home page, the catalogue
// menu and /catalog together asked for the category tree 63 times, because every link to a section that
// Next.js prefetched cost one request.
//
// Usage: REDIS_URL=redis://127.0.0.1:6379/9 node scripts/storefront-checks/api-requests-per-visit.mjs [site address]
// Reads the API's rate counters (keys an30:rate:<area>:<digest>) from the stand's Redis — reads only. Needs
// `redis-cli`, a storefront built for production (`next start`: a dev server does not prefetch) and a quiet
// stand: it waits until the counters are empty, so nobody else may be browsing.
// Exit code: 0 — no area went over half of the lowest limit (30), 1 — one did.
import { execFileSync } from "node:child_process";

import { chromium } from "@playwright/test";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/u, "");
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("REDIS_URL is not set: the address of the stand's Redis, e.g. redis://127.0.0.1:6379/9");
  process.exit(2);
}
const redis = (...args) => execFileSync("redis-cli", ["-u", redisUrl, "--no-auth-warning", ...args], { encoding: "utf8" }).trim();
function counters() {
  const counts = {};
  for (const key of redis("--scan", "--pattern", "an30:rate:*").split("\n").filter(Boolean)) {
    const area = key.replace(/^an30:rate:/u, "").replace(/:[0-9a-f]+$/u, "");
    counts[area] = (counts[area] ?? 0) + Number(redis("GET", key) || 0);
  }
  return counts;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (Object.keys(counters()).length > 0) await wait(3000);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const page = await (await browser.newContext({ deviceScaleFactor: 1, viewport: { height: 900, width: 1440 } })).newPage();
let shells = 0;
page.on("request", (request) => { if (request.url().includes("_rsc=")) shells += 1; });
let worst = 0;
function report(step) {
  const counts = counters();
  worst = Math.max(worst, ...Object.values(counts));
  const line = Object.entries(counts).sort().map(([area, count]) => `${area} ${count}`).join(", ") || "nothing";
  console.log(`${step}: ${line} | page shells the browser has prefetched so far: ${shells}`);
}

await page.goto(`${base}/`, { timeout: 45_000, waitUntil: "networkidle" });
await wait(2500);
report("the home page");
const toggle = page.getByRole("button", { exact: true, name: "Меню каталога" });
if (await toggle.count() > 0) {
  const button = await page.getByRole("banner").getByRole("link", { exact: true, name: "Каталог" }).boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await wait(3500);
  report("+ the catalogue menu");
  await page.keyboard.press("Escape");
  await page.mouse.move(700, 880);
}
await page.goto(`${base}/catalog`, { timeout: 45_000, waitUntil: "networkidle" });
await wait(3500);
report("+ /catalog");
await page.goto(`${base}/catalog?page=2`, { timeout: 45_000, waitUntil: "networkidle" });
await wait(3500);
report("+ /catalog, page 2");
const section = page.getByRole("navigation", { name: "Разделы каталога" }).getByRole("link").first();
if (await section.count() > 0) {
  await section.click();
  await page.waitForLoadState("networkidle");
  await wait(3500);
  report("+ a section");
}
const product = page.locator('main a[href^="/catalog/product/"]').first();
if (await product.count() > 0) {
  await product.click();
  await page.waitForLoadState("networkidle");
  await wait(2500);
  report("+ a product");
}
await browser.close();
console.log(worst <= 30 ? `the busiest area took ${worst} of the 60 a visitor may spend in a minute` : `TOO MANY: one area took ${worst} requests in under a minute`);
process.exitCode = worst <= 30 ? 0 : 1;
