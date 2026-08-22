import { expect, test, type Page, type Route } from "@playwright/test";

const CHAT_THREAD_ID = "019bf9ea-0d3e-7def-9c9a-000000009000";
const CHAT_GUEST_TOKEN = "g".repeat(48);

function fixtureId(value: number): string {
  return `019bf9ea-0d3e-7def-9c9a-${String(value).padStart(12, "0")}`;
}

function chatHistoryPage(before: string | null) {
  const end = before === "latest" ? 200 : Math.max(0, Number(before) - 1);
  const start = Math.max(1, end - 49);
  const items = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => {
    const sequence = start + index;
    const attachments = [{
      byteSize: 68,
      id: fixtureId(10_000 + sequence),
      mimeType: "image/png",
      originalName: `photo-${sequence}.png`,
    }];
    if (sequence >= 199) attachments.push({
      byteSize: 12,
      id: fixtureId(20_000 + sequence),
      mimeType: "video/mp4",
      originalName: `video-${sequence}.mp4`,
    });
    return {
      attachments,
      body: null,
      clientMessageId: null,
      createdAt: `2026-08-15T10:${String(sequence % 60).padStart(2, "0")}:00.000Z`,
      id: fixtureId(sequence),
      messageType: "attachment",
      replyToId: null,
      senderKind: "staff",
      senderUserId: null,
      sequence: String(sequence),
    };
  });
  return {
    items,
    nextSequence: String(end),
    olderCursor: start > 1 ? String(start) : null,
    thread: { assignedStaffId: null, assignedStaffName: null, status: "open" },
  };
}

async function installChatRoutes(page: Page) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const video = Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const historyRequests: string[] = [];
  const imageRequests: string[] = [];
  const videoRequests: string[] = [];
  let activeImages = 0;
  let maximumActiveImages = 0;

  await page.addInitScript(({ key, thread }) => {
    (globalThis as unknown as { localStorage: { setItem: (name: string, value: string) => void } })
      .localStorage.setItem(key, JSON.stringify([thread]));
  }, {
    key: "an30_guest_chats_v1",
    thread: {
      assignedStaffId: null,
      createdAt: "2026-08-15T10:00:00.000Z",
      guestToken: CHAT_GUEST_TOKEN,
      id: CHAT_THREAD_ID,
      lastMessageAt: "2026-08-15T10:59:00.000Z",
      orderId: null,
      status: "open",
      subject: "Подбор детали по VIN",
    },
  });
  await page.route("**/api/v1/auth/session", (route: Route) => route.fulfill({
    body: JSON.stringify({ error: "unauthorized" }),
    contentType: "application/json",
    status: 401,
  }));
  await page.route("**/api/v1/chat/guest/threads/*/read/*", (route: Route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/chat/guest/threads/*/messages?*", (route: Route) => {
    const url = new URL(route.request().url());
    const before = url.searchParams.get("before");
    historyRequests.push(url.search);
    return route.fulfill({
      body: JSON.stringify(chatHistoryPage(before)),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/v1/chat/guest/attachments/*", async (route: Route) => {
    const id = route.request().url().split("/").at(-1)!;
    if (Number(id.slice(-12)) >= 20_000) {
      videoRequests.push(id);
      if (videoRequests.length === 1) {
        await route.fulfill({
          body: JSON.stringify({ message: "temporary media failure" }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      await route.fulfill({ body: video, contentType: "video/mp4", status: 200 });
      return;
    }
    imageRequests.push(id);
    activeImages += 1;
    maximumActiveImages = Math.max(maximumActiveImages, activeImages);
    await new Promise((resolve) => setTimeout(resolve, 75));
    activeImages -= 1;
    await route.fulfill({ body: png, contentType: "image/png", status: 200 });
  });
  return {
    historyRequests,
    imageRequests,
    maximumActiveImages: () => maximumActiveImages,
    videoRequests,
  };
}

test("autonomous storefront boots and reports liveness", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/АН-30/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Автозапчасти в Чернышевске — АН-30");
  await expect(page.getByRole("heading", { level: 2, name: "Нужная запчасть без лишней переписки" })).toBeVisible();
  await expect(page.getByRole("link", { name: "АН-30 Автозапчасти, на главную" })).toBeVisible();

  const health = await page.request.get("/api/health/live");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({ service: "web", status: "ok" });
});

test("mobile mini-chat opens full-screen with useful guidance and media upload", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: "unauthorized" }),
      contentType: "application/json",
      status: 401,
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Открыть чат с магазином" }).click();
  const dialog = page.getByRole("dialog", { name: "Чат с магазином" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveText(/Поможем подобрать нужную деталь/u);
  await expect(dialog).toHaveText(/VIN или марку, модель и год/u);

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBe(0);
  expect(box!.y).toBe(0);
  expect(box!.width).toBe(390);
  expect(box!.height).toBe(844);
  await expect(dialog.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm",
  );
});

test("mobile mini-chat bounds media GETs and pages older history without a scroll jump", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const network = await installChatRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть чат с магазином" }).click();
  const dialog = page.getByRole("dialog", { name: "Чат с магазином" });
  const log = dialog.getByRole("log");
  await expect(log.locator("[data-chat-message-id]")).toHaveCount(50);
  expect(network.historyRequests).toEqual(["?before=latest&limit=50"]);

  await expect.poll(() => network.imageRequests.length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(network.imageRequests.length).toBeLessThan(12);
  expect(network.maximumActiveImages()).toBeLessThanOrEqual(3);
  expect(network.videoRequests).toHaveLength(0);

  const settledImageRequests = network.imageRequests.length;
  await page.evaluate("window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); ");
  await page.waitForTimeout(250);
  expect(network.imageRequests).toHaveLength(settledImageRequests);

  const videoButton = dialog.getByRole("button", { name: /Загрузить видео/u }).last();
  await expect(videoButton).toContainText(/Данные не загружаются без нажатия/u);
  await videoButton.click();
  await expect.poll(() => network.videoRequests.length).toBe(1);
  await expect(dialog.getByRole("alert").filter({ hasText: "Не удалось загрузить видео" })).toBeVisible();
  await dialog.getByRole("button", { name: "Повторить" }).click();
  await expect.poll(() => network.videoRequests.length).toBe(2);

  for (const [before, newFirst] of [["151", "101"], ["101", "51"], ["51", "1"]]) {
    await log.evaluate((element) => { element.scrollTop = 0; });
    const firstVisible = log.locator("[data-chat-message-id]").first();
    const anchorId = await firstVisible.getAttribute("data-chat-message-id");
    const anchorTop = (await firstVisible.boundingBox())!.y;
    await dialog.getByRole("button", { name: /Показать предыдущие/u }).click();
    await expect.poll(() => network.historyRequests.at(-1)).toBe(`?before=${before}&limit=50`);
    await expect(log.locator("[data-chat-message-id]").first()).toHaveAttribute(
      "data-chat-message-id",
      fixtureId(Number(newFirst)),
    );
    const anchored = log.locator(`[data-chat-message-id="${anchorId}"]`);
    await expect(anchored).toBeAttached();
    await expect.poll(async () => Math.abs((await anchored.boundingBox())!.y - anchorTop)).toBeLessThan(3);
  }
  await expect(log.locator("[data-chat-message-id]")).toHaveCount(150);
  await expect(dialog.getByRole("button", { name: /К последним/u })).toBeVisible();
});

test("full chat uses the same newest-window and accessible older-history controls", async ({ page }) => {
  const network = await installChatRoutes(page);
  await page.goto("/chat");
  const conversation = page.getByRole("region", { name: "Переписка" });
  const log = conversation.getByRole("log");
  await expect(log.locator("[data-chat-message-id]")).toHaveCount(50);
  await expect(conversation.getByRole("button", { name: "Показать предыдущие сообщения" })).toBeVisible();
  expect(network.historyRequests).toEqual(["?before=latest&limit=50"]);
  expect(network.videoRequests).toHaveLength(0);

  await log.evaluate((element) => { element.scrollTop = 0; });
  await conversation.getByRole("button", { name: "Показать предыдущие сообщения" }).click();
  await expect.poll(() => network.historyRequests.at(-1)).toBe("?before=151&limit=50");
  await expect(log.locator("[data-chat-message-id]")).toHaveCount(100);
});
