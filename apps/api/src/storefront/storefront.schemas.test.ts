import { describe, expect, it } from "vitest";

import { CONTACT_CONSENT_POLICY_VERSION } from "@an30/contracts";

import {
  AccountUpdateSchema,
  AddressCreateSchema,
  AddressUpdateSchema,
  ContactRequestSchema,
  PasswordChangeSchema,
} from "./storefront.schemas.js";

describe("storefront input schemas", () => {
  it("requires an explicit consent and a callback channel", () => {
    const base = {
      idempotencyKey: "019bf9ea-0d3e-7def-8c9a-000000000002",
      message: "Нужна помощь с подбором детали",
      name: "Антон Ермолаев",
      policyVersion: CONTACT_CONSENT_POLICY_VERSION,
      source: "expert_help",
    };
    expect(ContactRequestSchema.safeParse({ ...base, consent: false, phone: "+79990000000" }).success)
      .toBe(false);
    expect(ContactRequestSchema.safeParse({ ...base, consent: true }).success).toBe(false);
    expect(ContactRequestSchema.safeParse({ ...base, consent: true, email: "USER@EXAMPLE.COM" }).data)
      .toMatchObject({ email: "user@example.com" });
  });

  it("rejects unknown account fields and empty updates", () => {
    expect(AccountUpdateSchema.safeParse({}).success).toBe(false);
    expect(AccountUpdateSchema.safeParse({ role: "admin" }).success).toBe(false);
    expect(AccountUpdateSchema.safeParse({ displayName: "Новый клиент" }).success).toBe(true);
    for (const displayName of ["Иван\nПетров", "Иван\u202Eворт", "Иван\u2066Петров", "Иван\u0085Петров"]) {
      expect(AccountUpdateSchema.safeParse({ displayName }).success).toBe(false);
    }
  });

  it("bounds current and new passwords", () => {
    expect(PasswordChangeSchema.safeParse({ currentPassword: "", newPassword: "long-password-value" }).success)
      .toBe(false);
    expect(PasswordChangeSchema.safeParse({ currentPassword: "old", newPassword: "short" }).success)
      .toBe(false);
  });

  it("accepts only structured delivery addresses with an international phone", () => {
    const address = {
      city: "Чита",
      house: "30",
      isDefault: true,
      label: "Дом",
      phone: "+79141234567",
      recipientName: "Антон Ермолаев",
      region: "Забайкальский край",
      street: "Ленина",
    };
    expect(AddressCreateSchema.safeParse(address).success).toBe(true);
    expect(AddressCreateSchema.safeParse({ ...address, phone: "89141234567" }).success).toBe(false);
    expect(AddressCreateSchema.safeParse({ ...address, postalCode: "123" }).success).toBe(false);
    expect(AddressUpdateSchema.parse({ label: "Склад" })).toEqual({ label: "Склад" });
  });
});
