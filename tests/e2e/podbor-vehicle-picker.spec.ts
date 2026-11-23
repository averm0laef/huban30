import { expect, test, type Page } from "@playwright/test";

// /podbor without an API or a paid provider: the picker and the VIN decoder get these answers.
const toyota = { country: "Япония", id: 2, name: "Toyota", nameRu: "Тойота", slug: "toyota" };
const lada = { country: "Россия", id: 1, name: "Lada", nameRu: "Лада", slug: "lada" };
const models = ["Allion", "Alphard", "Camry", "Corolla"].map((name, index) => (
  { body: null, family: name, fapi: false, generation: null, id: 30 + index, name, yearFrom: null, yearTo: null }
));

async function stubPartsFinder(page: Page) {
  const json = (body: unknown) => ({ body: JSON.stringify(body), contentType: "application/json", status: 200 });
  await page.route("**/api/v1/parts-finder/status", (route) => route.fulfill(json({ catalog: "local", enabled: true })));
  await page.route("**/api/v1/parts-finder/makes", (route) => route.fulfill(json({
    groups: [{ letter: "L", makes: [lada] }, { letter: "T", makes: [toyota] }],
    popular: [toyota, lada],
  })));
  await page.route("**/api/v1/parts-finder/models?*", (route) => route.fulfill(json({ make: toyota, models, popular: [], source: "seed" })));
  await page.route("**/api/v1/parts-finder/modifications?*", (route) => route.fulfill(json({
    available: true,
    modifications: [{ body: "Седан", capacity: "1.8", engine: "1ZZ-FE", fuel: "Бензин", id: 900, label: "1.8 1ZZ-FE", powerPs: 132, yearFrom: 2001, yearTo: 2007 }],
  })));
  await page.route("**/api/v1/parts-finder/vehicle", (route) => route.fulfill(json({
    check_digit: "match",
    source: "nhtsa_vpic_online",
    status: "decoded",
    vehicle: { displacement_l: "2.998832712", engine_hp: "240", engine_model: "J30A4", make: "HONDA", model: "Accord", model_year: 2003 },
    vin: "1HGCM82633A004352",
    warnings: [],
  })));
}

async function openPicker(page: Page) {
  await stubPartsFinder(page);
  await page.goto("/podbor");
  await page.getByRole("button", { name: "Выбрать марку и модель" }).click();
  await expect(page.getByRole("heading", { name: "Выберите марку" })).toBeVisible();
}

const steps = (page: Page) => page.getByRole("navigation", { name: "Шаги выбора автомобиля" });

test("a double click on a make stops at its models", async ({ page }) => {
  await openPicker(page);
  const make = page.getByRole("button", { exact: true, name: "Toyota" }).first();
  const box = (await make.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 6 });
  // Two presses of one double click at one point: the first puts the list of models under the pointer.
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await expect(page.getByRole("heading", { name: "Toyota: выберите модель" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Allion/u })).toBeVisible();
  const boxes = await Promise.all((await page.getByRole("button", { name: /годы уточним/u }).all()).map((model) => model.boundingBox()));
  const under = boxes.some((model) => model && x > model.x && x < model.x + model.width && y > model.y && y < model.y + model.height);
  expect(under, "the second click must have a model under it, or the test checks nothing").toBe(true);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });

  await expect(page.getByRole("heading", { name: "Toyota: выберите модель" })).toBeVisible();
  await expect(steps(page).locator('[aria-current="step"]')).toHaveText("Модель");
  await expect(page.getByRole("heading", { name: /двигатель/u })).toHaveCount(0);

  // A click of its own still chooses, and so does the keyboard.
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^Allion/u }).click();
  await expect(page.getByRole("heading", { name: "Toyota Allion: двигатель" })).toBeVisible();
  await steps(page).getByRole("button", { name: "Allion" }).click();
  await page.getByRole("button", { name: /^Camry/u }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Toyota Camry: двигатель" })).toBeVisible();
});

test("the make in the picker's breadcrumbs goes back to the list of makes", async ({ page }) => {
  await openPicker(page);
  await page.getByRole("button", { exact: true, name: "Toyota" }).first().click();
  await page.getByRole("button", { name: /^Allion/u }).click();
  await expect(page.getByRole("heading", { name: "Toyota Allion: двигатель" })).toBeVisible();

  await steps(page).getByRole("button", { exact: true, name: "Toyota" }).click();

  await expect(page.getByRole("heading", { name: "Выберите марку" })).toBeVisible();
  await expect(steps(page).locator('[aria-current="step"]')).toHaveText("Марка");
  await expect(steps(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Lada" }).first()).toBeVisible();
  // The car can be changed from here.
  await page.getByRole("button", { exact: true, name: "Toyota" }).first().click();
  await expect(page.getByRole("heading", { name: "Toyota: выберите модель" })).toBeVisible();
});

test("the VIN result shows engine volume in litres with one decimal", async ({ page }) => {
  await stubPartsFinder(page);
  await page.goto("/podbor");
  await page.getByRole("tab", { name: "VIN или номер кузова" }).click();
  await page.getByRole("textbox", { name: "VIN или номер кузова" }).fill("1HGCM82633A004352");
  await page.getByRole("button", { name: "Расшифровать" }).click();

  const volume = page.locator("dl > div", { hasText: "Объём двигателя" });
  await expect(volume.locator("dd")).toHaveText("3,0 л");
  await expect(page.getByText("2.998832712")).toHaveCount(0);
});
