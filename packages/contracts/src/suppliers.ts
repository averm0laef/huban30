import { z } from "zod";

// Self-contained on purpose: this file is additive to avoid touching
// index.ts beyond a single re-export line, so small primitives are
// duplicated here rather than imported back from "./index.js" (importing
// from the file that re-exports this one would create a same-package
// circular import).
const SAFE_SINGLE_LINE = /^[^\u0000-\u001F\u007F]+$/u;
const SingleLineSchema = z.string().trim().min(2).max(160).regex(SAFE_SINGLE_LINE, "Недопустимые символы");
const PhoneSchema = z.string().trim().regex(/^\+[1-9]\d{6,14}$/u, "Телефон укажите в международном формате");
const SortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

export const SUPPLIER_SOURCES = ["rossko"] as const;
export const SupplierSourceSchema = z.enum(SUPPLIER_SOURCES);
export type SupplierSource = z.infer<typeof SupplierSourceSchema>;

// Consent text version for the waiting-list flow — deliberately its own
// version, distinct from the storefront contact-form consent, because it
// covers a different processing purpose (ordering a specific supplier part).
export const SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION = "supplier-waitlist-consent-v1" as const;

// ---------------------------------------------------------------------------
// Supplier search. Structurally separate from the shop's own catalog types:
// 1C stock is real shelf inventory ("в наличии"); a supplier stock line is
// always "под заказ" with a delivery estimate. The two must never be
// represented by the same field or merged into one stock number.
// ---------------------------------------------------------------------------

export const SupplierSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120).regex(SAFE_SINGLE_LINE, "Недопустимые символы"),
}).strict();
export type SupplierSearchQuery = z.infer<typeof SupplierSearchQuerySchema>;

export const SupplierStockViewSchema = z.object({
  deliveryTime: z.string().trim().max(120).nullable(),
  id: z.string().trim().min(1).max(120),
  priceKopeks: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  quantity: z.number().int().nonnegative().max(1_000_000),
}).strict();
export type SupplierStockView = z.infer<typeof SupplierStockViewSchema>;

export interface SupplierPartView {
  // Fixed literal — never "в наличии" — so a client cannot render supplier
  // results as if they were 1C shelf stock.
  availability: "under_order";
  brand: string;
  crosses: SupplierPartView[];
  guid: string;
  name: string;
  partNumber: string;
  stocks: SupplierStockView[];
}

export const SupplierPartViewSchema: z.ZodType<SupplierPartView> = z.object({
  availability: z.literal("under_order"),
  brand: z.string().trim().max(200),
  crosses: z.array(z.lazy((): z.ZodType<SupplierPartView> => SupplierPartViewSchema)).max(50),
  guid: z.string().trim().min(1).max(200),
  name: z.string().trim().max(500),
  partNumber: z.string().trim().min(1).max(200),
  stocks: z.array(SupplierStockViewSchema).max(50),
}).strict();

export const SupplierSearchResponseSchema = z.object({
  message: z.string().max(2_000),
  parts: z.array(SupplierPartViewSchema).max(500),
  query: z.string().max(120),
  source: SupplierSourceSchema,
  success: z.boolean(),
}).strict();
export type SupplierSearchResponse = z.infer<typeof SupplierSearchResponseSchema>;

// ---------------------------------------------------------------------------
// Waiting list ("в ожидание"): a customer's request for a specific supplier
// part/stock line the storefront showed them. The server re-resolves the
// price and delivery time from its own trusted supplier lookup at creation
// time — the client only points at which part and stock it means, it never
// supplies the money value itself.
// ---------------------------------------------------------------------------

export const SUPPLIER_WAITLIST_STATUSES = ["new", "in_progress", "fulfilled", "cancelled"] as const;
export const SupplierWaitlistStatusSchema = z.enum(SUPPLIER_WAITLIST_STATUSES);
export type SupplierWaitlistStatus = z.infer<typeof SupplierWaitlistStatusSchema>;

export const SupplierWaitlistContactSchema = z.object({
  // Trim before the format check; see CheckoutContactSchema in index.ts for
  // why the order matters in Zod 4.
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()).nullable().optional(),
  name: SingleLineSchema,
  phone: PhoneSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (!value.email && !value.phone) {
    context.addIssue({ code: "custom", message: "Укажите email или телефон", path: ["email"] });
  }
});
export type SupplierWaitlistContact = z.infer<typeof SupplierWaitlistContactSchema>;

export const SupplierWaitlistCreateSchema = z.object({
  consent: z.literal(true, { error: "Требуется согласие на обработку данных" }),
  contact: SupplierWaitlistContactSchema,
  idempotencyKey: z.uuid(),
  // The part/stock the customer picked from a prior /suppliers/search
  // response. The server re-runs that search (cache-first) and snapshots the
  // authoritative price and delivery time — these identifiers are opaque
  // lookup keys, not trusted data by themselves.
  partGuid: z.string().trim().min(1).max(200),
  policyVersion: z.literal(SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION),
  quantity: z.number().int().min(1).max(100),
  query: z.string().trim().min(2).max(120),
  source: SupplierSourceSchema.default("rossko"),
  stockId: z.string().trim().min(1).max(120),
}).strict();
export type SupplierWaitlistCreate = z.infer<typeof SupplierWaitlistCreateSchema>;

export const SupplierWaitlistCreatedSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  message: z.string().min(1),
  replayed: z.boolean(),
  status: SupplierWaitlistStatusSchema,
}).strict();
export type SupplierWaitlistCreated = z.infer<typeof SupplierWaitlistCreatedSchema>;

const StaffSupplierWaitlistSearchSchema = z.string().trim().min(2).max(120).regex(SAFE_SINGLE_LINE).optional();

export const StaffSupplierWaitlistQuerySchema = z.object({
  assigned: z.enum(["any", "mine", "unassigned"]).default("any"),
  direction: SortDirectionSchema,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(4_800).default(0),
  q: StaffSupplierWaitlistSearchSchema,
  sort: z.enum(["createdAt", "status"]).default("createdAt"),
  status: SupplierWaitlistStatusSchema.optional(),
}).strict();
export type StaffSupplierWaitlistQuery = z.infer<typeof StaffSupplierWaitlistQuerySchema>;

export const StaffSupplierWaitlistUpdateSchema = z.object({
  assignedStaffId: z.uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(500).regex(SAFE_SINGLE_LINE),
  status: SupplierWaitlistStatusSchema.optional(),
  version: z.number().int().positive(),
}).strict().refine(
  (value) => value.assignedStaffId !== undefined || value.status !== undefined,
  { message: "assignment or status is required" },
);
export type StaffSupplierWaitlistUpdate = z.infer<typeof StaffSupplierWaitlistUpdateSchema>;
