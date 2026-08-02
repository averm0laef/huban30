import { describe, expect, it } from "vitest";

import { clearIdempotencyKey, payloadHash, stableIdempotencyKey } from "./idempotency";

const firstUuid = "550e8400-e29b-41d4-a716-446655440000";
const secondUuid = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("stableIdempotencyKey", () => {
  it("keeps the same key across a retry with equivalent data", async () => {
    const storage = memoryStorage();
    const payload = { contact: { name: "Антон", phone: "+79240000000" }, items: [{ quantity: 2, productId: firstUuid }] };
    await expect(stableIdempotencyKey(storage, "checkout", payload, { createUuid: () => firstUuid, now: () => 1_000 })).resolves.toBe(firstUuid);
    await expect(stableIdempotencyKey(storage, "checkout", { items: payload.items, contact: payload.contact }, { createUuid: () => secondUuid, now: () => 1_001 })).resolves.toBe(firstUuid);
  });

  it("stores only a SHA-256 hash and never raw PII", async () => {
    const storage = memoryStorage();
    await stableIdempotencyKey(storage, "contact", {
      email: "secret@example.test",
      message: "Секретное сообщение клиента",
      phone: "+79240000000",
    }, { createUuid: () => firstUuid, now: () => 1_000 });
    const stored = storage.values.get("an30_idempotency:contact") ?? "";
    expect(stored).not.toContain("secret@example.test");
    expect(stored).not.toContain("Секретное сообщение клиента");
    expect(JSON.parse(stored)).toMatchObject({ expiresAt: 86_401_000, key: firstUuid });
    expect(JSON.parse(stored).hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rotates the key when data changes, expires, or success clears it", async () => {
    const storage = memoryStorage();
    await stableIdempotencyKey(storage, "contact", { message: "Первый запрос" }, { createUuid: () => firstUuid, now: () => 1_000, ttlMs: 100 });
    await expect(stableIdempotencyKey(storage, "contact", { message: "Другой запрос" }, { createUuid: () => secondUuid, now: () => 1_001 })).resolves.toBe(secondUuid);
    await expect(stableIdempotencyKey(storage, "contact", { message: "Другой запрос" }, { createUuid: () => firstUuid, now: () => 86_402_000 })).resolves.toBe(firstUuid);
    clearIdempotencyKey(storage, "contact");
    await expect(stableIdempotencyKey(storage, "contact", { message: "Другой запрос" }, { createUuid: () => secondUuid, now: () => 86_402_001 })).resolves.toBe(secondUuid);
  });

  it("canonicalizes object keys but preserves array order", async () => {
    await expect(payloadHash({ b: 2, a: 1 })).resolves.toBe(await payloadHash({ a: 1, b: 2 }));
    await expect(payloadHash([1, 2])).resolves.not.toBe(await payloadHash([2, 1]));
  });
});
