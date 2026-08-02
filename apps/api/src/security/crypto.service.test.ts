import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { CryptoService } from "./crypto.service.js";

function createService() {
  return new CryptoService(new ConfigService({
    DATA_ENCRYPTION_KEY: "test-data-encryption-key-with-more-than-32-characters",
    SESSION_SECRET: "test-session-hmac-secret-with-more-than-32-characters",
  }));
}

describe("CryptoService", () => {
  it("encrypts with purpose-bound authenticated encryption", () => {
    const service = createService();
    const encrypted = service.encrypt("sensitive-value", "totp:user-1");

    expect(encrypted.toString("utf8")).not.toContain("sensitive-value");
    expect(service.decrypt(encrypted, "totp:user-1")).toBe("sensitive-value");
    expect(() => service.decrypt(encrypted, "totp:user-2")).toThrow();
  });

  it("separates opaque token hashes by purpose", () => {
    const service = createService();
    const sessionHash = service.opaqueHash("session", "same-token");
    const csrfHash = service.opaqueHash("csrf", "same-token");

    expect(sessionHash.equals(csrfHash)).toBe(false);
    expect(service.opaqueHashMatches("session", "same-token", sessionHash)).toBe(true);
  });

  it("derives stable purpose-separated bearer tokens for idempotent guest flows", () => {
    const service = createService();
    const source = "checkout:guest\0request-id";
    const first = service.deriveOpaqueToken("guest-order-access", source);

    expect(first).toHaveLength(43);
    expect(service.deriveOpaqueToken("guest-order-access", source)).toBe(first);
    expect(service.deriveOpaqueToken("chat-guest-access", source)).not.toBe(first);
    expect(first).not.toContain("request-id");
  });
});
