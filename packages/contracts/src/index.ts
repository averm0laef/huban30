import { z } from "zod";

import { SupplierCrossPairSchema } from "./suppliers.js";

export * from "./assistant.js";
export * from "./client-hub.js";
export * from "./customer-avatars.js";
export * from "./catalog-enrichment.js";
export * from "./catalog-search-normalize.js";
export * from "./one-c-exchange.js";
export * from "./parts-finder.js";
export * from "./part-identity.js";
export * from "./suppliers.js";

const SAFE_SINGLE_LINE = /^[^\u0000-\u001F\u007F]+$/u;

export const ROLES = ["customer", "manager", "director", "admin"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const PERMISSIONS = [
  "account:read:self",
  "account:update:self",
  "wishlist:manage:self",
  "orders:read:self",
  "orders:read:any",
  "orders:update:any",
  "requests:read:any",
  "requests:update:any",
  "chat:use:self",
  "chat:manage:any",
  "catalog:read",
  "catalog:write",
  "catalog:import",
  "reports:read",
  "staff:read",
  "staff:invite",
  "staff:manage",
  "settings:manage",
  "audit:read",
  "auth:tokens:read",
  "content:manage",
  "inbox:manage",
] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

export const ROLE_PERMISSIONS = {
  customer: [
    "account:read:self",
    "account:update:self",
    "wishlist:manage:self",
    "orders:read:self",
    "chat:use:self",
    "catalog:read",
  ],
  manager: [
    "content:manage",
    "inbox:manage",
    "account:read:self",
    "account:update:self",
    "orders:read:any",
    "orders:update:any",
    "requests:read:any",
    "requests:update:any",
    "chat:manage:any",
    "catalog:read",
    "catalog:write",
    "catalog:import",
  ],
  director: [
    "content:manage",
    "inbox:manage",
    "account:read:self",
    "account:update:self",
    "orders:read:any",
    "orders:update:any",
    "requests:read:any",
    "requests:update:any",
    "chat:manage:any",
    "catalog:read",
    "catalog:write",
    "catalog:import",
    "reports:read",
    "staff:read",
  ],
  admin: PERMISSIONS,
} as const satisfies Record<Role, readonly Permission[]>;

// Support tool for environments where transactional email is not configured
// (see AuthService.adminPendingToken): lets an authenticated admin retrieve
// the link that would otherwise have been emailed for a given address.
export const AdminPendingTokenQuerySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
}).strict();
export type AdminPendingTokenQuery = z.infer<typeof AdminPendingTokenQuerySchema>;

export const ADMIN_PENDING_TOKEN_PURPOSES = [
  "email_verification",
  "password_reset",
  "staff_invitation",
] as const;
export const AdminPendingTokenPurposeSchema = z.enum(ADMIN_PENDING_TOKEN_PURPOSES);
export type AdminPendingTokenPurpose = z.infer<typeof AdminPendingTokenPurposeSchema>;

// Checkout creates a заявка (manager request), not a payment: "Пока без
// оплаты! просто создания заявок для менеджеров!" -- there is no payment
// gateway and no reservation held by a timer. A заявка starts at
// awaiting_confirmation and a manager moves it forward by phone.
export const ORDER_STATUSES = [
  "awaiting_confirmation",
  "processing",
  "awaiting_delivery_terms",
  "ready",
  "completed",
  "cancelled",
] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const MoneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type Money = z.infer<typeof MoneySchema>;

const CheckoutIdempotencyKeySchema = z.uuid();
// v3: the offer no longer describes a paid, timer-reserved checkout --
// checkout creates a заявка (manager request); see docs/CHECKOUT_AND_PAYMENTS.md.
export const CHECKOUT_LEGAL_POLICY_VERSION = "checkout-terms-2026-08-30-v3" as const;
export const CHECKOUT_PERSONAL_DATA_CONSENT_VERSION =
  "checkout-personal-data-2026-08-15-v1" as const;
export const CHECKOUT_PERSONAL_DATA_CONSENT_DOCUMENT_PATH =
  "/checkout-personal-data-consent" as const;
export const CHECKOUT_PERSONAL_DATA_CONSENT_TEXT =
  "Я даю согласие на обработку указанных персональных данных для создания и исполнения заказа на условиях отдельного документа «Согласие на обработку данных для заказа»." as const;
export const CONTACT_CONSENT_POLICY_VERSION = "contact-personal-data-2026-08-15-v2" as const;
export const CONTACT_PERSONAL_DATA_CONSENT_DOCUMENT_PATH =
  "/contact-personal-data-consent" as const;
export const CONTACT_PERSONAL_DATA_CONSENT_TEXT =
  "Я даю согласие на обработку указанных персональных данных только для ответа на это обращение на условиях отдельного документа «Согласие на обработку данных для обращения»." as const;
/**
 * The browser sends this value with an explicit registration consent. The
 * API rejects stale versions and stores the accepted version with the user,
 * server timestamp and request metadata as an immutable evidence record.
 */
export const REGISTRATION_PERSONAL_DATA_CONSENT_VERSION =
  "registration-personal-data-2026-08-15-v1" as const;
export const REGISTRATION_PERSONAL_DATA_CONSENT_TEXT =
  "Я даю согласие на обработку персональных данных для регистрации и использования личного кабинета на условиях документа «Согласие на обработку персональных данных»." as const;
const CheckoutPhoneSchema = z.string().trim().min(7).max(32).regex(/^\+[1-9]\d{6,14}$/u);

export const CheckoutItemSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(100),
}).strict();
export type CheckoutItem = z.infer<typeof CheckoutItemSchema>;

export const CheckoutContactSchema = z.object({
  // Normalise before validating: `.trim()` and `.toLowerCase()` are transforms
  // that run after the check they follow, so `z.email().trim()` would reject a
  // pasted or autofilled address with surrounding whitespace.
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  name: z.string().trim().min(2).max(160).regex(SAFE_SINGLE_LINE),
  phone: CheckoutPhoneSchema,
}).strict();
export type CheckoutContact = z.infer<typeof CheckoutContactSchema>;

export const CheckoutDeliverySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("pickup") }).strict(),
  z.object({
    address: z.string().trim().min(5).max(1_000),
    method: z.literal("needs_quote"),
  }).strict(),
]);
export type CheckoutDelivery = z.infer<typeof CheckoutDeliverySchema>;

export const CheckoutRequestSchema = z.object({
  contact: CheckoutContactSchema,
  customerNote: z.string().trim().max(2_000).nullable().default(null),
  delivery: CheckoutDeliverySchema,
  idempotencyKey: CheckoutIdempotencyKeySchema,
  items: z.array(CheckoutItemSchema).min(1).max(100),
  legalPolicyVersion: z.literal(CHECKOUT_LEGAL_POLICY_VERSION),
  personalDataConsent: z.literal(true, { error: "personal data consent is required" }),
  personalDataConsentVersion: z.literal(CHECKOUT_PERSONAL_DATA_CONSENT_VERSION),
  termsAccepted: z.literal(true, { error: "terms acceptance is required" }),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  for (const [index, item] of value.items.entries()) {
    if (seen.has(item.productId)) {
      context.addIssue({
        code: "custom",
        message: "duplicate product in checkout",
        path: ["items", index, "productId"],
      });
    }
    seen.add(item.productId);
  }
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const OrderStatusUpdateSchema = z.object({
  reason: z.string().trim().min(3).max(1_000),
  status: OrderStatusSchema,
  version: z.number().int().positive(),
}).strict();
export type OrderStatusUpdate = z.infer<typeof OrderStatusUpdateSchema>;

export const STAFF_PAGE_LIMITS = [25, 50, 100] as const;
export const StaffPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(4_800).default(0),
}).strict();

const StaffSearchSchema = z.string().trim().min(2).max(120).regex(SAFE_SINGLE_LINE).optional();
const SortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

export const StaffOrdersQuerySchema = StaffPageQuerySchema.extend({
  direction: SortDirectionSchema,
  q: StaffSearchSchema,
  sort: z.enum(["createdAt", "publicNumber", "status", "totalAmountKopeks"]).default("createdAt"),
  status: OrderStatusSchema.optional(),
}).strict();
export type StaffOrdersQuery = z.infer<typeof StaffOrdersQuerySchema>;

export const ChatThreadStatusSchema = z.enum([
  "open",
  "waiting_customer",
  "waiting_staff",
  "closed",
]);
export type ChatThreadStatus = z.infer<typeof ChatThreadStatusSchema>;

export const StaffChatsQuerySchema = StaffPageQuerySchema.extend({
  assigned: z.enum(["any", "mine", "unassigned"]).default("any"),
  direction: SortDirectionSchema,
  q: StaffSearchSchema,
  sort: z.enum(["createdAt", "lastMessageAt", "status"]).default("lastMessageAt"),
  status: ChatThreadStatusSchema.optional(),
}).strict();
export type StaffChatsQuery = z.infer<typeof StaffChatsQuerySchema>;

export const ContactRequestStatusSchema = z.enum(["new", "in_progress", "resolved", "closed"]);
export type ContactRequestStatus = z.infer<typeof ContactRequestStatusSchema>;

export const StaffRequestsQuerySchema = StaffPageQuerySchema.extend({
  assigned: z.enum(["any", "mine", "unassigned"]).default("any"),
  direction: SortDirectionSchema,
  q: StaffSearchSchema,
  sort: z.enum(["createdAt", "source", "status"]).default("createdAt"),
  source: z.enum(["contacts", "expert_help", "vin_request"]).optional(),
  status: ContactRequestStatusSchema.optional(),
}).strict();
export type StaffRequestsQuery = z.infer<typeof StaffRequestsQuerySchema>;

export const StaffRequestUpdateSchema = z.object({
  assignedStaffId: z.uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(500).regex(SAFE_SINGLE_LINE),
  status: ContactRequestStatusSchema.optional(),
  version: z.number().int().positive(),
}).strict().refine(
  (value) => value.assignedStaffId !== undefined || value.status !== undefined,
  { message: "assignment or status is required" },
);
export type StaffRequestUpdate = z.infer<typeof StaffRequestUpdateSchema>;

export const StaffChatUpdateSchema = z.object({
  assignedStaffId: z.uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(500).regex(SAFE_SINGLE_LINE),
  status: ChatThreadStatusSchema.optional(),
  version: z.number().int().positive(),
}).strict().refine(
  (value) => value.assignedStaffId !== undefined || value.status !== undefined,
  { message: "assignment or status is required" },
);
export type StaffChatUpdate = z.infer<typeof StaffChatUpdateSchema>;

/** Soft delete of a chat by a director or administrator, with a reason for the audit log. */
export const StaffChatDeleteSchema = z.object({
  reason: z.string().trim().min(3).max(500).regex(SAFE_SINGLE_LINE),
  version: z.number().int().positive(),
}).strict();
export type StaffChatDelete = z.infer<typeof StaffChatDeleteSchema>;

export const StaffCatalogQuerySchema = StaffPageQuerySchema.extend({
  availability: z.enum(["all", "available", "out_of_stock", "low_stock"]).default("all"),
  direction: SortDirectionSchema,
  q: StaffSearchSchema,
  sort: z.enum(["available", "name", "price", "sku", "updatedAt"]).default("updatedAt"),
  state: z.enum(["all", "active", "inactive"]).default("all"),
}).strict();
export type StaffCatalogQuery = z.infer<typeof StaffCatalogQuerySchema>;

export const StaffInvoicesQuerySchema = StaffPageQuerySchema.extend({
  direction: SortDirectionSchema,
  q: StaffSearchSchema,
  sort: z.enum(["amountKopeks", "createdAt", "invoiceNumber", "status"]).default("createdAt"),
  status: z.enum(["draft", "issued", "cancelled"]).optional(),
}).strict();
export type StaffInvoicesQuery = z.infer<typeof StaffInvoicesQuerySchema>;

export const StaffInvoiceCreateSchema = z.object({ orderId: z.uuid() }).strict();
export type StaffInvoiceCreate = z.infer<typeof StaffInvoiceCreateSchema>;

export const StaffInvoiceUpdateSchema = z.object({
  reason: z.string().trim().min(3).max(500).regex(SAFE_SINGLE_LINE),
  status: z.enum(["issued", "cancelled"]),
  version: z.number().int().positive(),
}).strict();
export type StaffInvoiceUpdate = z.infer<typeof StaffInvoiceUpdateSchema>;

export const StaffTeamQuerySchema = StaffPageQuerySchema.extend({
  q: StaffSearchSchema,
  role: z.enum(["manager", "director", "admin"]).optional(),
  status: z.enum(["invited", "active", "suspended", "terminated"]).optional(),
}).strict();

export const StaffAuditQuerySchema = StaffPageQuerySchema.extend({
  action: z.string().trim().min(2).max(120).regex(SAFE_SINGLE_LINE).optional(),
  entityType: z.string().trim().min(2).max(120).regex(SAFE_SINGLE_LINE).optional(),
}).strict();

export const CATALOG_IMPORT_ENTITY_TYPES = [
  "brand",
  "category",
  "warehouse",
  "product",
  "price",
  "stock",
] as const;
export const CatalogImportEntityTypeSchema = z.enum(CATALOG_IMPORT_ENTITY_TYPES);
export type CatalogImportEntityType = z.infer<typeof CatalogImportEntityTypeSchema>;

const ExternalIdSchema = z.string().trim().min(1).max(128).regex(SAFE_SINGLE_LINE);
const SourceVersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const CatalogNameSchema = z.string().trim().min(1).max(240).regex(SAFE_SINGLE_LINE);
const SlugSchema = z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const AttributesSchema = z.record(z.string().max(120).regex(SAFE_SINGLE_LINE), z.unknown())
  .superRefine((value, context) => {
    const stack: Array<{ depth: number; value: unknown }> = [{ depth: 1, value }];
    let nodes = 0;
    while (stack.length > 0) {
      const current = stack.pop()!;
      nodes += 1;
      if (nodes > 5_000 || current.depth > 12) {
        context.addIssue({ code: "custom", message: "attributes JSON is too complex" });
        return;
      }
      if (typeof current.value === "string" && current.value.length > 10_000) {
        context.addIssue({ code: "custom", message: "attributes string is too long" });
        return;
      }
      if (Array.isArray(current.value)) {
        if (current.value.length > 1_000) {
          context.addIssue({ code: "custom", message: "attributes array is too large" });
          return;
        }
        for (const entry of current.value) stack.push({ depth: current.depth + 1, value: entry });
      } else if (current.value && typeof current.value === "object") {
        for (const [key, entry] of Object.entries(current.value)) {
          if (key.length > 120 || !SAFE_SINGLE_LINE.test(key)) {
            context.addIssue({ code: "custom", message: "attributes key is invalid" });
            return;
          }
          stack.push({ depth: current.depth + 1, value: entry });
        }
      } else if (
        current.value !== null
        && !["boolean", "number", "string"].includes(typeof current.value)
      ) {
        context.addIssue({ code: "custom", message: "attributes contains a non-JSON value" });
        return;
      }
    }
  });

export const OneCCatalogRowSchema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("brand"),
    externalId: ExternalIdSchema,
    isActive: z.boolean().default(true),
    name: CatalogNameSchema,
    slug: SlugSchema,
    version: SourceVersionSchema,
  }).strict(),
  z.object({
    description: z.string().trim().max(10_000).nullable().default(null),
    entityType: z.literal("category"),
    externalId: ExternalIdSchema,
    isActive: z.boolean().default(true),
    name: CatalogNameSchema,
    parentExternalId: ExternalIdSchema.nullable().default(null),
    slug: SlugSchema,
    sortOrder: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    version: SourceVersionSchema,
  }).strict(),
  z.object({
    code: z.string().trim().min(1).max(64).regex(SAFE_SINGLE_LINE),
    entityType: z.literal("warehouse"),
    externalId: ExternalIdSchema,
    isActive: z.boolean().default(true),
    name: CatalogNameSchema,
    version: SourceVersionSchema,
  }).strict(),
  z.object({
    attributes: AttributesSchema.default({}),
    brandExternalId: ExternalIdSchema.nullable().default(null),
    categoryExternalId: ExternalIdSchema.nullable().default(null),
    description: z.string().trim().max(50_000).nullable().default(null),
    entityType: z.literal("product"),
    externalId: ExternalIdSchema,
    isActive: z.boolean().default(true),
    name: CatalogNameSchema,
    // The item's code in 1С («Код»), when the file carries it: a product loaded before the exchange under its code
    // is recognised by it once 1С starts sending its own identifier.
    oneCCode: ExternalIdSchema.optional(),
    searchText: z.string().trim().max(10_000).nullable().default(null),
    sku: z.string().trim().min(1).max(128).regex(SAFE_SINGLE_LINE),
    slug: SlugSchema,
    version: SourceVersionSchema,
  }).strict(),
  z.object({
    amountKopeks: MoneySchema,
    currency: z.literal("RUB").default("RUB"),
    entityType: z.literal("price"),
    productExternalId: ExternalIdSchema,
    version: SourceVersionSchema,
  }).strict(),
  z.object({
    entityType: z.literal("stock"),
    productExternalId: ExternalIdSchema,
    quantityOnHand: z.number().int().nonnegative().max(2_147_483_647),
    version: SourceVersionSchema,
    warehouseExternalId: ExternalIdSchema,
  }).strict(),
]);
export type OneCCatalogRow = z.infer<typeof OneCCatalogRowSchema>;

export const OneCImportEnvelopeSchema = z.object({
  exportedAt: z.iso.datetime({ offset: true }),
  externalBatchId: z.string().trim().min(1).max(128).regex(SAFE_SINGLE_LINE),
  rows: z.array(OneCCatalogRowSchema).min(1).max(5_000),
  schemaVersion: z.literal(1),
}).strict();
export type OneCImportEnvelope = z.infer<typeof OneCImportEnvelopeSchema>;

const CHAT_TEXT = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u;

/**
 * The short intake questionnaire a customer answers before a new chat
 * thread is created (see `ChatThreadCreateSchema` below). Only `intent` is
 * required -- a customer who doesn't know their VIN, or has no article
 * number yet, must still be able to reach a manager.
 */
export const CHAT_INTAKE_INTENTS = ["part", "advice", "order", "other"] as const;
export const ChatIntakeIntentSchema = z.enum(CHAT_INTAKE_INTENTS);
export type ChatIntakeIntent = z.infer<typeof ChatIntakeIntentSchema>;

/** Shared verbatim between the intake form and the opening message the
 * manager reads, so the two are never worded differently. */
export const CHAT_INTAKE_INTENT_LABELS: Record<ChatIntakeIntent, string> = {
  advice: "Помочь подобрать деталь",
  order: "Вопрос по уже сделанному заказу",
  other: "Другое",
  part: "Нужна деталь по артикулу",
};

export const ChatIntakeSchema = z.object({
  articleNumber: z.string().trim().max(80).regex(CHAT_TEXT).nullable().default(null),
  comment: z.string().trim().max(1_000).regex(CHAT_TEXT).nullable().default(null),
  intent: ChatIntakeIntentSchema,
  vehicle: z.string().trim().max(160).regex(CHAT_TEXT).nullable().default(null),
}).strict();
export type ChatIntake = z.infer<typeof ChatIntakeSchema>;

const INTAKE_UNANSWERED = "не указано";
const INTAKE_PREFIXES = { article: "Номер детали: ", comment: "Комментарий: ", intent: "Что нужно: ", vehicle: "Автомобиль/VIN: " } as const;

/** The thread's opening message: what the manager reads and the chat draws as a questionnaire card. */
export function formatChatIntakeMessage(intake: ChatIntake): string {
  const lines = [
    `${INTAKE_PREFIXES.intent}${CHAT_INTAKE_INTENT_LABELS[intake.intent]}`,
    `${INTAKE_PREFIXES.vehicle}${intake.vehicle ?? INTAKE_UNANSWERED}`,
    `${INTAKE_PREFIXES.article}${intake.articleNumber ?? INTAKE_UNANSWERED}`,
  ];
  if (intake.comment) lines.push(`${INTAKE_PREFIXES.comment}${intake.comment}`);
  return lines.join("\n");
}

export interface ParsedChatIntake { article: string | null; comment: string | null; intent: string; vehicle: string | null }

/** Reads an opening message written by formatChatIntakeMessage back; null for any other message. */
export function parseChatIntakeMessage(body: string | null | undefined): ParsedChatIntake | null {
  if (!body) return null;
  const [intentLine, vehicleLine, articleLine, ...rest] = body.split("\n");
  if (!intentLine?.startsWith(INTAKE_PREFIXES.intent) || !vehicleLine?.startsWith(INTAKE_PREFIXES.vehicle)
    || !articleLine?.startsWith(INTAKE_PREFIXES.article)) return null;
  const intent = intentLine.slice(INTAKE_PREFIXES.intent.length);
  if (!Object.values(CHAT_INTAKE_INTENT_LABELS).includes(intent)) return null;
  const answer = (line: string, prefix: string) => {
    const value = line.slice(prefix.length).trim();
    return value && value !== INTAKE_UNANSWERED ? value : null;
  };
  const comment = rest.length > 0 && rest[0]!.startsWith(INTAKE_PREFIXES.comment)
    ? [rest[0]!.slice(INTAKE_PREFIXES.comment.length), ...rest.slice(1)].join("\n").trim() || null
    : null;
  if (rest.length > 0 && comment === null) return null;
  return { article: answer(articleLine, INTAKE_PREFIXES.article), comment, intent, vehicle: answer(vehicleLine, INTAKE_PREFIXES.vehicle) };
}

/**
 * `subject` is derived by the client from the intake answers (see
 * `intakeSubject` in the storefront's chat-state.ts) rather than typed by
 * hand -- the customer is never asked to title their own conversation.
 * `intake` is required: this is what makes the pre-chat questionnaire a
 * real gate rather than a frontend-only suggestion, for both the
 * authenticated and guest thread-creation endpoints.
 */
export const ChatThreadCreateSchema = z.object({
  intake: ChatIntakeSchema,
  orderId: z.uuid().nullable().default(null),
  subject: z.string().trim().min(2).max(240).regex(CHAT_TEXT),
}).strict();
export type ChatThreadCreate = z.infer<typeof ChatThreadCreateSchema>;

export const ChatMessageCreateSchema = z.object({
  body: z.string().trim().min(1).max(4_000).regex(CHAT_TEXT),
  clientMessageId: z.uuid(),
  replyToId: z.uuid().nullable().default(null),
}).strict();
export type ChatMessageCreate = z.infer<typeof ChatMessageCreateSchema>;

const ChatCursorSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/u).default("0");

export const ChatClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    afterSequence: ChatCursorSchema,
    guestToken: z.string().min(32).max(256).optional(),
    threadId: z.uuid(),
    type: z.literal("subscribe"),
  }).strict(),
  z.object({
    body: z.string().trim().min(1).max(4_000).regex(CHAT_TEXT),
    clientMessageId: z.uuid(),
    replyToId: z.uuid().nullable().default(null),
    type: z.literal("message.send"),
  }).strict(),
  z.object({
    messageId: z.uuid(),
    type: z.literal("receipt.read"),
  }).strict(),
  z.object({ type: z.literal("ping") }).strict(),
  // Staff-only: subscribes the socket to a lightweight "something changed"
  // nudge for every thread (not just one), so the staff queue list can
  // refetch itself live instead of only on the staff member's own actions.
  // Requires `chat:manage:any` (see ChatRealtimeService.consume); never
  // delivers message bodies or thread details over this channel — the
  // client always re-fetches via the authorized REST query.
  z.object({ type: z.literal("subscribe.queue") }).strict(),
]);
export type ChatClientEvent = z.infer<typeof ChatClientEventSchema>;

export const CatalogSearchQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().trim().min(2).max(120).regex(SAFE_SINGLE_LINE),
}).strict();
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuerySchema>;

export const CATALOG_PUBLIC_SLUG_MAX_LENGTH = 180;
const CatalogPublicSlugSchema = z.string().trim().min(1).max(CATALOG_PUBLIC_SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const CatalogOptionalMoneyQuerySchema = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
);
const CatalogBrandFilterSchema = z.union([
  CatalogPublicSlugSchema,
  z.array(CatalogPublicSlugSchema).min(1).max(20),
]).optional().transform((value) => value === undefined ? [] : Array.isArray(value) ? value : [value])
  .refine((value) => new Set(value).size === value.length, "brand filters must be unique");

/** What a product is for, read from the owner's 1С top groups or the make its name calls: catalog-vehicle-kind.ts. */
export const CATALOG_VEHICLE_KINDS = ["passenger", "truck", "tractor"] as const;
export type CatalogVehicleKind = typeof CATALOG_VEHICLE_KINDS[number];
export const CATALOG_VEHICLE_KIND_LABELS: Readonly<Record<CatalogVehicleKind, string>> = {
  passenger: "Легковые",
  tractor: "Тракторы и спецтехника",
  truck: "Грузовые",
};

/** How many products a catalogue page may hold; the first is what a list opens with. */
export const CATALOG_PAGE_SIZES = [24, 48, 96] as const;
export const CATALOG_MAX_PAGE_SIZE = 96;

export const CatalogProductsQuerySchema = z.object({
  availability: z.enum(["all", "in_stock", "out_of_stock"]).default("all"),
  brand: CatalogBrandFilterSchema,
  category: CatalogPublicSlugSchema.optional(),
  limit: z.coerce.number().int().min(1).max(CATALOG_MAX_PAGE_SIZE).default(24),
  maxPriceKopeks: CatalogOptionalMoneyQuerySchema,
  minPriceKopeks: CatalogOptionalMoneyQuerySchema,
  offset: z.coerce.number().int().min(0).max(4_800).default(0),
  q: z.string().trim().min(2).max(120).regex(SAFE_SINGLE_LINE).optional(),
  // "popular": what customers order, keep in favourites and open most (app.product_popularity, migration 0052).
  sort: z.enum(["relevance", "popular", "newest", "name", "price_asc", "price_desc"])
    .default("relevance"),
  vehicleKind: z.enum(CATALOG_VEHICLE_KINDS).optional(),
}).strict().refine(
  (value) => value.minPriceKopeks === undefined
    || value.maxPriceKopeks === undefined
    || value.minPriceKopeks <= value.maxPriceKopeks,
  { message: "minimum price must not exceed maximum price", path: ["minPriceKopeks"] },
);
export type CatalogProductsQuery = z.infer<typeof CatalogProductsQuerySchema>;

export const CatalogVehicleKindsResponseSchema = z.object({
  items: z.array(z.object({
    kind: z.enum(CATALOG_VEHICLE_KINDS),
    productCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict()).max(CATALOG_VEHICLE_KINDS.length),
}).strict();
export type CatalogVehicleKindsResponse = z.infer<typeof CatalogVehicleKindsResponseSchema>;

export const CatalogFeaturedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(8),
}).strict();
export type CatalogFeaturedQuery = z.infer<typeof CatalogFeaturedQuerySchema>;

/**
 * The site map reads the public catalogue in parts of this many products, in a stable order: one file of a
 * search engine's site map holds at most 50 000 addresses, and the owner's catalogue is already 42 723.
 */
export const CATALOG_SITEMAP_PART_SIZE = 10_000;

export const CatalogSitemapQuerySchema = z.object({
  part: z.coerce.number().int().min(0).max(99).default(0),
}).strict();
export type CatalogSitemapQuery = z.infer<typeof CatalogSitemapQuerySchema>;

export const CatalogSitemapResponseSchema = z.object({
  items: z.array(z.object({ slug: CatalogPublicSlugSchema, updatedAt: z.iso.datetime() }).strict()).max(CATALOG_SITEMAP_PART_SIZE),
  partSize: z.number().int().positive(),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type CatalogSitemapResponse = z.infer<typeof CatalogSitemapResponseSchema>;

export const CatalogProductIdentifierSchema = z.union([z.uuid(), CatalogPublicSlugSchema]);
export type CatalogProductIdentifier = z.infer<typeof CatalogProductIdentifierSchema>;

export const CatalogImageIdentifierSchema = z.uuid();
export type CatalogImageIdentifier = z.infer<typeof CatalogImageIdentifierSchema>;

export const CatalogImageViewSchema = z.object({
  altText: z.string().min(1).max(500),
  byteSize: z.number().int().positive().max(10 * 1024 * 1024),
  id: z.uuid(),
  isPrimary: z.boolean(),
  mimeType: z.enum(["image/avif", "image/jpeg", "image/png", "image/webp"]),
  sortOrder: z.number().int(),
  url: z.string().regex(/^\/api\/v1\/catalog\/media\/[0-9a-f-]+$/u),
}).strict();
export type CatalogImageView = z.infer<typeof CatalogImageViewSchema>;

const CatalogEntityViewSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(500),
  slug: CatalogPublicSlugSchema,
}).strict();

export const CatalogBrandViewSchema = CatalogEntityViewSchema.extend({
  productCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type CatalogBrandView = z.infer<typeof CatalogBrandViewSchema>;

export const CatalogBrandsResponseSchema = z.object({
  items: z.array(CatalogBrandViewSchema).max(10_000),
}).strict();
export type CatalogBrandsResponse = z.infer<typeof CatalogBrandsResponseSchema>;

export const CatalogProductSummarySchema = z.object({
  availableQuantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  brand: CatalogEntityViewSchema.nullable(),
  category: CatalogEntityViewSchema.nullable(),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  // "cross" means this row was never itself named by the customer's search
  // text -- it surfaced because app.article_crosses links a *different*,
  // confirmed-equivalent article to it (see catalog-public.service.ts and
  // migration 0018). The storefront must render this exactly like a
  // supplier analogue badge (`RowBadge analog`, "Аналог") -- selling someone
  // a different article without saying so is how a shop gets a return.
  matchedVia: z.enum(["query", "cross"]).default("query"),
  name: z.string().min(1).max(500),
  priceKopeks: MoneySchema.nullable(),
  primaryImage: CatalogImageViewSchema.nullable(),
  sku: z.string().min(1).max(200),
  slug: CatalogPublicSlugSchema,
  updatedAt: z.iso.datetime(),
}).strict();
export type CatalogProductSummary = z.infer<typeof CatalogProductSummarySchema>;

export const CatalogProductsResponseSchema = z.object({
  items: z.array(CatalogProductSummarySchema).max(CATALOG_MAX_PAGE_SIZE),
  limit: z.number().int().min(1).max(CATALOG_MAX_PAGE_SIZE),
  // "any": nothing matched every word of the query, so the page shows items
  // matching at least one word — the storefront says so above the list.
  matchMode: z.enum(["all", "any"]).optional(),
  offset: z.number().int().nonnegative().max(4_800),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type CatalogProductsResponse = z.infer<typeof CatalogProductsResponseSchema>;

export const CatalogProductDetailSchema = CatalogProductSummarySchema.extend({
  attributes: z.record(z.string(), z.unknown()),
  description: z.string().max(100_000).nullable(),
  /** What the name says plainly of the part (side, voltage, size…), as the page names it: catalog-part-specs.ts. */
  features: z.array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(80) }).strict()).max(20).default([]),
  images: z.array(CatalogImageViewSchema).max(100),
  /** A vehicle maker's original numbers the name carries besides the article («Втулка TG-48815-60121» → 48815-60121). */
  originalNumbers: z.array(z.string().min(1).max(40)).max(12).default([]),
  /** The same product in other packs («1 л», «4 л», «20 л»), smallest first; this product's own pack is not listed. */
  packSizes: z.array(z.object({
    availableQuantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    label: z.string().min(1).max(40),
    name: z.string().min(1).max(500),
    priceKopeks: MoneySchema.nullable(),
    slug: CatalogPublicSlugSchema,
  }).strict()).max(12).default([]),
}).strict();
export type CatalogProductDetail = z.infer<typeof CatalogProductDetailSchema>;

/**
 * One level of the public category tree, nested with its visible children.
 * `productCount` is a roll-up (this category plus every descendant), not
 * just direct assignments, so a listing can say "Кузов (12)" even when most
 * of those products actually sit in a grandchild category.
 */
export interface CatalogCategoryNode {
  children: CatalogCategoryNode[];
  description: string | null;
  id: string;
  name: string;
  productCount: number;
  slug: string;
  sortOrder: number;
}

// z.lazy + an explicit interface: zod cannot infer a self-referencing object
// type, so the TS shape above is authoritative and the schema below only
// validates it at the API boundary.
export const CatalogCategoryNodeSchema: z.ZodType<CatalogCategoryNode> = z.lazy(() => z.object({
  children: z.array(CatalogCategoryNodeSchema).max(200),
  description: z.string().max(2000).nullable(),
  id: z.uuid(),
  name: z.string().min(1).max(500),
  productCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  slug: CatalogPublicSlugSchema,
  sortOrder: z.number().int(),
}).strict());

export const CatalogCategoryTreeResponseSchema = z.object({
  items: z.array(CatalogCategoryNodeSchema).max(200),
}).strict();
export type CatalogCategoryTreeResponse = z.infer<typeof CatalogCategoryTreeResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string().min(1),
  timestamp: z.iso.datetime(),
  checks: z.record(z.string(), z.enum(["up", "down"])).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const WorkerJobSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("system.heartbeat"),
    payload: z.object({ requestedAt: z.iso.datetime() }),
  }),
  // Persists article-cross pairs a supplier search turned up (see
  // SupplierSearchService.search and apps/worker/src/article-cross-ingest.ts).
  // Queued outside the customer's request/response cycle -- see the comment
  // on SupplierCrossQueueService for why this must never be awaited there.
  z.object({
    name: z.literal("supplier.crosses.ingest"),
    payload: z.object({
      pairs: z.array(SupplierCrossPairSchema).min(1).max(1_000),
      source: z.literal("rossko"),
    }),
  }),
]);
export type WorkerJob = z.infer<typeof WorkerJobSchema>;
export * from "./storefront-taxonomy.js";
export * from "./product-name.js";
