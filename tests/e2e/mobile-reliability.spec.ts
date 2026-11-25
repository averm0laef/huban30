import { expect, test, type Page } from "@playwright/test";

const product = "/catalog/product/fixture-filter-0";
const fitmentRoute = "**/api/v1/umapi/product/*/fitment?*";

async function selectCar(page: Page) {
  await page.addInitScript((car) => {
    (globalThis as unknown as { localStorage: { setItem: (key: string, value: string) => void } }).localStorage
      .setItem("an30:parts-finder:picked-vehicle", JSON.stringify(car));
  }, { label: "Toyota Corolla", make: "Toyota", model: "Corolla", modificationId: 100_000_002 });
}

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { open, wait };
}

const emptyFitment = { makes: [], parts: [], status: "ok", total: 0, verdict: null, via: "own" };

test("a touch opens a search result after the input loses focus", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox").first();
  await search.tap();
  await search.fill("фильтр");
  const list = page.getByRole("listbox").first();
  await expect(list).toBeVisible();
  const result = list.getByRole("option").first();
  const expected = await result.getAttribute("href");
  await expect.poll(() => result.locator("img").evaluate((image) =>
    (image as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
  await search.blur();
  await expect(list).toBeVisible();
  await result.tap();
  await expect(page).toHaveURL(new RegExp(`${expected}$`, "u"));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Фильтр масляный MANN");
});

test("catalog navigation keeps the page in place and restores focus", async ({ page }) => {
  await page.goto("/catalog");
  const catalog = page.getByRole("navigation", { name: "Быстрая навигация" })
    .getByRole("button", { name: "Каталог" });
  await catalog.tap();
  const menu = page.getByRole("dialog", { name: "Меню магазина" });
  await expect(menu).toBeVisible();
  const filters = menu.getByRole("button", { name: "Подразделы: Фильтры" });
  await filters.tap();
  await expect(menu.getByRole("link", { name: "Масляные фильтры" })).toBeVisible();
  const scrollY = await page.evaluate(() => (globalThis as unknown as { scrollY: number }).scrollY);
  await menu.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (globalThis as unknown as { scrollY: number }).scrollY)).toBe(scrollY);
  await menu.getByRole("button", { name: "Закрыть меню" }).tap();
  await expect(menu).toBeHidden();
  await expect(catalog).toBeFocused();
});

test("the latest compatibility action owns the answer", async ({ page }) => {
  await selectCar(page);
  const releaseCheck = gate();
  const started = gate();
  await page.route(fitmentRoute, async (route) => {
    if (new URL(route.request().url()).searchParams.get("mode") === "check") {
      started.open();
      await releaseCheck.wait;
      await route.fulfill({ json: { ...emptyFitment, verdict: "fits" } });
    } else {
      await route.fulfill({ json: { status: "unknown_part" } });
    }
  });
  await page.goto(product);
  const check = page.getByRole("button", { name: "Проверить для моей машины" });
  const list = page.getByRole("button", { name: "Все машины, к которым подходит" });
  await check.tap();
  await started.wait;
  await list.tap();
  const result = page.getByText("У этой детали нет данных для проверки по каталогу");
  await expect(result).toHaveCount(1);
  const lateResponse = page.waitForResponse((response) => response.url().includes("mode=check"));
  releaseCheck.open();
  await lateResponse;
  await expect(result).toHaveCount(1);
  await expect(page.getByText("Подходит к вашему Toyota Corolla")).toHaveCount(0);
});

test("a known empty compatibility list offers VIN instead of repeating the list action", async ({ page }) => {
  await selectCar(page);
  await page.route(fitmentRoute, (route) => route.fulfill({ json: emptyFitment }));
  await page.goto(product);
  const list = page.getByRole("button", { name: "Все машины, к которым подходит" });
  await list.tap();
  await expect(page.getByText("В каталоге не указано ни одной машины для этой детали.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Свернуть список машин|Показать машины/u })).toHaveCount(0);
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Проверить по VIN", exact: true }).first()).toBeVisible();
});

test("adding one item keeps the checkout action yellow and preserves quantity after reload", async ({ page }) => {
  await page.goto(product);
  await page.getByRole("button", { name: "В корзину", exact: true }).first().tap();
  await expect(page.getByRole("link", { name: "В корзине", exact: true }).first()).toBeVisible();
  await page.goto("/cart");
  await expect(page.getByText("1 товар", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("1 товар", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти к оформлению" })).toHaveCSS("background-color", "rgb(245, 196, 0)");
});

test("a branded analogue request keeps the maker even when there are no results", async ({ page }) => {
  const seen: string[] = [];
  let legacyRequests = 0;
  await page.route("**/api/v1/parts-finder/resolve", (route) => route.fulfill({
    json: { article: "8100110SX", brand: "STELLOX", kind: "article", query: "Стеллокс 81-00110-SX", shop: [] },
  }));
  await page.route("**/api/v1/parts-finder/shop-analogs", (route) => route.fulfill({ json: { article: "8100110SX", offers: [] } }));
  await page.route("**/api/v1/parts-finder/crosses", (route) => {
    legacyRequests++;
    return route.fulfill({ json: { article: "8100110SX", status: "no_data" } });
  });
  await page.route("**/api/v1/umapi/number/analogs?*", (route) => {
    seen.push(new URL(route.request().url()).searchParams.get("brand") ?? "");
    return route.fulfill({ json: { article: "8100110SX", status: "no_data" } });
  });
  await page.goto(`/podbor?q=${encodeURIComponent("Стеллокс 81-00110-SX")}`);
  await page.getByRole("button", { name: "Найти аналоги", exact: true }).tap();
  await page.getByRole("button", { name: "Аналоги и замены от производителей" }).tap();
  await expect(page.getByText("Производители не указали аналогов для 8100110SX.")).toBeVisible();
  expect(seen).toEqual(["STELLOX"]);
  expect(legacyRequests).toBe(0);
});

test("the product card fits the storefront at 1440, 768 and 375 pixels", async ({ browserName, page }) => {
  await selectCar(page);
  await page.route(fitmentRoute, (route) => route.fulfill({ json: emptyFitment }));
  await page.goto(product);
  const result = page.getByText("В каталоге не указано ни одной машины для этой детали.");
  await page.getByRole("button", { name: "Все машины, к которым подходит" }).click();
  await expect(result).toBeVisible();
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => {
      const viewport = globalThis as unknown as { innerWidth: number; document: { documentElement: { scrollWidth: number } } };
      return viewport.document.documentElement.scrollWidth - viewport.innerWidth;
    })).toBeLessThanOrEqual(1);
    const screenshotDir = process.env.AN30_SCREENSHOT_DIR;
    if (screenshotDir) {
      await result.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${screenshotDir}/card-${browserName}-${width}.png` });
    }
  }
});

test("product breadcrumb separators are on the same line as the link text", async ({ page }) => {
  await page.goto(product);
  const breadcrumbs = page.getByRole("navigation", { name: "Хлебные крошки" });
  const textPositions = await breadcrumbs.evaluate(async (nav) => {
    await nav.ownerDocument.fonts.ready;
    return Array.from(nav.querySelectorAll('span[aria-hidden="true"]'), (separator) => {
      const glyph = nav.ownerDocument.createRange();
      glyph.selectNodeContents(separator);
      const { top, height } = glyph.getBoundingClientRect();
      return top + height / 2;
    });
  });
  expect(textPositions).toHaveLength(3);
  expect(Math.max(...textPositions) - Math.min(...textPositions)).toBeLessThanOrEqual(1);
});

test("catalog view toggle changes the layout and keeps the selected filters", async ({ page }) => {
  await page.goto("/catalog/filtry?availability=in_stock&sort=price_asc");
  const results = page.getByRole("region", { name: "Товары каталога" });
  const cards = results.getByRole("article");
  const view = page.getByRole("group", { name: "Вид каталога" });
  await expect(cards.first()).toBeVisible();
  const firstRowCount = () => cards.evaluateAll((items) => {
    const firstTop = items[0]!.getBoundingClientRect().top;
    return items.filter((item) => Math.abs(item.getBoundingClientRect().top - firstTop) < 1).length;
  });

  for (const [width, columns] of [[320, 2], [390, 2], [768, 3], [1440, 4]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(firstRowCount).toBe(columns);
    expect(await page.evaluate(() => {
      const viewport = globalThis as unknown as { innerWidth: number; document: { documentElement: { scrollWidth: number } } };
      return viewport.document.documentElement.scrollWidth - viewport.innerWidth;
    })).toBeLessThanOrEqual(1);
  }
  await view.getByRole("link", { name: "Списком" }).click();
  await expect(results).toHaveAttribute("data-catalog-view", "list");
  await expect.poll(firstRowCount).toBe(1);
  for (const [key, value] of [["availability", "in_stock"], ["sort", "price_asc"], ["view", "list"]] as const) {
    expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  }
  await page.reload();
  await expect(view.getByRole("link", { name: "Списком" })).toHaveAttribute("aria-current", "page");
  await view.getByRole("link", { name: "Плиткой" }).click();
  await expect.poll(firstRowCount).toBe(4);
});
