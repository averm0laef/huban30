import { describe, expect, it, vi } from "vitest";

import type { CatalogProductSummary } from "@an30/contracts";

import type { AiProvider } from "../adapters/provider-contracts.js";
import type { CatalogSearchService } from "../catalog/catalog-search.service.js";
import {
  ChatAssistantService,
  composeAssistantBody,
  renderCatalogBlock,
  stripContactDetails,
} from "./chat-assistant.service.js";
import type { ChatService } from "./chat.service.js";
import type { ChatMessageView } from "./chat.types.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

function catalogItem(overrides: Partial<CatalogProductSummary> = {}): CatalogProductSummary {
  return {
    availableQuantity: 7,
    brand: { id: "brand-1", name: "NGK", slug: "ngk" },
    category: { id: "cat-1", name: "Фильтры", slug: "filters" },
    createdAt: "2026-08-01T00:00:00.000Z",
    id: "product-1",
    matchedVia: "query",
    name: "Фильтр масляный",
    priceKopeks: 125_000,
    primaryImage: null,
    sku: "FILTER-1",
    slug: "oil-filter-1",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function stubMessageView(): ChatMessageView {
  return {
    attachments: [],
    body: "stub",
    clientMessageId: "33333333-3333-4333-8333-333333333333",
    createdAt: new Date().toISOString(),
    id: MESSAGE_ID,
    messageType: "text",
    replyToId: null,
    senderKind: "system",
    senderUserId: null,
    sequence: "1",
  };
}

function makeService(overrides: {
  aiEnabled?: boolean;
  answerCustomerQuestion?: ReturnType<typeof vi.fn>;
  insertAssistantReply?: ReturnType<typeof vi.fn>;
  search?: ReturnType<typeof vi.fn>;
  threadAssignment?: ReturnType<typeof vi.fn>;
} = {}) {
  const ai = {
    answerCustomerQuestion: overrides.answerCustomerQuestion ?? vi.fn(async () => ({ message: "ok", needsHuman: false })),
    enabled: overrides.aiEnabled ?? true,
    expandSearchQuery: vi.fn(async () => []),
  } as unknown as AiProvider;
  const catalogSearch = {
    search: overrides.search ?? vi.fn(async () => ({ items: [catalogItem()] })),
  } as unknown as CatalogSearchService;
  const chat = {
    insertAssistantReply: overrides.insertAssistantReply ?? vi.fn(async () => stubMessageView()),
    threadAssignment: overrides.threadAssignment
      ?? vi.fn(async () => ({ assignedStaffId: null, status: "waiting_staff" as const })),
  } as unknown as ChatService;

  const service = new ChatAssistantService(ai, catalogSearch, chat);
  return { ai, catalogSearch, chat, service };
}

describe("ChatAssistantService.respond", () => {
  it("does nothing when AI is disabled — chat still works fully without it (ADR-004)", async () => {
    const { catalogSearch, chat, service } = makeService({ aiEnabled: false });
    const result = await service.respond({
      identity: "user-1", question: "Есть фильтр?", replyToId: MESSAGE_ID, threadId: THREAD_ID,
    });
    expect(result).toBeNull();
    expect(catalogSearch.search).not.toHaveBeenCalled();
    expect(chat.insertAssistantReply).not.toHaveBeenCalled();
  });

  it("does nothing on a closed thread", async () => {
    const { chat, service } = makeService({
      threadAssignment: vi.fn(async () => ({ assignedStaffId: null, status: "closed" as const })),
    });
    const result = await service.respond({
      identity: "user-1", question: "Есть фильтр?", replyToId: MESSAGE_ID, threadId: THREAD_ID,
    });
    expect(result).toBeNull();
    expect(chat.insertAssistantReply).not.toHaveBeenCalled();
  });

  it("does nothing once a human staff member is already assigned to the thread", async () => {
    const { chat, service } = makeService({
      threadAssignment: vi.fn(async () => ({ assignedStaffId: "staff-1", status: "waiting_staff" as const })),
    });
    const result = await service.respond({
      identity: "user-1", question: "Есть фильтр?", replyToId: MESSAGE_ID, threadId: THREAD_ID,
    });
    expect(result).toBeNull();
    expect(chat.insertAssistantReply).not.toHaveBeenCalled();
  });

  it("gives the honest 'not found' answer without ever calling the model when the catalog search is empty", async () => {
    const { ai, chat, service } = makeService({ search: vi.fn(async () => ({ items: [] })) });
    await service.respond({
      identity: "user-1", question: "Есть жвачка Orbit?", replyToId: MESSAGE_ID, threadId: THREAD_ID,
    });

    expect(ai.answerCustomerQuestion).not.toHaveBeenCalled();
    expect(chat.insertAssistantReply).toHaveBeenCalledTimes(1);
    const [, body, , needsHuman] = (chat.insertAssistantReply as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(needsHuman).toBe(true);
    expect(body).toContain("Не нашёл");
    expect(body).toContain("+7 (924) 474-26-05");
  });

  it("passes the catalog rows to the model and stores the composed reply with the correct price/stock", async () => {
    const item = catalogItem({ availableQuantity: 3, name: "Тормозные колодки", priceKopeks: 250_000, sku: "PAD-9" });
    const answerCustomerQuestion = vi.fn(async () => ({ message: "Нашли подходящие колодки", needsHuman: false }));
    const { ai, catalogSearch, chat, service } = makeService({
      answerCustomerQuestion,
      search: vi.fn(async () => ({ items: [item] })),
    });

    await service.respond({
      identity: "user-1", question: "Есть тормозные колодки?", replyToId: MESSAGE_ID, threadId: THREAD_ID,
    });

    expect(catalogSearch.search).toHaveBeenCalledWith(expect.objectContaining({ q: "Есть тормозные колодки?" }));
    expect(ai.answerCustomerQuestion).toHaveBeenCalledWith(expect.objectContaining({
      catalog: [{ availableQuantity: 3, brand: "NGK", category: "Фильтры", name: "Тормозные колодки", priceKopeks: 250_000, sku: "PAD-9" }],
      identity: "user-1",
      question: "Есть тормозные колодки?",
    }));
    const [, body, , needsHuman] = (chat.insertAssistantReply as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(needsHuman).toBe(false);
    expect(body).toContain("Нашли подходящие колодки");
    expect(body).toContain("2 500 ₽");
    expect(body).toContain("в наличии: 3 шт.");
  });

  it("never lets the model's own fabricated numbers become the price/stock shown to the customer", async () => {
    // This mirrors the historical bug verbatim: a model claiming a price and
    // a stock count it was never given. The composed body must still show
    // only the real numbers from the catalog row.
    const item = catalogItem({ availableQuantity: 7, name: "Влажные салфетки Autoprofi", priceKopeks: 30_000, sku: "WIPES-1" });
    const answerCustomerQuestion = vi.fn(async () => ({
      message: "Да, у нас есть влажные салфетки! 25 шт — 150 ₽. В наличии.",
      needsHuman: false,
    }));
    const { chat, service } = makeService({ answerCustomerQuestion, search: vi.fn(async () => ({ items: [item] })) });

    await service.respond({
      identity: "user-1", question: "Есть влажные салфетки?", replyToId: MESSAGE_ID, threadId: THREAD_ID,
    });

    const [, body] = (chat.insertAssistantReply as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(body).toContain("300 ₽");
    expect(body).toContain("в наличии: 7 шт.");
  });

  it("degrades to no reply instead of throwing when the catalog search itself fails", async () => {
    const { chat, service } = makeService({ search: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(service.respond({
      identity: "user-1", question: "Есть фильтр?", replyToId: MESSAGE_ID, threadId: THREAD_ID,
    })).resolves.toBeNull();
    expect(chat.insertAssistantReply).not.toHaveBeenCalled();
  });
});

describe("composeAssistantBody / renderCatalogBlock", () => {
  it("always renders price and stock straight from the row, regardless of what the model text says", () => {
    const items = [catalogItem({ availableQuantity: 0, priceKopeks: 99_900 })];
    const body = composeAssistantBody("модель сказала что угодно про цену", items, false);
    expect(body).toContain("999 ₽");
    expect(body).toContain("нет в наличии");
  });

  it("shows 'цена уточняется' rather than inventing a price for a null priceKopeks", () => {
    const block = renderCatalogBlock([catalogItem({ priceKopeks: null })]);
    expect(block).toContain("цена уточняется");
  });

  it("appends a manager note only when needsHuman is true", () => {
    const items = [catalogItem()];
    expect(composeAssistantBody("текст", items, false)).not.toContain("менеджер");
    expect(composeAssistantBody("текст", items, true)).toContain("менеджер");
  });
});

describe("stripContactDetails", () => {
  it("redacts an email address and a phone number before anything is sent to the model", () => {
    const scrubbed = stripContactDetails("Мой телефон +7 924 111-22-33, email test@example.com, нужен фильтр");
    expect(scrubbed).not.toContain("test@example.com");
    expect(scrubbed).not.toContain("924 111-22-33");
    expect(scrubbed).toContain("нужен фильтр");
  });
});
