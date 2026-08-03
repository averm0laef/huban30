import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RateLimitService } from "../security/rate-limit.service.js";
import {
  AN30_ASSISTANT_SYSTEM_PROMPT,
  applySafetyOverrides,
  buildUserTurn,
  GeminiAiProvider,
} from "./gemini-ai.provider.js";

const CONFIG_VALUES: Record<string, unknown> = {
  AI_ENABLED: true,
  AI_MODEL: "gemini-2.5-flash",
  GEMINI_API_KEY: "test-gemini-key",
};

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...CONFIG_VALUES, ...overrides };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

function makeRateLimit() {
  return { consume: vi.fn(async () => undefined) } as unknown as RateLimitService;
}

function geminiResponse(reply: string, needsHuman: boolean, finishReason = "STOP") {
  return {
    candidates: [{
      content: { parts: [{ text: JSON.stringify({ needsHuman, reply }) }] },
      finishReason,
    }],
  };
}

const CATALOG_ROW = {
  availableQuantity: 7,
  brand: "NGK",
  category: "Фильтры",
  name: "Фильтр масляный",
  priceKopeks: 125_000,
  sku: "FILTER-1",
};

describe("buildUserTurn", () => {
  it("includes the catalog rows and the customer question, but never a price or a quantity", () => {
    const prompt = buildUserTurn({
      catalog: [CATALOG_ROW],
      identity: "user-1",
      question: "Есть масляный фильтр NGK?",
    });

    expect(prompt).toContain("Есть масляный фильтр NGK?");
    expect(prompt).toContain("NGK Фильтр масляный (арт. FILTER-1)");
    expect(prompt).toContain("Фильтры");
    // Structural guarantee: the model is never even shown a number it could
    // restate — no price and no stock quantity anywhere in the built prompt.
    expect(prompt).not.toMatch(/125.?000|1250|\b7\b/u);
  });

  it("says plainly that nothing was found when the catalog is empty", () => {
    const prompt = buildUserTurn({ catalog: [], identity: "user-1", question: "Есть жвачка?" });
    expect(prompt).toContain("(пусто)");
  });
});

describe("AN30_ASSISTANT_SYSTEM_PROMPT", () => {
  it("encodes the strict rules: catalog-only, no price/stock, real facts only, JSON output, human hand-off", () => {
    // Whitespace-normalized so a future re-wrap of the prompt's line breaks
    // does not make this brittle — the exact words matter, not the layout.
    const normalized = AN30_ASSISTANT_SYSTEM_PROMPT.replace(/\s+/gu, " ");
    expect(normalized).toContain("НИКОГДА не называешь цену");
    expect(normalized).toContain("+7 (924) 474-26-05");
    expect(normalized).toContain("needsHuman");
    expect(normalized).toContain("банковских карт");
    expect(normalized).toContain("юридич");
  });
});

describe("applySafetyOverrides", () => {
  it("scrubs the exact historical failure: an invented price and stock claim", () => {
    // This is (a paraphrase of) what the previous Lovable-built bot actually
    // said about a product that did not exist.
    const result = applySafetyOverrides({
      needsHuman: false,
      reply: "Да, у нас есть влажные салфетки! Влажные салфетки Autoprofi, 25 шт — 150 ₽. В наличии.",
    });
    expect(result.message).not.toMatch(/150|25 шт|в наличии/iu);
  });

  it("discards a reply containing a card/PAN-shaped number and forces a human hand-off", () => {
    const result = applySafetyOverrides({ needsHuman: false, reply: "Ваша карта 4111 1111 1111 1111 принята" });
    expect(result.needsHuman).toBe(true);
    expect(result.message).not.toContain("4111");
  });

  it("forces needsHuman on sensitive topics even when the model forgot to set it", () => {
    const result = applySafetyOverrides({ needsHuman: false, reply: "По гарантии на этот товар уточню детали" });
    expect(result.needsHuman).toBe(true);
  });

  it("passes through an ordinary, compliant reply unchanged", () => {
    const result = applySafetyOverrides({ needsHuman: false, reply: "Нашли подходящий фильтр, посмотрите ниже" });
    expect(result).toEqual({ message: "Нашли подходящий фильтр, посмотрите ниже", needsHuman: false });
  });
});

describe("GeminiAiProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("is disabled without a live key and never touches the network", async () => {
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig({ AI_ENABLED: false, GEMINI_API_KEY: undefined }), rateLimit);
    expect(provider.enabled).toBe(false);

    const result = await provider.answerCustomerQuestion({ catalog: [CATALOG_ROW], identity: "1.2.3.4", question: "?" });
    expect(result.needsHuman).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the key as a query parameter, never as a Bearer header", async () => {
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(geminiResponse("Нашли то, что вы искали", false)), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    const result = await provider.answerCustomerQuestion({
      catalog: [CATALOG_ROW],
      identity: "user-1",
      question: "Есть масляный фильтр?",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("key=test-gemini-key");
    expect((init.headers as Record<string, string> | undefined)?.authorization).toBeUndefined();
    expect(result).toEqual({ message: "Нашли то, что вы искали", needsHuman: false });
  });

  it("rate-limits per identity before calling out, and degrades to a human hand-off when exhausted", async () => {
    const rateLimit = { consume: vi.fn(async () => { throw new Error("rate limited"); }) } as unknown as RateLimitService;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    const result = await provider.answerCustomerQuestion({ catalog: [CATALOG_ROW], identity: "user-1", question: "?" });

    expect(result.needsHuman).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retries once on a transient 500 and then succeeds", async () => {
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(geminiResponse("Готово", false)), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    const result = await provider.answerCustomerQuestion({ catalog: [CATALOG_ROW], identity: "user-1", question: "?" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ message: "Готово", needsHuman: false });
  });

  it("never retries a permanent 400/401/403 failure", async () => {
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn(async () => new Response("bad request", { status: 400 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    const result = await provider.answerCustomerQuestion({ catalog: [CATALOG_ROW], identity: "user-1", question: "?" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.needsHuman).toBe(true);
  });

  it("degrades to a human hand-off instead of throwing when the network call rejects (timeout/outage)", async () => {
    const rateLimit = makeRateLimit();
    globalThis.fetch = vi.fn(async () => { throw new DOMException("The operation was aborted", "AbortError"); }) as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    await expect(provider.answerCustomerQuestion({ catalog: [CATALOG_ROW], identity: "user-1", question: "?" }))
      .resolves.toEqual(expect.objectContaining({ needsHuman: true }));
  });

  it("degrades to a human hand-off when the model output is not valid JSON", async () => {
    const rateLimit = makeRateLimit();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "не JSON, а простой текст" }] }, finishReason: "STOP" }],
    }), { status: 200 })) as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    const result = await provider.answerCustomerQuestion({ catalog: [CATALOG_ROW], identity: "user-1", question: "?" });
    expect(result.needsHuman).toBe(true);
  });

  it("degrades to a human hand-off when the candidate was blocked or cut off abnormally", async () => {
    const rateLimit = makeRateLimit();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(
      geminiResponse("частичный ответ", false, "SAFETY"),
    ), { status: 200 })) as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    const result = await provider.answerCustomerQuestion({ catalog: [CATALOG_ROW], identity: "user-1", question: "?" });
    expect(result.needsHuman).toBe(true);
  });

  it("never calls the network for expandSearchQuery — ranking stays deterministic regardless of AI (ADR-016)", async () => {
    const rateLimit = makeRateLimit();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new GeminiAiProvider(makeConfig(), rateLimit);
    await expect(provider.expandSearchQuery("фильтр")).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
