#!/usr/bin/env node
/**
 * The storefront on an iPhone, in WebKit (Safari's engine) with touch: what a phone owner reported broken on
 * 23–24.11.2026 and a screenshot cannot show.
 *
 *   node scripts/storefront-checks/mobile-webkit.mjs [site address] [query]
 *
 * Checks, in order:
 *  1. A tap on a search suggestion opens that product (Safari drops the focus before the link is activated).
 *  2. The suggestion list stays open and in place while it is scrolled, and after the keyboard closes (input blur).
 *  3. The header folds while the page is scrolled down and comes back on the way up.
 *  4. «Каталог» in the bottom bar opens the catalogue drawer; the drawer scrolls and the page under it does not move.
 *  5. No page scrolls sideways.
 *
 * Read-only: nothing is submitted. Site password (closed site): SITE_USER and SITE_PASSWORD in the environment.
 * Exit code 0 — all passed, 1 — a FAIL line above.
 */
import { devices, webkit } from "@playwright/test";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/+$/u, "");
const query = process.argv[3] ?? "фильтр";
const credentials = process.env.SITE_USER && process.env.SITE_PASSWORD
  ? { httpCredentials: { password: process.env.SITE_PASSWORD, username: process.env.SITE_USER } } : {};

let failed = 0;
const report = (ok, what, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"], ...credentials });
const errors = [];
async function scenarioPage() {
  const tab = await context.newPage();
  tab.on("pageerror", (error) => errors.push(`${new URL(tab.url()).pathname}: ${error.message}`));
  return tab;
}
let page = await scenarioPage();

async function sidewaysScroll(where) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  report(extra <= 1, `${where}: без прокрутки вбок`, extra > 1 ? `шире экрана на ${extra} px` : "");
}

// 1–2. Search suggestions.
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await sidewaysScroll("главная");
const input = page.getByRole("combobox").first();
await input.tap();
await input.pressSequentially(query, { delay: 40 });
const options = page.getByRole("option");
try {
  await options.first().waitFor({ state: "visible", timeout: 8000 });
} catch {
  report(false, `подсказки по «${query}» появились`);
}
const count = await options.count();
if (count > 0) {
  const list = page.getByRole("listbox").first();
  const before = await list.boundingBox();
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await pause(300);
  const after = await list.boundingBox();
  report(Boolean(before && after && Math.abs(before.y - after.y) < 2), "список подсказок не сдвигается при прокрутке",
    before && after ? `было y=${Math.round(before.y)}, стало ${Math.round(after.y)}` : "");
  await input.evaluate((element) => element.blur());
  await pause(400);
  report(await list.isVisible(), "подсказки остаются после закрытия клавиатуры");

  const target = options.nth(Math.min(1, count - 1));
  const href = await target.getAttribute("href");
  await target.scrollIntoViewIfNeeded();
  await target.tap();
  try {
    await page.waitForURL((url) => url.pathname === href, { timeout: 8000 });
    report(true, "касание подсказки открывает товар", href ?? "");
  } catch {
    report(false, "касание подсказки открывает товар", `осталась ${new URL(page.url()).pathname}, ждали ${href}`);
  }
  await sidewaysScroll("карточка товара");
}

// Independent scenarios use separate tabs: a forced navigation would cancel the previous tab's prefetch in WebKit.
// 2a. A typed VIN: «Подбор по VIN» banner on any page, and one action in the suggestions that opens the decoder.
page = await scenarioPage();
await page.goto(`${base}/catalog`, { waitUntil: "networkidle" });
const banner = page.getByRole("link", { name: /Подбор по VIN/u }).first();
report(await banner.isVisible().catch(() => false), "блок «Подбор по VIN» под поиском не только на главной");
const vinInput = page.getByRole("combobox").first();
await vinInput.tap();
await vinInput.pressSequentially("XTAGFK330JY144213", { delay: 20 });
const vinAction = page.getByRole("link", { name: /Подобрать запчасти по VIN/u }).first();
const vinShown = await vinAction.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
report(vinShown, "набранный VIN даёт «Подобрать запчасти по VIN»");
if (vinShown) {
  await vinAction.tap();
  const opened = await page.waitForURL(/\/podbor\?vin=XTAGFK330JY144213/u, { timeout: 8000 }).then(() => true, () => false);
  report(opened, "касание открывает подбор по VIN");
}

// 3. Header folds on the way down and returns on the way up.
page = await scenarioPage();
await page.goto(`${base}/catalog`, { waitUntil: "networkidle" });
const header = page.locator("header").first();
const open = (await header.boundingBox())?.height ?? 0;
for (let y = 0; y <= 1200; y += 80) { await page.evaluate((top) => window.scrollTo(0, top), y); await pause(50); }
await pause(500);
const folded = (await header.boundingBox())?.height ?? 0;
report(folded < open - 20, "шапка сворачивается при прокрутке вниз", `${Math.round(open)} → ${Math.round(folded)} px`);
for (let y = 1200; y >= 900; y -= 40) { await page.evaluate((top) => window.scrollTo(0, top), y); await pause(50); }
await pause(500);
const back = (await header.boundingBox())?.height ?? 0;
report(back > folded + 20, "шапка возвращается при прокрутке вверх", `${Math.round(folded)} → ${Math.round(back)} px`);
await sidewaysScroll("каталог");

// 4. The catalogue drawer from the bottom bar.
// The header transition lasts 320 ms and its scroll anchor settles at 360 ms.
// Measure the drawer lock after that transition, so its movement is not counted as drawer scrolling.
await page.evaluate(() => window.scrollTo(0, 400));
await pause(500);
const pageTop = await page.evaluate(() => window.scrollY);
const catalogue = page.getByRole("navigation", { name: "Быстрая навигация" }).getByRole("button", { name: /Каталог/u })
  .or(page.getByRole("navigation", { name: "Быстрая навигация" }).getByRole("link", { name: /Каталог/u })).first();
await catalogue.tap();
await pause(600);
const drawer = page.locator("dialog[open]").first();
const drawerOpen = await drawer.isVisible().catch(() => false);
report(drawerOpen, "«Каталог» внизу открывает меню разделов");
if (drawerOpen) {
  const sections = await drawer.getByRole("link").count();
  report(sections >= 3, "в меню есть разделы", `${sections} ссылок`);
  await drawer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await pause(300);
  const scrolled = await drawer.evaluate((element) => element.scrollTop);
  const pageNow = await page.evaluate(() => window.scrollY);
  report(scrolled > 0, "меню прокручивается");
  report(Math.abs(pageNow - pageTop) < 2, "страница под меню не сдвигается", `было ${pageTop}, стало ${pageNow}`);
}

report(errors.length === 0, "без ошибок JavaScript", errors.slice(0, 3).join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
