/**
 * Keeps the answer of `load` for `ttlMs` and hands it to every caller in that time; callers that ask while it is
 * still loading share the one load. A failure is not kept: the next caller asks again.
 *
 * For data that is the same for every visitor and changes rarely (the category tree). The value is shared between
 * requests, so callers must not change it.
 */
export function timedMemo<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let kept: { expiresAt: number; value: Promise<T> } | null = null;
  return () => {
    if (kept && kept.expiresAt > now()) return kept.value;
    const value = load();
    const entry = { expiresAt: now() + ttlMs, value };
    kept = entry;
    value.catch(() => {
      if (kept === entry) kept = null;
    });
    return value;
  };
}
