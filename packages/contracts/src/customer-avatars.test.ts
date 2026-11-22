import { describe, expect, it } from "vitest";

import { AccountAvatarUpdateSchema, chatNumberLabel, customerAvatarKey, parseChatNumber } from "./customer-avatars.js";

describe("customer avatars and chat numbers", () => {
  it("accepts only the 15 known avatar keys or null", () => {
    expect(AccountAvatarUpdateSchema.safeParse({ avatarKey: "customer-15" }).success).toBe(true);
    expect(AccountAvatarUpdateSchema.safeParse({ avatarKey: null }).success).toBe(true);
    expect(AccountAvatarUpdateSchema.safeParse({ avatarKey: "customer-16" }).success).toBe(false);
    expect(AccountAvatarUpdateSchema.safeParse({ avatarKey: "../x" }).success).toBe(false);
    expect(customerAvatarKey("guest-abc")).toBe(customerAvatarKey("guest-abc"));
  });
  it("formats and parses chat numbers", () => {
    expect(chatNumberLabel(123)).toBe("Ч-000123");
    expect(chatNumberLabel("1234567")).toBe("Ч-1234567");
    expect(chatNumberLabel(null)).toBeNull();
    for (const input of ["Ч-000123", "ч123", "#123", "123", " № 123 "]) expect(parseChatNumber(input)).toBe(123);
    expect(parseChatNumber("колодки")).toBeNull();
    expect(parseChatNumber("Ч-12a")).toBeNull();
  });
});
