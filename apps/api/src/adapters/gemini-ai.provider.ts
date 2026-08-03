import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  AssistantModelOutputSchema,
  GeminiGenerateContentResponseSchema,
  type AssistantChatResult,
} from "@an30/contracts";

import { RateLimitService } from "../security/rate-limit.service.js";
import { AN30_COMPANY_FACTS, type AiChatRequest, type AiProvider } from "./provider-contracts.js";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_TOKENS = 400;
// One initial attempt plus one retry — only ever for transient failures
// (network errors, HTTP 429, HTTP 5xx). A permanent failure (400/401/403/404)
// is never retried: retrying a bad request or a bad key just wastes the
// timeout budget twice for the same guaranteed failure.
const MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 400;

// Protects the shop's Gemini quota/budget and stops one customer (or a buggy
// client retry loop) from exhausting it. This is independent of the wider
// per-IP/per-user REST/WS chat rate limits already enforced in
// chat.controller.ts and chat-realtime.service.ts, which protect the HTTP/WS
// surface itself rather than the paid external call.
const RATE_LIMIT_SCOPE = "chat-ai-assist";
const RATE_LIMIT_MAX_REQUESTS = 12;
const RATE_LIMIT_WINDOW_SECONDS = 600;

// A Gemini outage, a malformed response, or an exhausted rate limit must all
// degrade to this — never an error page, and never silence (ADR-004,
// ADR-016). needsHuman is true so the thread is flagged for staff.
const HANDOFF_RESULT: AssistantChatResult = {
  message: "Не получилось обработать вопрос автоматически — здесь в чате скоро подключится менеджер. "
    + `Также можно позвонить ${AN30_COMPANY_FACTS.phone} (${AN30_COMPANY_FACTS.hours}).`,
  needsHuman: true,
};

// Shown instead of the model's own text whenever that text looks like it
// states a price or a stock/availability figure (see applySafetyOverrides
// below) — the real numbers are always rendered separately by
// chat-assistant.service.ts from the database rows themselves.
const PRICE_OR_STOCK_OVERRIDDEN_REPLY = "Нашлось несколько подходящих позиций по вашему запросу — "
  + "точную цену и наличие показываю ниже.";

/**
 * СИСТЕМНЫЙ ПРОМПТ АССИСТЕНТА АН-30 — читайте и редактируйте здесь, это
 * единственное место, где он определён.
 *
 * Почему он такой строгий: более ранний бот магазина (на Lovable) один раз
 * придумал несуществующий товар, цену и наличие — "Да, у нас есть влажные
 * салфетки! Вот что я нашла в наличии: Влажные салфетки Autoprofi, 25 шт —
 * 150 ₽. В наличии" — хотя такого товара не было. Покупатель зря приехал в
 * магазин. Промпт и код вокруг него (см. gemini-ai.provider.ts и
 * chat/chat-assistant.service.ts) делают эту ошибку структурно невозможной,
 * а не просто "менее вероятной":
 *   1. Модель получает только те позиции, которые сервер только что сам
 *      нашёл детерминированным поиском по каталогу 1С (CatalogSearchService)
 *      за этот же ход диалога. Если сервер ничего не нашёл, модель вообще не
 *      вызывается — ассистент сразу честно отвечает "не нашёл" (см.
 *      ChatAssistantService.buildReply). Это гарантия на уровне кода, а не
 *      только просьба к модели.
 *   2. В переданных позициях НЕТ цены и остатка (buildUserTurn их туда
 *      намеренно не кладёт) — модель физически не может процитировать число,
 *      которого у неё никогда не было.
 *   3. Даже если модель всё равно попробует назвать цену или наличие
 *      (например, по общим знаниям, а не по контексту), applySafetyOverrides
 *      вырезает такой ответ до его показа покупателю. Настоящие цену и
 *      остаток покупатель видит только из отдельного блока, который сервер
 *      формирует напрямую из строк БД — если текст модели противоречит
 *      данным, побеждают данные.
 */
export const AN30_ASSISTANT_SYSTEM_PROMPT = `
Ты — автоматический ассистент интернет-магазина автозапчастей «АН-30». Отвечаешь только по-русски,
кратко и по делу (2–5 предложений), простым текстом без markdown — это окно чата, а не документ.

О ЧЁМ МОЖНО ГОВОРИТЬ. В каждый твой ход тебе присылают блок "Найдено в каталоге" — это единственные
товары, которые реально существуют в магазине прямо сейчас, взятые сервером напрямую из 1С в эту же
секунду. Кроме этого списка никаких других товаров, брендов, артикулов или их аналогов не существует.
Никогда не добавляй, не переименовывай и не выдумывай позиции, которых нет в этом списке, и не
предполагай, что похожий товар "наверное тоже есть".

ЦЕНА И НАЛИЧИЕ — НЕ ТВОЯ ЗАДАЧА. В списке нет цены и остатка — это сделано намеренно. Ты НИКОГДА не
называешь цену, количество на складе или наличие/отсутствие товара, даже приблизительно. Точные цену и
наличие сервер покажет клиенту отдельным сообщением сразу после твоего. Просто опиши, что нашлось (по
названию, артикулу, бренду), и что точные цену и наличие покупатель увидит ниже.

ЕСЛИ СПИСОК ПУСТ. Если товаров в блоке "Найдено в каталоге" нет, честно скажи, что не нашёл такую
позицию в каталоге, и предложи обратиться к менеджеру. Никогда не угадывай замену и не утверждай, что
что-то есть в наличии, если этого нет в списке.

РЕАЛЬНЫЕ ФАКТЫ О МАГАЗИНЕ, которые можно называть:
- адрес: ${AN30_COMPANY_FACTS.address};
- телефон: ${AN30_COMPANY_FACTS.phone};
- часы работы: ${AN30_COMPANY_FACTS.hours};
- доставка: ${AN30_COMPANY_FACTS.shipping}
- ${AN30_COMPANY_FACTS.pricingNote}
Никаких других фактов о компании — сроках, гарантии, скидках, акциях, способах доставки помимо
названного — ты не знаешь и не придумываешь. Если спрашивают о том, чего нет в этом списке, скажи, что
уточнишь у менеджера, и поставь needsHuman=true.

ЧТО ВСЕГДА УХОДИТ ЧЕЛОВЕКУ. Ты никогда не обсуждаешь номера банковских карт и реквизиты оплаты и не
подтверждаешь, что заказ оплачен — статус оплаты видит только сервер магазина, не ты. Ты не делаешь
юридических выводов и не решаешь гарантийные споры и жалобы. Во всех этих случаях коротко скажи, что
передашь вопрос менеджеру, и поставь needsHuman=true.

О ПОКУПАТЕЛЕ. Ты не помнишь предыдущие обращения этого человека и не знаешь его личных данных (имя,
телефон, email, номер заказа). Если он сообщает их в вопросе, не повторяй их в ответе — они не нужны,
чтобы найти запчасть.

ФОРМАТ ОТВЕТА. Отвечай СТРОГО в виде JSON-объекта с двумя полями и без текста вне JSON:
{"reply": "твой ответ клиенту простым текстом на русском, без markdown",
 "needsHuman": true или false — true, если вопрос нужно передать человеку (оплата, гарантия,
 юридический вопрос, жалоба, спор, или ты не можешь уверенно закрыть вопрос по списку товаров)}
`.trim();

// Long digit runs have no legitimate reason to appear in a parts-shop chat
// answer, and the assistant must never discuss payment details (see prompt
// above): a card/PAN-shaped number in the model's own text is treated as a
// hard failure, not scrubbed-and-shown.
const CARD_LIKE_NUMBER = /\b(?:\d[ -]?){13,19}\b/u;

// Same defence-in-depth idea, one level softer: if the model's free text
// still contains something that reads like a price or a stock/availability
// claim — despite never having been given one, and despite being told not to
// state one — that specific text is discarded rather than shown, and
// replaced with a neutral phrase. The correct numbers always come from
// chat-assistant.service.ts's deterministic rendering of the database rows,
// never from parsing or trusting this string.
const PRICE_OR_STOCK_CLAIM = /(\d[\d\s]*\s?(₽|руб)|в наличии|нет в наличии|\bшт\.?\b|остат)/iu;

// A small, conservative set of topics the shop owner requires to always
// route to a human, even if the model forgets to set needsHuman itself.
const SENSITIVE_TOPIC = /(оплат|карт[аыу]|cvv|cvc|гаранти|юридич|претензи|\bзакон)/iu;

/**
 * Discards or corrects anything the model produced that the system prompt
 * explicitly forbids, instead of trusting the model to have followed
 * instructions. Pure and exported so the exact historical failure mode
 * ("Влажные салфетки Autoprofi, 25 шт — 150 ₽. В наличии" for a product that
 * did not exist) has a direct, fast unit test.
 */
export function applySafetyOverrides(output: { needsHuman: boolean; reply: string }): AssistantChatResult {
  if (CARD_LIKE_NUMBER.test(output.reply)) return HANDOFF_RESULT;
  if (PRICE_OR_STOCK_CLAIM.test(output.reply)) {
    return { message: PRICE_OR_STOCK_OVERRIDDEN_REPLY, needsHuman: output.needsHuman };
  }
  return { message: output.reply, needsHuman: output.needsHuman || SENSITIVE_TOPIC.test(output.reply) };
}

/**
 * Builds the single user-turn text sent to Gemini. Deliberately excludes
 * `priceKopeks` and `availableQuantity` from every catalog row — see the
 * class doc on AN30_ASSISTANT_SYSTEM_PROMPT for why. Exported and pure so a
 * test can assert the built prompt both includes the catalog rows (name,
 * SKU, brand) and never includes a price/quantity figure.
 */
export function buildUserTurn(request: AiChatRequest): string {
  const rows = request.catalog.map((item, index) => {
    const brand = item.brand ? `${item.brand} ` : "";
    const category = item.category ? ` [${item.category}]` : "";
    return `${index + 1}. ${brand}${item.name} (арт. ${item.sku})${category}`;
  }).join("\n");
  return [
    `Вопрос клиента: ${request.question}`,
    "",
    "Найдено в каталоге прямо сейчас (это единственные существующие варианты, ничего другого в магазине нет):",
    request.catalog.length > 0 ? rows : "(пусто)",
  ].join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

@Injectable()
export class GeminiAiProvider implements AiProvider {
  readonly enabled: boolean;
  private readonly apiKey: string;
  private readonly logger = new Logger(GeminiAiProvider.name);
  private readonly model: string;

  constructor(config: ConfigService, private readonly rateLimit: RateLimitService) {
    this.enabled = config.getOrThrow<boolean>("AI_ENABLED");
    this.apiKey = config.get<string>("GEMINI_API_KEY") ?? "";
    this.model = config.getOrThrow<string>("AI_MODEL");
  }

  async answerCustomerQuestion(request: AiChatRequest): Promise<AssistantChatResult> {
    if (!this.enabled) return HANDOFF_RESULT;
    try {
      await this.rateLimit.consume(
        RATE_LIMIT_SCOPE,
        request.identity,
        RATE_LIMIT_MAX_REQUESTS,
        RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch {
      return HANDOFF_RESULT;
    }

    const raw = await this.requestJson({
      contents: [{ parts: [{ text: buildUserTurn(request) }], role: "user" }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseSchema: {
          properties: { needsHuman: { type: "boolean" }, reply: { type: "string" } },
          required: ["reply", "needsHuman"],
          type: "object",
        },
        temperature: 0.2,
      },
      systemInstruction: { parts: [{ text: AN30_ASSISTANT_SYSTEM_PROMPT }] },
    });
    if (!raw) return HANDOFF_RESULT;
    const text = this.extractText(raw);
    if (!text) return HANDOFF_RESULT;
    const output = this.parseModelOutput(text);
    if (!output) return HANDOFF_RESULT;
    return applySafetyOverrides(output);
  }

  async expandSearchQuery(_query: string): Promise<readonly string[]> {
    // Deliberately inert: ADR-016 requires catalog search ranking to stay
    // deterministic whether or not AI is enabled, and nothing in
    // CatalogSearchService consumes an AI-expanded query yet. Wiring this
    // into ranking is a separate, explicit search-layer change — this
    // implementation intentionally never calls out to Gemini.
    return [];
  }

  private async requestJson(body: unknown): Promise<unknown | null> {
    // Auth is the `?key=` query parameter, not a header — the Gemini v1beta
    // REST API rejects a Bearer Authorization header with 401. The key is
    // never logged: failures below log only the HTTP status or a generic
    // error message, never the request, the URL or the key itself.
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}`
      + `:generateContent?key=${this.apiKey}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) return await response.json();
        const transient = response.status === 429 || response.status >= 500;
        if (transient && attempt < MAX_ATTEMPTS) {
          await delay(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        this.logger.warn(`Gemini request failed with HTTP ${response.status}`);
        return null;
      } catch (error) {
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        this.logger.warn(`Gemini request errored: ${error instanceof Error ? error.message : "unknown"}`);
        return null;
      }
    }
    return null;
  }

  private extractText(raw: unknown): string | null {
    const parsed = GeminiGenerateContentResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.promptFeedback?.blockReason) return null;
    const candidate = parsed.data.candidates?.[0];
    if (!candidate) return null;
    if (candidate.finishReason && candidate.finishReason !== "STOP") return null;
    const text = candidate.content?.parts?.map((part) => part.text ?? "").join("").trim();
    return text ? text : null;
  }

  private parseModelOutput(text: string): { needsHuman: boolean; reply: string } | null {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = AssistantModelOutputSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
}
