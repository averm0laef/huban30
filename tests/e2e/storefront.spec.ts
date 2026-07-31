import { expect, test } from "@playwright/test";

test("legacy storefront boots with the АН-30 document title", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/АН-30/);
  await expect(page.getByRole("img", { name: "АН-30 Автозапчасти" }).first()).toBeVisible();
});
