import { z } from "zod";

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
    "account:read:self",
    "account:update:self",
    "orders:read:any",
    "orders:update:any",
    "chat:manage:any",
    "catalog:read",
    "catalog:write",
    "catalog:import",
  ],
  director: [
    "account:read:self",
    "account:update:self",
    "orders:read:any",
    "orders:update:any",
    "chat:manage:any",
    "catalog:read",
    "catalog:write",
    "catalog:import",
    "reports:read",
    "staff:read",
  ],
  admin: PERMISSIONS,
} as const satisfies Record<Role, readonly Permission[]>;

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "processing",
  "awaiting_delivery_terms",
  "ready",
  "completed",
  "cancelled",
  "refunded",
] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const PAYMENT_STATUSES = [
  "pending",
  "authorized",
  "succeeded",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const MoneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type Money = z.infer<typeof MoneySchema>;

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

const SAFE_SINGLE_LINE = /^[^\u0000-\u001F\u007F]+$/u;
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
]);
export type WorkerJob = z.infer<typeof WorkerJobSchema>;
