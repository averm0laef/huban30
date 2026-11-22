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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Автозапчасти и расходники");
  await expect(page.getByRole("heading", { level: 2, name: "Подбор по VIN" })).toBeVisible();
  await expect(page.getByRole("link", { name: "АН-30 Автозапчасти, на главную" })).toBeVisible();
  // The footer names the section too, so the tile is looked for in its own block.
  await expect(page.getByRole("region", { name: "Каталоги" }).getByRole("link", { name: "Моторные масла", exact: true })).toBeVisible();

  const health = await page.request.get("/api/health/live");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({ service: "web", status: "ok" });
});

test("catalog VIN search opens expert help with the VIN prefilled", async ({ page }) => {
  await page.goto("/catalog");
  const search = page.getByRole("combobox", { name: "Поиск по VIN, названию или артикулу" });
  await search.fill("ZZZZZZZZZZZZZZZZZ");
  await search.press("Enter");

  await expect(page).toHaveURL(/\/expert-help$/u);
  await expect(page.getByRole("heading", { name: "Подберём запчасть для вашего автомобиля" })).toBeVisible();
  await expect(page.locator('textarea[name="message"]')).toHaveValue("VIN: ZZZZZZZZZZZZZZZZZ\nНужная деталь: ");
});

test("catalog opens with categories and a single storefront search", async ({ page }) => {
  await page.goto("/catalog");

  await expect(page.getByRole("heading", { name: "Каталог товаров" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Разделы каталога" }).getByRole("link", { name: "Фильтры" })).toBeVisible();
  await expect(page.getByRole("search")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Сортировка" })).toBeVisible();
  const view = page.getByRole("group", { name: "Вид каталога" });
  await expect(view.getByRole("link", { name: "Плиткой" })).toHaveAttribute("aria-current", "page");
  await view.getByRole("link", { name: "Списком" }).click();
  await expect(page).toHaveURL(/view=list/u);
  await expect(view.getByRole("link", { name: "Списком" })).toHaveAttribute("aria-current", "page");
});

test("catalog filters stay open on desktop and open a dialog on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/catalog?q=FILTER-DISCLOSURE-QA");

  const rail = page.getByRole("complementary", { name: "Фильтры каталога" });
  const availability = rail.getByRole("radio", { name: "В наличии" });
  const priceFrom = rail.getByRole("spinbutton", { name: "От" });
  const apply = rail.getByRole("button", { name: "Применить" });

  await expect(availability).toBeVisible();
  await expect(priceFrom).toBeVisible();
  await expect(apply).toBeVisible();
  const stockSection = rail.locator("summary").filter({ hasText: /^Наличие$/u });
  await stockSection.click();
  await expect(availability).toBeHidden();
  await stockSection.click();
  await expect(availability).toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });
  const openFilters = page.getByRole("button", { name: "Фильтры", exact: true });
  const dialog = page.getByRole("dialog", { name: "Фильтры" });
  await expect(dialog).toBeHidden();
  await openFilters.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "В наличии" })).toBeVisible();
  const mobilePriceFrom = dialog.getByRole("spinbutton", { name: "От" });
  await expect(dialog.getByRole("button", { name: "Применить" })).toBeVisible();
  await mobilePriceFrom.fill("100");
  await page.keyboard.press("Escape");
  await expect(openFilters).toBeFocused();
  await openFilters.click();
  await expect(mobilePriceFrom).toHaveValue("");
});

test("catalog help keeps the searched article in the specialist request", async ({ page }) => {
  const article = "HELP-PREFILL-QA-2026";
  await page.route("**/api/v1/suppliers/search?*", (route) => route.fulfill({
    body: JSON.stringify({
      message: "Поиск у поставщика отключён",
      parts: [],
      query: article,
      success: false,
      totalFound: 0,
      truncated: false,
    }),
    contentType: "application/json",
    status: 200,
  }));

  await page.goto(`/catalog?q=${article}`);
  await page.getByRole("link", { name: "Уточнить у специалиста" }).click();

  await expect(page).toHaveURL(/\/expert-help$/u);
  await expect(page.locator('textarea[name="message"]')).toHaveValue(`Ищу деталь: ${article}\nАвтомобиль: `);
});

test("mobile mini-chat starts with a short request form then becomes a clean conversation", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.addInitScript(() => localStorage.removeItem("an30_guest_chats_v1"));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    body: JSON.stringify({ error: "unauthorized" }),
    contentType: "application/json",
    status: 401,
  }));
  let receivedIntake: unknown;
  await page.route("**/api/v1/chat/guest/threads", async (route) => {
    receivedIntake = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        assignedStaffId: null,
        createdAt: "2026-09-23T10:00:00.000Z",
        guestToken: CHAT_GUEST_TOKEN,
        id: CHAT_THREAD_ID,
        lastMessageAt: null,
        orderId: null,
        status: "open",
        subject: "Помочь подобрать деталь",
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/v1/chat/guest/threads/*/read/*", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/chat/guest/threads/*/messages?*", (route) => route.fulfill({
    body: JSON.stringify({
      items: [],
      nextSequence: "0",
      olderCursor: null,
      thread: { assignedStaffId: null, assignedStaffName: null, status: "open" },
    }),
    contentType: "application/json",
    status: 200,
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "Открыть чат с магазином" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "Подбор запчасти" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Поможем найти нужную запчасть" })).toBeVisible();
  await expect(dialog.getByLabel("Тема обращения")).toBeVisible();
  await expect(dialog.getByLabel(/Автомобиль и нужная деталь/u)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Начать обращение" })).toBeVisible();
  await dialog.getByLabel(/Автомобиль и нужная деталь/u).fill("Toyota Corolla 2012, передние колодки");
  await dialog.getByRole("button", { name: "Начать обращение" }).click();

  await expect.poll(() => receivedIntake).toEqual({
    intake: {
      articleNumber: null,
      comment: "Toyota Corolla 2012, передние колодки",
      intent: "advice",
      vehicle: null,
    },
    orderId: null,
    subject: "Помочь подобрать деталь",
  });
  await expect(dialog.getByRole("heading", { name: "Чат с магазином" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Поможем найти нужную запчасть" })).toHaveCount(0);
  await expect(dialog.getByLabel("Тема обращения")).toHaveCount(0);
  await expect(dialog.getByRole("log")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Прикрепить фото или видео" })).toBeVisible();
  await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), "an30_guest_chats_v1"))
    .toContain(CHAT_GUEST_TOKEN);
});

test("mobile mini-chat opens full-screen with useful guidance and media upload", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await installChatRoutes(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Открыть чат с магазином" }).click();
  const dialog = page.getByRole("dialog", { name: "Чат с магазином" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("header").getByText("Подбор детали по VIN")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Поможем найти нужную запчасть" })).toHaveCount(0);
  await expect(dialog.getByLabel("Тема обращения")).toHaveCount(0);
  await expect(dialog.locator("textarea").last()).toBeFocused();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBe(0);
  expect(box!.y).toBe(0);
  expect(box!.width).toBe(390);
  expect(box!.height).toBe(844);

  await page.setViewportSize({ height: 640, width: 360 });
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(360);
  await expect.poll(async () => (await dialog.boundingBox())?.height).toBe(640);
  await dialog.getByRole("button", { name: "Закрыть чат" }).click();
  await expect(page.getByRole("button", { name: "Открыть чат с магазином" })).toBeFocused();
  await page.getByRole("button", { name: "Открыть чат с магазином" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("textarea").last()).toBeFocused();
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

  // A refreshed list contains new objects for the same conversation. It
  // must preserve the loaded older window and avoid another bootstrap GET.
  await log.evaluate((element) => {
    const view = element.ownerDocument.defaultView;
    if (!view) throw new Error("Conversation has no browser window");
    const key = "an30_guest_chats_v1";
    const threads = JSON.parse(view.localStorage.getItem(key) ?? "[]") as Array<{ subject: string }>;
    threads[0]!.subject = "Обновлённая тема обращения";
    const newValue = JSON.stringify(threads);
    view.localStorage.setItem(key, newValue);
    view.dispatchEvent(new view.StorageEvent("storage", { key, newValue }));
  });
  await expect(conversation.getByRole("heading", { name: "Обновлённая тема обращения" })).toBeVisible();
  await expect(log.locator("[data-chat-message-id]")).toHaveCount(100);
  expect(network.historyRequests).toEqual(["?before=latest&limit=50", "?before=151&limit=50"]);
});

test("registration confirmation survives navigation and clears the token from the address", async ({ page }) => {
  const token = "registration-preview-token-1234567890abcdef";
  const password = "Local only test password 2026";
  let verificationBody: unknown;
  await page.route("**/api/v1/auth/register", route => route.fulfill({
    status: 201,
    json: { developmentToken: token, message: "Письмо отправлено" },
  }));
  await page.route("**/api/v1/auth/email/verify", route => {
    verificationBody = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { message: "Email подтверждён" } });
  });
  await page.goto("/auth?mode=register");
  await page.getByLabel("Имя", { exact: true }).fill("Проверка");
  await page.getByLabel("Email", { exact: true }).fill("test@example.invalid");
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="personalDataConsent"]').check();
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.getByRole("link", { name: "открыть тестовую ссылку", exact: true }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
  await expect(page.getByText("Email подтверждён", { exact: true })).toBeVisible();
  expect(verificationBody).toEqual({ token, password });
  expect(new URL(page.url()).hash).toBe("");
});

test("home VIN form checks the input and prefills the specialist request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const vin = page.getByRole("textbox", { name: "VIN автомобиля" });
  const submit = page.getByRole("button", { name: "Передать VIN специалисту" });
  await vin.fill("123");
  await submit.click();
  await expect(vin).toHaveAttribute("aria-invalid", "true");
  await expect(vin).toBeFocused();
  await vin.fill("ZZZZZZZZZZZZZZZZZ");
  await submit.click();
  await expect(page).toHaveURL(/\/expert-help$/u);
  await expect(page.locator('textarea[name="message"]')).toHaveValue("VIN: ZZZZZZZZZZZZZZZZZ\nНужная деталь: ");
});

test("mobile menu fits a narrow viewport and restores focus when dismissed", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 620 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Открыть меню" });
  const menu = page.getByRole("dialog", { name: "Меню магазина" });
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: /Вход или регистрация/u })).toBeVisible();
  // The drawer slides in from 24 px to the left: measure where it comes to rest, not where it is on the way.
  await menu.evaluate(element => Promise.all(element.getAnimations().map((animation: { finished: Promise<unknown> }) => animation.finished)));
  const layout = await menu.evaluate(element => {
    const box = element.getBoundingClientRect();
    const brand = element.querySelector("a[href='/']")!.getBoundingClientRect();
    const close = element.querySelector("button")!.getBoundingClientRect();
    const viewport = element.ownerDocument.defaultView!;
    return {
      inViewport: box.left >= 0 && box.right <= viewport.innerWidth && box.top >= 0 && box.bottom <= viewport.innerHeight,
      distinctHeaderTargets: brand.right <= close.left,
      canScroll: element.scrollHeight > element.clientHeight,
      horizontalOverflow: element.scrollWidth > element.clientWidth,
    };
  });
  expect(layout).toEqual({ inViewport: true, distinctHeaderTargets: true, canScroll: true, horizontalOverflow: false });
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("link", { name: "Моторные масла", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog\?q=/u);
  await expect(menu).not.toBeVisible();
});

test("without a catalogue behind it «Каталог» is a plain link and named sections open searches", async ({ page }) => {
  // This suite runs the storefront with no API: the category tree is empty, and a page /catalog/<section> exists
  // only for a section the catalogue holds.
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");

  await expect(page.getByRole("banner").getByRole("link", { name: "Каталог", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Меню каталога" })).toHaveCount(0);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Фильтры", exact: true })).toHaveAttribute("href", /^\/catalog\?q=/u);
});

test("store search surfaces help pages and keeps recent queries local", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "Поиск по VIN, названию или артикулу" });
  await input.fill("возврат товара");
  const matched = page.getByRole("link", { name: "Возврат товара", exact: true }).filter({ visible: true });
  await expect(page.getByText("Информация магазина", { exact: true })).toBeVisible();
  await expect(matched.first()).toBeVisible();
  await input.press("Enter");
  await expect(page).toHaveURL(/\/catalog\?q=/u);
  await expect(input).toHaveValue("возврат товара");
  await expect(page.getByRole("navigation", { name: "Информация магазина" }).getByRole("link", { name: "Возврат товара" })).toBeVisible();
  await input.fill("");
  await expect(page.getByRole("dialog", { name: "Недавние запросы" }).getByRole("link", { name: "возврат товара" })).toBeVisible();
  await page.getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Недавние запросы" })).not.toBeVisible();
});
