import { describe, expect, it } from "vitest";

import {
  MoneySchema,
  OrderStatusSchema,
  PaymentStatusSchema,
  RoleSchema,
} from "./index.js";

describe("public contracts", () => {
  it("accepts only declared roles and states", () => {
    expect(RoleSchema.safeParse("manager").success).toBe(true);
    expect(RoleSchema.safeParse("super_admin").success).toBe(false);
    expect(OrderStatusSchema.safeParse("pending_payment").success).toBe(true);
    expect(PaymentStatusSchema.safeParse("partially_refunded").success).toBe(true);
  });

  it("stores money as non-negative integer kopeks", () => {
    expect(MoneySchema.parse(125_099)).toBe(125_099);
    expect(MoneySchema.safeParse(12.5).success).toBe(false);
    expect(MoneySchema.safeParse(-1).success).toBe(false);
  });
});
