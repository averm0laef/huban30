import { z } from "zod";

export const ROLES = ["customer", "manager", "director", "admin"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

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
