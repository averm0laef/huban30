import { describe, expect, it } from "vitest";

import { isSessionLoss } from "./api";

describe("lost staff session", () => {
  it("is a 401 on a working request", () => {
    expect(isSessionLoss("/staff/orders?limit=20", 401)).toBe(true);
    expect(isSessionLoss("/staff/summary", 401)).toBe(true);
  });

  it("is not a wrong password or code on the sign-in requests", () => {
    expect(isSessionLoss("/auth/login", 401)).toBe(false);
    expect(isSessionLoss("/auth/totp/verify", 401)).toBe(false);
    expect(isSessionLoss("/auth/session", 401)).toBe(false);
  });

  it("is not a refusal for the role or any other failure", () => {
    expect(isSessionLoss("/staff/audit", 403)).toBe(false);
    expect(isSessionLoss("/staff/orders", 500)).toBe(false);
  });
});
