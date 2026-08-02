interface StorageLike {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

interface StoredIdempotency {
  expiresAt: number;
  hash: string;
  key: string;
}

interface IdempotencyOptions {
  createUuid?: () => string;
  now?: () => number;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function payloadHash(payload: unknown): Promise<string> {
  const canonical = JSON.stringify(stableValue(payload));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return toHex(digest);
}

export async function stableIdempotencyKey(
  storage: StorageLike,
  namespace: string,
  payload: unknown,
  options: IdempotencyOptions = {},
): Promise<string> {
  const storageKey = `an30_idempotency:${namespace}`;
  const hash = await payloadHash(payload);
  const now = (options.now ?? Date.now)();
  const existingRaw = storage.getItem(storageKey);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as Partial<StoredIdempotency>;
      if (existing.hash === hash && typeof existing.key === "string"
        && UUID_PATTERN.test(existing.key) && typeof existing.expiresAt === "number"
        && Number.isSafeInteger(existing.expiresAt) && existing.expiresAt > now) return existing.key;
    } catch {
      storage.removeItem(storageKey);
    }
  }
  const key = (options.createUuid ?? (() => crypto.randomUUID()))();
  if (!UUID_PATTERN.test(key)) throw new Error("Генератор вернул некорректный UUID");
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("Некорректный TTL идемпотентности");
  const value = { expiresAt: now + ttlMs, hash, key } satisfies StoredIdempotency;
  if (!SHA256_PATTERN.test(value.hash)) throw new Error("Некорректный SHA-256 отпечаток");
  storage.setItem(storageKey, JSON.stringify(value));
  return key;
}

export function clearIdempotencyKey(storage: StorageLike, namespace: string): void {
  storage.removeItem(`an30_idempotency:${namespace}`);
}
