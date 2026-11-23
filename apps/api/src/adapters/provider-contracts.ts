import type { Readable } from "node:stream";

import type { AssistantCatalogItem, AssistantChatResult } from "@an30/contracts";

export interface NotificationMessage {
  body: string;
  channel: "email" | "telegram" | "vk";
  recipient: string;
  subject?: string;
}

export interface NotificationResult {
  accepted: boolean;
  provider: string;
  reason?: "disabled" | "unsupported";
}

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<NotificationResult>;
}

export interface SocialIdentity {
  externalId: string;
  provider: "telegram" | "vk";
  verified: boolean;
}

export interface SocialAuthProvider {
  verify(provider: "telegram" | "vk", payload: unknown): Promise<SocialIdentity | null>;
}

// Real, non-negotiable facts about the shop the assistant is allowed to
// state. Kept in exactly one place so the Gemini system prompt, the disabled
// provider's fallback text and the chat layer's own "not found in catalog"
// hand-off message can never drift apart or silently disagree with each
// other. Anything about the company that is NOT here — delivery timelines,
// warranty terms, discounts — the assistant must not invent; it defers to a
// manager instead (see gemini-ai.provider.ts).
export const AN30_COMPANY_FACTS = {
  address: "Чернышевск, ул. Куйбышева 118А",
  hours: "ежедневно 09:00–19:00",
  phone: "+7 (924) 474-26-05",
  pricingNote: "Цены и остатки поступают из 1С и перепроверяются сервером при оформлении заказа.",
  shipping: "Самовывоз из магазина, доставка согласуется отдельно.",
} as const;

/**
 * One grounded turn of the shop assistant. `catalog` is only ever the rows
 * the server itself fetched *this turn* via the deterministic catalog search
 * (see catalog/catalog-search.service.ts) — the model never sees anything
 * else, never sees a previous turn, and never sees price/stock numbers (the
 * Gemini request builder deliberately omits them; see buildUserTurn in
 * gemini-ai.provider.ts). `identity` is the caller's authenticated user id or
 * IP address, used *only* to key the local Redis rate limit before calling
 * out to Google — it is never included in the request sent to the model (see
 * the PII-minimisation comment in chat/chat-assistant.service.ts).
 */
export interface AiChatRequest {
  readonly catalog: readonly AssistantCatalogItem[];
  readonly identity: string;
  readonly question: string;
}

export interface AiProvider {
  readonly enabled: boolean;
  /**
   * Answers a customer's question using only `request.catalog`. Must never
   * throw: a timeout, an HTTP error, a local rate limit, or a malformed
   * model response all degrade to a human hand-off answer with
   * `needsHuman: true` — never an error surfaced to the customer (ADR-004,
   * ADR-016).
   */
  answerCustomerQuestion(request: AiChatRequest): Promise<AssistantChatResult>;
  expandSearchQuery(query: string): Promise<readonly string[]>;
}

export interface StoredObject {
  byteSize: number;
  storageKey: string;
}

export interface StoredObjectStream {
  byteSize: number;
  content: Readable;
}

export interface StorageProvider {
  readonly name: string;
  open?(storageKey: string): Promise<StoredObjectStream>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
  store(content: Buffer, extension: string): Promise<StoredObject>;
}

// Rossko search results. These are intentionally distinct from the shop's own
// catalog types: 1C stock is real shelf inventory ("в наличии"), a supplier
// stock line is "под заказ" with a delivery estimate, and the two must never
// be merged into a single number. Money already arrives converted to integer
// kopeks — a stock whose price could not be parsed cleanly is dropped rather
// than guessed at.
export interface SupplierStock {
  readonly deliveryTime: string | null;
  readonly id: string;
  readonly priceKopeks: number;
  readonly quantity: number;
}

export interface SupplierPart {
  readonly brand: string;
  readonly crosses: readonly SupplierPart[];
  readonly guid: string;
  readonly name: string;
  readonly partNumber: string;
  readonly stocks: readonly SupplierStock[];
}

export interface SupplierSearchResult {
  readonly message: string;
  readonly parts: readonly SupplierPart[];
  readonly success: boolean;
}

/**
 * Who a live supplier call is for. `background` is the shop's own work
 * (filling the cross base): it has its own, smaller share of the supplier's
 * daily allowance and never takes the part reserved for customers.
 */
export type SupplierLane = "background" | "customer";

/** Live calls made to the supplier since 00:00 MSK, when its daily allowance resets. */
export interface SupplierUsage {
  readonly backgroundLimit: number;
  readonly backgroundUsed: number;
  readonly dailyLimit: number;
  readonly day: string;
  readonly used: number;
}

export interface SupplierProvider {
  readonly enabled: boolean;
  search(query: string, lane?: SupplierLane): Promise<SupplierSearchResult>;
  /** Null when the supplier is off or the counters cannot be read. */
  usage?(): Promise<SupplierUsage | null>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");
export const NOTIFICATION_PROVIDER = Symbol("NOTIFICATION_PROVIDER");
export const SOCIAL_AUTH_PROVIDER = Symbol("SOCIAL_AUTH_PROVIDER");
export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");
export const SUPPLIER_PROVIDER = Symbol("SUPPLIER_PROVIDER");
