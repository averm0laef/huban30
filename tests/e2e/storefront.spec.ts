import { expect, test } from "@playwright/test";

test("autonomous storefront boots and reports liveness", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/АН-30/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Нужная запчасть без лишней переписки");
  await expect(page.getByRole("link", { name: "АН-30, на главную" })).toBeVisible();

  const health = await page.request.get("/api/health/live");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({ service: "web", status: "ok" });
});
