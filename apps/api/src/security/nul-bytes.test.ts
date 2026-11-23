import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { containsNulCharacter, registerNulCharacterRejection } from "./nul-bytes.js";

describe("NUL character rejection", () => {
  it("finds a NUL in nested strings and keys and ignores raw buffers", () => {
    expect(containsNulCharacter({ name: "ab\u0000cd" })).toBe(true);
    expect(containsNulCharacter({ items: [{ note: ["ok", "\u0000"] }] })).toBe(true);
    expect(containsNulCharacter({ "key\u0000": 1 })).toBe(true);
    expect(containsNulCharacter({ name: "Иван", count: 2, flag: true, none: null })).toBe(false);
    expect(containsNulCharacter(Buffer.from([0, 1, 2]))).toBe(false);
    expect(containsNulCharacter(undefined)).toBe(false);
  });

  it("walks a deeply nested body without exhausting the stack", () => {
    let nested: unknown = "\u0000";
    for (let depth = 0; depth < 200_000; depth += 1) nested = [nested];
    expect(containsNulCharacter(nested)).toBe(true);
  });

  it("answers 400 before the handler for a NUL in the body, query or path", async () => {
    const app = Fastify();
    const handle = vi.fn(() => ({ ok: true }));
    registerNulCharacterRejection(app);
    app.post("/items/:id", handle);
    try {
      const body = await app.inject({ method: "POST", url: "/items/1", payload: { displayName: "ab\u0000cd" } });
      expect(body.statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/items/1?q=a%00b", payload: {} })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/items/a%00b", payload: {} })).statusCode).toBe(400);
      expect(handle).not.toHaveBeenCalled();

      expect((await app.inject({ method: "POST", url: "/items/1?q=ab", payload: { displayName: "Иван" } })).statusCode).toBe(200);
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
