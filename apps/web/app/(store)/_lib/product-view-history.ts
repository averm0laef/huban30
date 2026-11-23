import { apiRequest } from "./storefront-api";

type HistoryRequest = (path: string, options: { body: { productId: string }; method: "POST" }) => Promise<unknown>;

/** One page opening asks more than once (React runs the effect twice in development); a later visit is a new view. */
const SAME_OPENING_MS = 3_000;

let last: { at: number; productId: string } | null = null;

export async function recordProductView(productId: string, request: HistoryRequest = apiRequest): Promise<void> {
  const now = Date.now();
  if (last && last.productId === productId && now - last.at < SAME_OPENING_MS) return;
  const mine = { at: now, productId };
  last = mine;
  try {
    await request("/account/history", { method: "POST", body: { productId } });
  } catch {
    // «Вы смотрели» is a convenience: the product page stays as it is, and the next opening tries again.
    if (last === mine) last = null;
  }
}
