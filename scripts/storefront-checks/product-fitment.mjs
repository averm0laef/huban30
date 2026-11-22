// «Применимость» on a product page, the way a customer meets it, against a stubbed parts catalogue: the page must
// ask the catalogue nothing when it opens, even with a car chosen; each button costs one request of the site
// (two of the catalogue, docs/TECDOC.md); a second press in the same visit costs nothing. Screenshots at 1440, 768
// and 375 px go to /tmp/an30-fitment/ and every width is checked for horizontal scrolling.
//
// Usage: node scripts/storefront-checks/product-fitment.mjs [site address] [product slug]
// The product must be a part with a brand and a number (partNumberCatalogueApplies). Nothing real is called: the
// catalogue's answers are stubbed in the browser. Exit code: 0 — every check passed, 1 — a check failed.
import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/u, "");
const slug = process.argv[3];
if (!slug) {
  console.error("Usage: node scripts/storefront-checks/product-fitment.mjs <site address> <product slug>");
  process.exit(1);
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const CAR = { engine: "2.0 · 3S-FE", generation: "T21 · 1997–2002", label: "Toyota Caldina T21 2.0", make: "Toyota", model: "Caldina", tecdoc: { genId: 9001, msId: 2 } };
const ARTICLE = { brand: "LYNXAUTO", name: "Фильтр масляный", number: "LC-341" };
const ANSWERS = {
  check: { article: ARTICLE, makes: [], oems: [], status: "ok", total: 0, verdict: "fits" },
  list: {
    article: ARTICLE,
    makes: [
      { make: "Toyota", models: [{ generations: 4, model: "CALDINA универсал (_T21_)", msId: 2, series: "CALDINA" }, { generations: 6, model: "COROLLA седан (_E11_)", msId: 3, series: "COROLLA" }] },
      { make: "Lexus", models: [{ generations: 2, model: "RX (_U1_)", msId: 4, series: "RX" }] },
    ],
    oems: [{ brand: "TOYOTA", number: "90915-YZZE1" }, { brand: "TOYOTA", number: "90915-10003" }],
    status: "ok", total: 3, verdict: null,
  },
};
const OUT = "/tmp/an30-fitment";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
for (const [width, height] of [[1440, 900], [768, 1024], [375, 812]]) {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { height, width } });
  const calls = [];
  await context.route("**/api/v1/parts-finder/status", (route) => route.fulfill({ json: { catalog: "tecdoc", enabled: true } }));
  await context.route("**/api/v1/tecdoc/product/*/fitment**", (route) => {
    const mode = new URL(route.request().url()).searchParams.get("mode") ?? "list";
    calls.push(mode);
    return route.fulfill({ json: ANSWERS[mode] });
  });
  await context.addInitScript((car) => window.localStorage.setItem("an30:parts-finder:picked-vehicle", JSON.stringify(car)), CAR);
  const page = await context.newPage();
  await page.goto(`${base}/catalog/product/${slug}`, { timeout: 45_000, waitUntil: "networkidle" });
  await page.waitForTimeout(1_500);
  const section = page.locator('section[aria-labelledby="product-fitment-title"]');
  await section.scrollIntoViewIfNeeded();
  check(`${width}px: opening the page with a car chosen asks the catalogue nothing`, calls.length === 0, `calls: ${calls.join(",") || "none"}`);
  const checkButton = section.getByRole("button", { name: /Проверить, подойдёт ли к Toyota Caldina/u });
  const listButton = section.getByRole("button", { name: "К каким машинам подходит" });
  check(`${width}px: two buttons, the check for the car first`, await checkButton.count() === 1 && await listButton.count() === 1);
  await page.screenshot({ fullPage: false, path: `${OUT}/${width}-buttons.png` });
  await checkButton.click();
  await section.getByText("Подходит вашему автомобилю: Toyota Caldina").waitFor({ timeout: 5_000 });
  check(`${width}px: the check is one request`, calls.join(",") === "check", calls.join(","));
  await listButton.click();
  await section.getByText("Оригинальные номера:").waitFor({ timeout: 5_000 });
  check(`${width}px: the list is one more`, calls.join(",") === "check,list", calls.join(","));
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ fullPage: false, path: `${OUT}/${width}-answers.png` });
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  check(`${width}px: no horizontal scrolling`, overflow <= 0, `${overflow}px`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1_000);
  await section.getByRole("button", { name: /Проверить, подойдёт ли/u }).click();
  await section.getByText("Подходит вашему автомобилю: Toyota Caldina").waitFor({ timeout: 5_000 });
  check(`${width}px: a second press in the same visit costs nothing`, calls.length === 2, calls.join(","));
  await context.close();
}
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
