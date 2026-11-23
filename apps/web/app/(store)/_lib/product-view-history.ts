import { apiRequest } from "./storefront-api";

type HistoryRequest = (path: string, options: { body: { productId: string }; method: "POST" }) => Promise<unknown>;

let lastRecorded: string | null = null;

/**
 * Adds the product a signed-in customer has opened to «Вы смотрели» in the profile. The page of a product never
 * sent this, so the list stayed empty for everyone. One request per opened product (an effect that runs twice
 * sends one); a failure is not shown: the history is a convenience, the product page works without it.
 */
export async function recordProductView(productId: string, request: HistoryRequest = apiRequest): Promise<void> {
  if (lastRecorded === productId) return;
  lastRecorded = productId;
  try {
    await request("/account/history", { method: "POST", body: { productId } });
  } catch {
    if (lastRecorded === productId) lastRecorded = null;
  }
}
