import { z } from "zod";

// Contracts for the Gemini-backed shop assistant (AN30-011 chat AI).
//
// Why this file exists: the owner's earlier (Lovable) chat bot once invented
// a product, a price and a stock level it had no data for ("Влажные салфетки
// Autoprofi, 25 шт — 150 ₽. В наличии") and a customer drove to the shop for
// a part that did not exist. The schemas below exist to make that class of
// bug structurally harder to reintroduce:
//   - `AssistantCatalogItemSchema` never carries free text from the model —
//     it is always built server-side from rows the deterministic catalog
//     search (apps/api/src/catalog/catalog-search.service.ts) already
//     fetched this turn.
//   - `AssistantChatResultSchema` is the *only* shape an AI provider may
//     return. It has no price/stock/quantity field at all: those numbers are
//     rendered by the server directly from the database rows (see
//     apps/api/src/chat/chat-assistant.service.ts), never accepted from the
//     model's own text.
//   - `GeminiGenerateContentResponseSchema` defensively parses the untrusted
//     external Gemini API response before any of it is trusted.

// One catalog row handed to the assistant as grounding context for a single
// turn. Deliberately excludes nothing the model needs to describe an item by
// name/brand/SKU, but see AN30-011 chat code: the Gemini request builder
// additionally chooses not to serialise priceKopeks/availableQuantity into
// the text sent to the model, so the model never even sees a number it could
// restate incorrectly.
export const AssistantCatalogItemSchema = z.object({
  availableQuantity: z.number().int().nonnegative(),
  brand: z.string().trim().min(1).max(500).nullable(),
  category: z.string().trim().min(1).max(500).nullable(),
  name: z.string().trim().min(1).max(500),
  priceKopeks: z.number().int().nonnegative().nullable(),
  sku: z.string().trim().min(1).max(200),
}).strict();
export type AssistantCatalogItem = z.infer<typeof AssistantCatalogItemSchema>;

// The only shape any AiProvider implementation (Gemini or otherwise) may
// return from `answerCustomerQuestion`. `needsHuman` is how the assistant
// asks for a manager hand-off; the chat layer also forces it independently
// (empty catalog match, payment/legal/warranty topics, malformed model
// output) — see chat-assistant.service.ts and gemini-ai.provider.ts.
export const AssistantChatResultSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  needsHuman: z.boolean(),
}).strict();
export type AssistantChatResult = z.infer<typeof AssistantChatResultSchema>;

// Defensive parse of the untrusted Gemini v1beta generateContent response.
// Only the first candidate's text parts are ever read, and anything blocked
// or cut off abnormally (finishReason other than STOP) is treated by the
// caller as "no usable answer" — never guessed at or partially trusted.
export const GeminiGenerateContentResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() }).partial()).optional(),
    }).partial().optional(),
    finishReason: z.string().optional(),
  })).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).partial().optional(),
}).passthrough();
export type GeminiGenerateContentResponse = z.infer<typeof GeminiGenerateContentResponseSchema>;

// The strict JSON shape the model itself is instructed to reply with (see
// AN30_ASSISTANT_SYSTEM_PROMPT in gemini-ai.provider.ts). Parsed defensively:
// if the model's output does not match this exactly, it is discarded and the
// caller falls back to a human hand-off answer rather than guessing at a
// malformed response.
export const AssistantModelOutputSchema = z.object({
  needsHuman: z.boolean(),
  reply: z.string().trim().min(1).max(2_000),
}).strict();
export type AssistantModelOutput = z.infer<typeof AssistantModelOutputSchema>;
