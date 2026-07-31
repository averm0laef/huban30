import { describe, expect, it } from "vitest";

import { TotpService } from "./totp.service.js";

describe("TotpService", () => {
  it("matches the RFC 6238 SHA-1 vector truncated to six digits", () => {
    const service = new TotpService();
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    expect(service.generateCode(secret, 59_000)).toBe("287082");
    expect(service.verify(secret, "287082", 59_000)).toBe(1);
    expect(service.verify(secret, "287083", 59_000)).toBeNull();
  });

  it("creates unique recovery codes in the accepted format", () => {
    const codes = new TotpService().generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){2}$/u.test(code))).toBe(true);
  });
});
