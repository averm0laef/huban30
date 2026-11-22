import { describe, expect, it } from "vitest";

import { CUSTOMER_AVATAR_KEYS, customerAvatarKey, customerAvatarSrc } from "./customer-avatars";

describe("customerAvatarKey", () => {
  it("is stable for the same seed", () => {
    expect(customerAvatarKey("acc-123")).toBe(customerAvatarKey("acc-123"));
  });
  it("keeps a valid chosen key and ignores junk", () => {
    expect(customerAvatarKey("acc-123", "customer-07")).toBe("customer-07");
    expect(CUSTOMER_AVATAR_KEYS).toContain(customerAvatarKey("acc-123", "../../etc"));
  });
  it("spreads different ids over the set", () => {
    const keys = new Set(Array.from({ length: 200 }, (_, index) => customerAvatarKey(`account-${index}`)));
    expect(keys.size).toBeGreaterThan(10);
  });
  it("points at the public folder", () => {
    expect(customerAvatarSrc("customer-01")).toBe("/avatars/customer-01.webp");
  });
});
