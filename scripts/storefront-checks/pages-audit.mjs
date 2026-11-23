#!/usr/bin/env node
/**
 * Every storefront page at 1440, 768 and 375 px: what a screenshot shows and what it hides. Written for the
 * owner's request of 24.11.2026 («проверяй абсолютно каждую страницу»).
 *
 *   node scripts/storefront-checks/pages-audit.mjs [site address] [output folder]
 *
 * The page list is read from the site itself: every internal link of the home page (header, menu, footer), plus a
 * catalogue section, a product, a search, a VIN and a missing page. For each page and width it records the HTTP
 * status, JavaScript errors, sideways scroll, broken images, buttons and links without a name, and on a phone the
 * tap targets under 44 px and text under 12 px. Screenshots go to the output folder (default /tmp/an30-pages);
 * the summary is printed as a Markdown table and saved as report.md there.
 *
 * Read-only: nothing is submitted. Closed site: SITE_USER and SITE_PASSWORD in the environment.
 * Exit code 0 — no page failed, 1 — a FAIL row.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/+$/u, "");
const out = process.argv[3] ?? "/tmp/an30-pages";
mkdirSync(out, { recursive: true });
const credentials = process.env.SITE_USER && process.env.SITE_PASSWORD
  ? { httpCredentials: { password: process.env.SITE_PASSWORD, username: process.env.SITE_USER } } : {};
const widths = [[1440, 900], [768, 1024], [375, 812]];

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ ...credentials, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// The page list, from the site's own links.
await page.goto(`${base}/`, { waitUntil: "networkidle" });
const linked = await page.evaluate(() => [...document.querySelectorAll("a[href]")]
  .map((a) => new URL(a.getAttribute("href"), location.href))
  .filter((url) => url.origin === location.origin && !url.pathname.startsWith("/api/"))
  .map((url) => url.pathname + url.search));
const section = linked.find((href) => /^\/catalog\/[^/?]+$/u.test(href) && !href.startsWith("/catalog/product/"));
await page.goto(`${base}${section ?? "/catalog"}`, { waitUntil: "networkidle" });
const product = await page.evaluate(() => document.querySelector('a[href^="/catalog/product/"]')?.getAttribute("href") ?? null);
const pages = [...new Set([
  "/", "/catalog", ...(section ? [section] : []), ...(product ? [product] : []), "/catalog?q=%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80",
  "/podbor", "/podbor?vin=XTAGFK330JY144213", "/cart", "/auth?mode=login", "/auth?mode=register", "/chat",
  ...linked.filter((href) => !href.includes("#") && !href.startsWith("/catalog/product/")),
  "/this-page-does-not-exist",
])].slice(0, 60);

const rows = [];
let failed = 0;
for (const href of pages) {
  for (const [width, height] of widths) {
    await page.setViewportSize({ height, width });
    const errors = [];
    const onError = (error) => errors.push(error.message.slice(0, 120));
    // Failed requests are read from the responses, with their address; the browser's own «Failed to load resource»
    // console line says nothing about which. A guest's /auth/session answers 401 by design (one per page).
    const onConsole = (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text().slice(0, 120));
    };
    const onResponse = (response) => {
      const url = new URL(response.url());
      if (response.status() < 400 || url.origin !== new URL(base).origin) return;
      if (url.pathname === "/api/v1/auth/session" && response.status() === 401) return;
      if (response.request().isNavigationRequest() && href === "/this-page-does-not-exist") return;
      errors.push(`${response.status()} ${url.pathname}`);
    };
    page.on("pageerror", onError);
    page.on("console", onConsole);
    page.on("response", onResponse);
    let status = 0;
    try {
      const response = await page.goto(`${base}${href}`, { timeout: 30_000, waitUntil: "networkidle" });
      status = response?.status() ?? 0;
    } catch (error) {
      errors.push(`load: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
    }
    await page.waitForTimeout(400);
    const facts = await page.evaluate((phone) => {
      const visible = (element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const controls = [...document.querySelectorAll("a[href], button, [role=button], input:not([type=hidden]), select, textarea")].filter(visible);
      const unnamed = controls.filter((element) => {
        const name = (element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent ?? "").trim()
          || element.getAttribute("aria-labelledby") || element.querySelector("img[alt]:not([alt=''])")
          || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) || element.closest("label")
          || element.getAttribute("placeholder");
        return !name;
      });
      const small = phone ? controls.filter((element) => {
        const box = element.getBoundingClientRect();
        return (box.width < 44 || box.height < 44) && !element.closest("p, li > p, small, nav[aria-label='Хлебные крошки'], footer p");
      }) : [];
      const tinyText = phone ? [...document.querySelectorAll("body *")].filter((element) => element.childNodes.length > 0
        && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
        && visible(element) && parseFloat(getComputedStyle(element).fontSize) < 12) : [];
      const broken = [...document.images].filter((image) => image.complete && image.naturalWidth === 0 && visible(image));
      const describe = (element) => `${element.tagName.toLowerCase()}${element.className && typeof element.className === "string" ? `.${element.className.split(" ")[0].slice(0, 30)}` : ""}`;
      return {
        broken: broken.map((image) => image.currentSrc || image.src).slice(0, 3),
        sideways: document.documentElement.scrollWidth - innerWidth,
        small: small.length, smallSample: small.slice(0, 3).map(describe),
        tinyText: tinyText.length, tinySample: tinyText.slice(0, 3).map(describe),
        title: document.title,
        unnamed: unnamed.length, unnamedSample: unnamed.slice(0, 3).map(describe),
      };
    }, width < 768);
    page.off("pageerror", onError);
    page.off("console", onConsole);
    page.off("response", onResponse);
    const file = `${href.replace(/[^a-z0-9а-я]+/giu, "_").replace(/^_|_$/gu, "") || "home"}-${width}.png`;
    await page.screenshot({ fullPage: false, path: path.join(out, file) }).catch(() => undefined);
    const expectedMissing = href === "/this-page-does-not-exist";
    const bad = (!expectedMissing && (status === 0 || status >= 400)) || (expectedMissing && status !== 404)
      || facts.sideways > 1 || facts.broken.length > 0 || errors.length > 0 || facts.unnamed > 0;
    if (bad) failed += 1;
    rows.push({ bad, errors, facts, file, href, status, width });
    console.log(`${bad ? "FAIL" : "ok  "} ${width} ${href} — ${status}${facts.sideways > 1 ? `, вбок +${facts.sideways}px` : ""}${facts.unnamed ? `, без названия ${facts.unnamed} (${facts.unnamedSample.join(", ")})` : ""}${facts.broken.length ? `, битые картинки ${facts.broken.length}` : ""}${errors.length ? `, ошибки: ${errors.slice(0, 2).join(" | ")}` : ""}${facts.small ? `, мелкие цели ${facts.small}` : ""}${facts.tinyText ? `, текст <12px ${facts.tinyText}` : ""}`);
  }
}
await browser.close();

const table = [
  `# Обход страниц ${base} — ${new Date().toISOString()}`, "",
  "| Страница | Ширина | Ответ | Итог | Вбок | Без названия | Битые фото | Ошибки JS | Мелкие цели (телефон) | Текст < 12px | Снимок |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map(({ bad, errors, facts, file, href, status, width }) => `| \`${href}\` | ${width} | ${status} | ${bad ? "**FAIL**" : "ok"} | ${facts.sideways > 1 ? facts.sideways : ""} | ${facts.unnamed || ""} ${facts.unnamedSample.join(", ")} | ${facts.broken.length || ""} | ${errors.slice(0, 2).join("; ").replace(/\|/gu, "/")} | ${facts.small || ""} ${facts.smallSample.join(", ")} | ${facts.tinyText || ""} | ${file} |`),
];
writeFileSync(path.join(out, "report.md"), `${table.join("\n")}\n`);
console.log(`\n${pages.length} страниц × 3 ширины; не прошли: ${failed}. Отчёт: ${path.join(out, "report.md")}`);
process.exit(failed ? 1 : 0);
