import { expect, test, type Page } from "@playwright/test";

const USER = "019bf9ea-0d3e-7def-9c9a-000000009500";
const CONNECTION = "019bf9ea-0d3e-7def-9c9a-000000009501";
const CONVERSATION = "019bf9ea-0d3e-7def-9c9a-000000009502";
const POST = "019bf9ea-0d3e-7def-9c9a-000000009503";
const JOB = "019bf9ea-0d3e-7def-9c9a-000000009504";
const NOW = "2026-11-18T10:00:00.000Z";
const connection = { id: CONNECTION, platform: "telegram", name: "АН30 · тестовый Telegram", environment: "development", isTest: true, publishEnabled: true, inboxEnabled: true, publishTarget: "test-channel", inboxTarget: "", publicUrl: "", version: 1, hasToken: false, hasPublishingToken: false, hasWebhookSecret: false, hasAppSecret: false, webhookUrl: "https://example.invalid/api/v1/client-hub/webhooks/test", lastCheckedAt: null, diagnostic: null };

async function mockSession(page: Page) {
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { email: "preview@example.invalid", role: "admin", userId: USER, mfaVerified: true, mfaSetupRequired: false } }));
  await page.route("**/api/v1/client-hub/connections", route => route.fulfill({ json: { items: [connection] } }));
}

test("hub editor restores focus after closing and queues a stable post from mobile", async ({ page }) => {
  await mockSession(page);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/v1/client-hub/posts**", async route => {
    if (route.request().method() === "POST") { requests.push(route.request().postDataJSON() as Record<string, unknown>); await route.fulfill({ json: { id: requests[0]?.id, revision: 1, destinations: 1 } }); }
    else await route.fulfill({ json: { items: [], hasMore: false } });
  });
  await page.goto("/admin/client-hub");
  await page.getByRole("button", { name: "Написать пост", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByRole("button", { name: "Написать пост", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Входящие", exact: true }).click();
  await page.getByRole("button", { name: "Публикации", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Написать пост", exact: true }).click();
  await page.getByRole("textbox", { name: "Заголовок", exact: true }).fill("Поступление в АН30");
  await page.getByRole("textbox", { name: "Текст поста", exact: false }).fill("Запчасти проверим по артикулу и VIN.");
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Сохранить и отправить", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ title: "Поступление в АН30", body: "Запчасти проверим по артикулу и VIN.", imageUrl: null });
  expect(requests[0]?.id).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[0]).not.toHaveProperty("connectionIds");
});

test("hub keeps an uncertain older post actionable when a newer version is queued", async ({ page }) => {
  await mockSession(page);
  const resolves: Record<string, unknown>[] = [];
  await page.route("**/api/v1/client-hub/posts**", route => route.fulfill({ json: { items: [{ id: POST, title: "Новая версия поста", body: "Поступление деталей", kind: "arrival", imageUrl: null, revision: 2, updatedAt: NOW, jobs: [
    { id: `${JOB.slice(0, -1)}6`, connectionId: CONNECTION, platform: "telegram", connectionName: connection.name, state: "queued", revision: 2, appliedRevision: 0, externalId: null, attemptCount: 0, lastError: null, createdAt: NOW },
    { id: JOB, connectionId: CONNECTION, platform: "telegram", connectionName: connection.name, state: "unknown", revision: 1, appliedRevision: 0, externalId: null, attemptCount: 1, lastError: "provider_result_unknown", createdAt: NOW },
  ] }], hasMore: false } }));
  await page.route(`**/api/v1/client-hub/jobs/${JOB}/resolve`, async route => { resolves.push(route.request().postDataJSON() as Record<string, unknown>); await route.fulfill({ json: { ok: true } }); });
  await page.goto("/admin/client-hub");
  await expect(page.getByText("Ожидает проверки предыдущей отправки на этой площадке.")).toBeVisible();
  await page.getByRole("button", { name: "Проверить результат", exact: true }).click();
  const save = page.getByRole("button", { name: "Сохранить ID поста", exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole("textbox", { name: "ID поста на площадке", exact: true }).fill("12345");
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: "Проверил площадку: это ID нужного поста", exact: true }).check();
  await save.click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(resolves).toEqual([{ action: "bind", confirmed: true, externalId: "12345" }]);
});

test("hub reply retry preserves its key and reconciles an old unknown reply outside history", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/v1/client-hub/posts**", route => route.fulfill({ json: { items: [], hasMore: false } }));
  const conversation = { id: CONVERSATION, connectionId: CONNECTION, platform: "telegram", connectionName: connection.name, customerName: "Клиент проверки", peerId: "test-peer", state: "assigned", assignedTo: USER, assignedName: "Менеджер", version: 2, lastMessageAt: NOW, lastMessagePreview: "Нужна деталь", unreadCount: 1 };
  await page.route("**/api/v1/client-hub/conversations?**", route => route.fulfill({ json: { items: [conversation], hasMore: false } }));
  await page.route(`**/api/v1/client-hub/conversations/${CONVERSATION}/messages?**`, route => route.fulfill({ json: { conversation, items: [], hasMore: false, blockers: [{ id: `${JOB.slice(0, -1)}7`, jobId: JOB, direction: "outgoing", senderKind: "operator", body: "Предыдущий ответ вне страницы", media: [], createdAt: NOW, state: "unknown" }] } }));
  const replies: Array<{ clientKey: string; body: string }> = [];
  await page.route(`**/api/v1/client-hub/conversations/${CONVERSATION}/replies`, async route => { replies.push(route.request().postDataJSON() as { clientKey: string; body: string }); await route.fulfill(replies.length === 1 ? { status: 503, json: { message: "Соединение прервалось" } } : { json: { id: JOB } }); });
  const resolutions: unknown[] = [];
  await page.route(`**/api/v1/client-hub/jobs/${JOB}/resolve`, async route => { resolutions.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } }); });
  await page.goto("/admin/client-hub");
  await page.getByRole("button", { name: "Входящие", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "Клиент проверки" }).click();
  await expect(page.getByText("Предыдущий ответ вне страницы", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Проверить отправку", exact: true }).click();
  await page.getByRole("checkbox", { name: "Проверил площадку: клиент получил этот ответ", exact: true }).check();
  await page.getByRole("button", { name: "Отметить отправленным", exact: true }).click();
  expect(resolutions).toEqual([{ action: "mark_sent", confirmed: true }]);
  const composer = page.getByRole("textbox", { name: "Ответ в Telegram", exact: false });
  await composer.fill("Уточню совместимость и отвечу здесь.");
  await page.getByRole("button", { name: "Отправить ответ", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Соединение прервалось" })).toBeVisible();
  await page.getByRole("button", { name: "Отправить ответ", exact: true }).click();
  await expect(composer).toHaveValue("");
  expect(replies).toHaveLength(2);
  expect(replies[0]).toEqual(replies[1]);
});

test("staff opts into automatic assignment and an off switch cancels later heartbeats", async ({ page }) => {
  await page.clock.install();
  await mockSession(page);
  await page.route("**/api/v1/client-hub/posts**", route => route.fulfill({ json: { items: [], hasMore: false } }));
  const availability: boolean[] = [];
  await page.route("**/api/v1/staff/availability", async route => {
    const body = route.request().postDataJSON() as { available: boolean };
    availability.push(body.available);
    await route.fulfill({ json: body });
  });
  await page.goto("/admin/client-hub");
  const receiving = page.getByRole("switch", { name: "Принимать обращения", exact: true });
  await expect(receiving).not.toBeChecked();
  expect(availability).toEqual([]);
  await receiving.check();
  await expect(page.getByRole("status").filter({ hasText: "Готов к диалогам" })).toBeVisible();
  expect(availability).toEqual([true]);
  await page.clock.runFor(16_000);
  await expect.poll(() => availability.length).toBeGreaterThanOrEqual(2);
  await receiving.uncheck();
  await expect.poll(() => availability.at(-1)).toBe(false);
  const enabledSends = availability.filter(Boolean).length;
  await page.clock.runFor(20_000);
  expect(availability.filter(Boolean)).toHaveLength(enabledSends);
  await expect(page.getByText("На паузе", { exact: true })).toBeVisible();
});

test("connection setup keeps public defaults and secrets scoped to each platform", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/v1/client-hub/posts**", route => route.fulfill({ json: { items: [], hasMore: false } }));
  await page.goto("/admin/client-hub");
  await page.getByRole("button", { name: "Площадки", exact: true }).click();
  await page.getByRole("button", { name: "Подключить площадку", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const fillPublic = dialog.getByRole("button", { name: "Подставить публичные данные АН30" });
  await fillPublic.click();
  await expect(dialog.getByLabel(/Канал публикаций/u)).toHaveValue("@an30_autoparts");
  await expect(dialog.getByLabel("Публичная ссылка на площадку")).toHaveValue("https://t.me/an30_autoparts");
  await dialog.getByLabel("Токен бота / сообщества").fill("synthetic-telegram-only");
  await dialog.getByLabel("Площадка", { exact: true }).selectOption("vk");
  await fillPublic.click();
  await expect(dialog.getByLabel(/Название подключения/u)).toHaveValue("АН30 · ВКонтакте");
  await expect(dialog.getByLabel(/ID стены сообщества/u)).toHaveValue("");
  await expect(dialog.getByLabel("Токен бота / сообщества")).toHaveValue("");
  await expect(dialog.getByLabel("Публичная ссылка на площадку")).toHaveValue("https://vk.com/an30_autoparts");
  await dialog.getByRole("button", { name: "Сгенерировать секрет", exact: true }).click();
  await expect(dialog.getByLabel(/Секрет входящих событий/u)).toHaveValue(/^[a-f0-9]{48}$/u);
});
