import { Inject, Injectable, Logger } from "@nestjs/common";

import { AI_PROVIDER, AN30_COMPANY_FACTS, type AiProvider } from "../adapters/provider-contracts.js";
import { CatalogSearchService } from "../catalog/catalog-search.service.js";
import { ChatService } from "./chat.service.js";
import type { ChatMessageView } from "./chat.types.js";

// A structural subset of CatalogSearchService's result rows — only the
// fields this file actually renders or forwards to the model. Deliberately
// not the full `CatalogProductSummary` contract type: that type's
// `primaryImage.mimeType` is a validated enum, while the live search path
// returns the catalog service's own (wider, unvalidated) row shape, and this
// file never touches images at all.
export interface AssistantCatalogRow {
  readonly availableQuantity: number;
  readonly brand: { readonly name: string } | null;
  readonly category: { readonly name: string } | null;
  readonly name: string;
  readonly priceKopeks: number | null;
  readonly sku: string;
}

// How many catalog rows are handed to the assistant as grounding context.
// Kept small on purpose: this is a chat reply, not a search results page.
const CATALOG_SEARCH_LIMIT = 5;
// CatalogSearchQuerySchema (see catalog-search.service.ts) requires q.min(2)
// and rejects multi-line/control-character text outright; a question
// shorter than this, or one that normalizes to nothing, never reaches the
// search at all and falls straight into the honest "not found" path below.
const MIN_SEARCH_TERM_LENGTH = 2;
const MAX_SEARCH_TERM_LENGTH = 120;
// Bounds how much of a (up to 4000-character) chat message is forwarded to
// the model, independent of the shorter search-term cap above.
const MAX_MODEL_QUESTION_LENGTH = 1_000;
const MAX_REPLY_BODY_LENGTH = 4_000;

const NOT_FOUND_MESSAGE = "Не нашёл такую позицию в каталоге 1С прямо сейчас — возможно, изменилось "
  + "название, артикул, либо её сейчас нет в продаже. Уточните у менеджера: он на связи здесь в чате "
  + `или по телефону ${AN30_COMPANY_FACTS.phone} (${AN30_COMPANY_FACTS.hours}). Магазин: ${AN30_COMPANY_FACTS.address}.`;

// Minimal, conservative PII scrubbing applied to the customer's free-text
// question *before* any of it is sent to Google. The assistant only needs
// the part-related question itself — never an email address or phone number
// the customer happens to type while asking it (their account/contact
// details are never attached to the request in the first place; see
// ChatAssistantService.respond, which never reads or forwards auth/contact
// fields). A conservative false-positive redaction (e.g. a long SKU that
// looks like a phone number) is an acceptable trade-off here.
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/gu;
const PHONE_PATTERN = /(?:\+?\d[\d\s()-]{7,}\d)/gu;

export function stripContactDetails(text: string): string {
  return text.replace(EMAIL_PATTERN, "[скрыто]").replace(PHONE_PATTERN, "[скрыто]");
}

// Collapses newlines/tabs/runs of whitespace to a single space so the result
// always satisfies CatalogSearchQuerySchema's single-line constraint. A chat
// message body may legitimately span multiple lines (unlike a search query);
// without this, a multi-line question would make the catalog search throw
// instead of degrading gracefully. Plain `\s` is sufficient: the chat
// message schema already rejects every other control character at
// message-creation time, so newline/tab/carriage-return are the only
// whitespace-like characters that can ever reach this function.
function normalizeForSearch(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function formatKopeks(kopeks: number): string {
  const rubles = Math.floor(kopeks / 100);
  const remainder = kopeks % 100;
  const withSeparators = rubles.toString().replace(/\B(?=(?:\d{3})+(?!\d))/gu, " ");
  return remainder === 0 ? `${withSeparators} ₽` : `${withSeparators}.${remainder.toString().padStart(2, "0")} ₽`;
}

/**
 * Renders the ONLY price/stock numbers the customer ever sees for these
 * items — always computed here, straight from the database rows the server
 * fetched this turn, never from the model. See composeAssistantBody: the
 * model's own free text is appended separately and never supplies these
 * figures (gemini-ai.provider.ts additionally never even shows the model a
 * price or a quantity, and scrubs one out if it invents one anyway).
 */
export function renderCatalogBlock(items: readonly AssistantCatalogRow[]): string {
  const lines = items.map((item) => {
    const brand = item.brand ? `${item.brand.name} ` : "";
    const price = item.priceKopeks === null ? "цена уточняется" : formatKopeks(item.priceKopeks);
    const stock = item.availableQuantity > 0 ? `в наличии: ${item.availableQuantity} шт.` : "нет в наличии";
    return `• ${brand}${item.name} (арт. ${item.sku}) — ${price}, ${stock}`;
  });
  return [
    "Нашли в каталоге (данные из 1С, сервер проверит их ещё раз при оформлении заказа):",
    ...lines,
  ].join("\n");
}

export function composeAssistantBody(
  modelMessage: string,
  items: readonly AssistantCatalogRow[],
  needsHuman: boolean,
): string {
  const parts = [modelMessage.trim(), renderCatalogBlock(items)];
  if (needsHuman) {
    parts.push(`По этому вопросу дополнительно ответит менеджер (${AN30_COMPANY_FACTS.phone}, ${AN30_COMPANY_FACTS.hours}).`);
  }
  return parts.join("\n\n").slice(0, MAX_REPLY_BODY_LENGTH);
}

function toAssistantCatalogItem(item: AssistantCatalogRow) {
  return {
    availableQuantity: item.availableQuantity,
    brand: item.brand?.name ?? null,
    category: item.category?.name ?? null,
    name: item.name,
    priceKopeks: item.priceKopeks,
    sku: item.sku,
  };
}

export interface AssistantRespondParams {
  /** Authenticated user id or client IP — a local rate-limit key only, never sent to the model. */
  readonly identity: string;
  readonly question: string;
  readonly replyToId: string;
  readonly threadId: string;
}

/**
 * Orchestrates one automated assistant turn: search the real catalog, ask
 * the AI provider to describe what was found (never its price/stock), and
 * store the result as a real chat message clearly attributed as an
 * automated assistant, not a human manager (see ChatService.insertAssistantReply).
 *
 * Called after a customer/guest chat message is already stored — see the
 * three call sites in chat.controller.ts and chat-realtime.service.ts, which
 * only invoke this when the *stored* message resolved to sender kind
 * "customer" or "guest" (never for staff replies or the assistant's own
 * messages, which resolve to "system").
 */
@Injectable()
export class ChatAssistantService {
  private readonly logger = new Logger(ChatAssistantService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly catalogSearch: CatalogSearchService,
    private readonly chat: ChatService,
  ) {}

  /**
   * Never rejects: every failure (thread closed/assigned, catalog search
   * error, AI provider error) is caught and simply results in no automated
   * reply, so a bug here can never break the customer's own message send.
   */
  async respond(params: AssistantRespondParams): Promise<ChatMessageView | null> {
    if (!this.ai.enabled) return null; // ADR-004: chat fully works without AI.
    try {
      const thread = await this.chat.threadAssignment(params.threadId);
      // A closed thread gets no more messages; a thread a human has already
      // taken is left to that human, not double-answered by the bot.
      if (!thread || thread.status === "closed" || thread.assignedStaffId) return null;
      // The same message sent again (a retry, a double click) is answered
      // once: no second catalogue search and no second paid model call.
      if (params.replyToId && await this.chat.assistantAnswered(params.threadId, params.replyToId)) return null;
      return await this.buildAndInsertReply(params);
    } catch (error) {
      this.logger.warn(`assistant reply failed for thread ${params.threadId}: ${String(error)}`);
      return null;
    }
  }

  private async buildAndInsertReply(params: AssistantRespondParams): Promise<ChatMessageView | null> {
    const trimmedQuestion = params.question.trim();
    if (trimmedQuestion.length === 0) return null;
    const sanitizedQuestion = stripContactDetails(trimmedQuestion);
    const searchTerm = normalizeForSearch(sanitizedQuestion).slice(0, MAX_SEARCH_TERM_LENGTH);

    const items = searchTerm.length >= MIN_SEARCH_TERM_LENGTH
      ? (await this.catalogSearch.search({ limit: CATALOG_SEARCH_LIMIT, q: searchTerm })).items
      : [];

    if (items.length === 0) {
      return this.chat.insertAssistantReply(params.threadId, NOT_FOUND_MESSAGE, params.replyToId, true);
    }

    const aiResult = await this.ai.answerCustomerQuestion({
      catalog: items.map(toAssistantCatalogItem),
      identity: params.identity,
      question: sanitizedQuestion.slice(0, MAX_MODEL_QUESTION_LENGTH),
    });
    const body = composeAssistantBody(aiResult.message, items, aiResult.needsHuman);
    return this.chat.insertAssistantReply(params.threadId, body, params.replyToId, aiResult.needsHuman);
  }
}
