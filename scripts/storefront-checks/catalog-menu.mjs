// The catalogue menu of the header, checked the way a person uses it: the mouse travels across the screen instead
// of jumping, and the keyboard has to reach everything the mouse does. Screenshots cannot see any of this — the
// panel looked right while it closed on the way to it, while a second column of sections lay across the way to
// the subsections, and while the keyboard could not get to the subsections at all.
//
// Usage: node scripts/storefront-checks/catalog-menu.mjs [site address]      (default http://127.0.0.1:3000)
// Needs a storefront whose catalogue holds at least three sections with subsections. Exit code: 0 — every check
// passed, 1 — a check failed, 2 — the stand has too few sections to check anything.
import { chromium } from "@playwright/test";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/u, "");
const credentials = process.env.SITE_USER && process.env.SITE_PASSWORD
  ? { httpCredentials: { password: process.env.SITE_PASSWORD, username: process.env.SITE_USER } } : {};
const PANEL = 'nav[aria-label="Меню каталога"]';
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
/** Moves the mouse at walking pace: 30 steps, 40 ms apart, unless told otherwise. */
async function glide(page, from, to, steps = 30, pause = 40) {
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
    await page.waitForTimeout(pause);
  }
}
/** The section whose subsections are on the screen. */
const inHand = (page) => page.evaluate((selector) => document.querySelector(`${selector} > ul > li > div[id] strong`)?.textContent ?? null, PANEL);
/** Sections of the open panel that have subsections, in the order of the list. */
const sectionsWithSubsections = (page) => page.evaluate((selector) => [...document.querySelectorAll(`${selector} > ul > li`)]
  .filter((row) => row.querySelector(":scope > button")).map((row) => row.querySelector(":scope > a").textContent.trim()), PANEL);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
let tooFew = false;
for (const [width, height] of [[1440, 900], [1180, 720]]) {
  const context = await browser.newContext({ ...credentials, deviceScaleFactor: 1, viewport: { height, width } });
  const page = await context.newPage();
  await page.goto(`${base}/`, { timeout: 45_000, waitUntil: "networkidle" });
  const panel = page.locator(PANEL);
  const toggle = page.getByRole("button", { exact: true, name: "Меню каталога" });
  if (await toggle.count() === 0) {
    console.log(`${width}: «Каталог» is a plain link here — the catalogue gave the storefront no sections`);
    tooFew = true;
    await context.close();
    break;
  }

  // --- the mouse: from the button down to the panel ---
  const buttonBox = await page.getByRole("banner").getByRole("link", { exact: true, name: "Каталог" }).boundingBox();
  const button = centre(buttonBox);
  await page.mouse.move(button.x, button.y);
  await page.waitForTimeout(450);
  const panelBox = await panel.boundingBox();
  if (!panelBox) {
    check(`${width}: resting on «Каталог» opens the panel`, false);
    await context.close();
    continue;
  }
  await glide(page, button, { x: button.x, y: panelBox.y + 30 }, 24, 50);
  await page.waitForTimeout(450);
  check(`${width}: the panel stays open while the mouse goes down to it`, await panel.isVisible(),
    `${Math.round(panelBox.y - (buttonBox.y + buttonBox.height))} px between the button and the panel`);

  const names = await sectionsWithSubsections(page);
  if (names.length < 3) {
    console.log(`${width}: only ${names.length} section(s) with subsections — nothing to switch between`);
    tooFew = true;
    await context.close();
    break;
  }
  // Not the first section (it is in hand when the panel opens), and one with others above it to cross.
  const first = names[Math.min(names.length - 1, 5)];
  const second = names[Math.min(names.length - 1, 7)] === first ? names[1] : names[Math.min(names.length - 1, 7)];
  const row = panel.getByRole("link", { exact: true, name: first });

  // --- the mouse: a section, then one of its subsections ---
  const rowCentre = centre(await row.boundingBox());
  await glide(page, { x: button.x, y: panelBox.y + 30 }, rowCentre);
  await page.waitForTimeout(450);
  check(`${width}: resting on «${first}» shows its subsections`, (await inHand(page)) === first, `on the screen: ${await inHand(page)}`);
  const target = await page.evaluate((selector) => {
    const links = [...document.querySelectorAll(`${selector} > ul > li > div[id] > ul a`)];
    const link = links[Math.min(1, links.length - 1)];
    const box = link?.getBoundingClientRect();
    return box ? { label: link.textContent, x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  }, PANEL);
  await glide(page, rowCentre, target);
  await page.waitForTimeout(450);
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.textContent ?? null, [target.x, target.y]);
  check(`${width}: the mouse reaches «${target.label}» of «${first}» at walking pace`, (await inHand(page)) === first && under === target.label,
    `on the screen: ${await inHand(page)}, under the pointer: ${under}`);

  // --- the mouse: back to the list, another section ---
  const other = centre(await panel.getByRole("link", { exact: true, name: second }).boundingBox());
  const start = { x: width / 2, y: panelBox.y + 120 };
  await page.mouse.move(start.x, start.y);
  await glide(page, start, other);
  await page.waitForTimeout(450);
  check(`${width}: pointing at «${second}» after that picks it`, (await inHand(page)) === second, `on the screen: ${await inHand(page)}`);

  // --- the mouse: setting off for the subsections and stopping on another section on the way ---
  const firstSubsection = await page.evaluate((selector) => {
    const box = document.querySelector(`${selector} > ul > li > div[id] > ul a`)?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  }, PANEL);
  const stop = { x: other.x + (firstSubsection.x - other.x) * 0.3, y: other.y + (firstSubsection.y - other.y) * 0.3 };
  const stopOn = await page.evaluate(([selector, x, y]) => document.elementFromPoint(x, y)?.closest(`${selector} > ul > li`)?.querySelector(":scope > a")?.textContent.trim() ?? null, [PANEL, stop.x, stop.y]);
  if (stopOn && stopOn !== second) {
    await glide(page, other, stop, 12);
    const during = await inHand(page);
    await page.waitForTimeout(900);
    check(`${width}: stopping on «${stopOn}» on the way picks it after a pause`, during === second && (await inHand(page)) === stopOn,
      `while moving: ${during}; after the pause: ${await inHand(page)}`);
  } else {
    console.log(`skip ${width}: no other section lies on the way from «${second}» to its subsections`);
  }

  const layout = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const shown = [...element.querySelectorAll("a, button")].filter((target) => target.getClientRects().length > 0);
    return {
      inside: box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: shown.filter((target) => target.getBoundingClientRect().height < 44 || target.getBoundingClientRect().width < 44).map((target) => target.textContent.trim().slice(0, 24)),
    };
  });
  check(`${width}: the panel is inside the screen, nothing scrolls sideways, every target is 44 px or more`,
    layout.inside && layout.sideways === 0 && layout.small.length === 0, JSON.stringify(layout));
  await page.keyboard.press("Escape");
  await page.mouse.move(width / 2, height - 40);
  await page.waitForTimeout(450);

  // --- the keyboard ---
  await toggle.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const before = await inHand(page);
  const keyboard = names.find((name) => name !== before);
  await panel.getByRole("link", { exact: true, name: keyboard }).focus();
  await page.waitForTimeout(250);
  check(`${width}: focus alone does not switch the section`, before !== keyboard && (await inHand(page)) === before, `before: ${before}, after: ${await inHand(page)}`);
  await page.keyboard.press("Tab");
  const onButton = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const expanded = await page.evaluate(() => document.activeElement?.getAttribute("aria-expanded"));
  const shown = await inHand(page);
  await page.keyboard.press("Tab");
  const title = await page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/gu, " ").trim());
  await page.keyboard.press("Tab");
  // «:scope >»: a bare "ul a" would also match the block's own title link, which sits inside the outer list.
  const subsection = await page.evaluate((selector) => {
    const block = document.querySelector(`${selector} > ul > li > div[id]`);
    return document.activeElement === block?.querySelector(":scope > ul a") ? document.activeElement.textContent : null;
  }, PANEL);
  check(`${width}: the keyboard opens «${keyboard}» and walks into its subsections`,
    onButton === `Подразделы: ${keyboard}` && expanded === "true" && shown === keyboard && Boolean(title?.startsWith(keyboard)) && subsection !== null,
    `Tab → ${onButton}; aria-expanded ${expanded}; on the screen: ${shown}; Tab → «${title}»; Tab → «${subsection}»`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check(`${width}: Escape closes the panel and returns the focus to the arrow`, await panel.isHidden() && await toggle.evaluate((element) => element === document.activeElement));

  // --- the end of the list ---
  await toggle.click();
  await page.waitForTimeout(250);
  const last = panel.locator(":scope > ul > li:last-child > a");
  await last.scrollIntoViewIfNeeded();
  check(`${width}: the last section («${(await last.textContent()).trim()}») can be brought into sight`, await last.isVisible());
  await context.close();
  // The API counts requests per visitor; a pause keeps this script from tripping its own limit.
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
await browser.close();
process.exitCode = tooFew ? 2 : results.every(Boolean) ? 0 : 1;
