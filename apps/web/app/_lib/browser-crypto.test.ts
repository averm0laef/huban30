import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { randomUuid, sha256Hex, sha256HexSync } from "./browser-crypto";

describe("sha256HexSync", () => {
  it("matches node's SHA-256 on empty, short, block-edge and long input", () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "Тест ё 🚗".repeat(40)]) {
      const bytes = new TextEncoder().encode(text);
      expect(sha256HexSync(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });
  it("agrees with the async version", async () => {
    expect(await sha256Hex("payload")).toBe(createHash("sha256").update("payload").digest("hex"));
  });
});

describe("randomUuid", () => {
  it("returns a v4 UUID", () => {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});
