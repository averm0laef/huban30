import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  parseBasicAuthorization,
  rowIdentity,
  safeTextEqual,
  sha256,
} from "./catalog-import.utils.js";

describe("catalog import utilities", () => {
  it("hashes semantically equal objects identically", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(sha256({ b: 2, a: 1 })).toEqual(sha256({ a: 1, b: 2 }));
  });

  it("builds stable composite identities", () => {
    expect(rowIdentity({
      currency: "RUB",
      entityType: "price",
      productExternalId: "p-1",
      amountKopeks: 100,
      version: 1,
    })).toBe("price:p-1:RUB");
  });

  it("parses Basic auth without truncating colons in a password", () => {
    const value = Buffer.from("one-c:strong:password", "utf8").toString("base64");
    expect(parseBasicAuthorization(`Basic ${value}`)).toEqual({
      password: "strong:password",
      username: "one-c",
    });
    expect(parseBasicAuthorization("Bearer token")).toBeNull();
    expect(safeTextEqual("same", "same")).toBe(true);
    expect(safeTextEqual("same", "different")).toBe(false);
  });
});
