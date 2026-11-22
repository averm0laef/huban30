/** Answers the API may give for a moment only: restarting during a deploy, or a proxy in between dropping the call. */
const PASSING = new Set([502, 503, 504]);
const RETRY_AFTER_FAILURE_MS = 400;
/** «Too many requests» is waited out only when the API says it is a matter of a second or two. */
const LONGEST_WAIT_MS = 2_000;

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 && seconds * 1000 <= LONGEST_WAIT_MS ? seconds * 1000 : null;
}

const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * One server-side read of the API, asked once more after a short pause when the answer was a passing failure.
 * Anything else, including «too many requests» without a short Retry-After, goes back to the caller as it is.
 */
export async function fetchWithOneRetry(
  url: string,
  init: RequestInit,
  { fetchImpl = fetch, sleep = pause }: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  let first: Response;
  try {
    first = await fetchImpl(url, init);
  } catch {
    await sleep(RETRY_AFTER_FAILURE_MS);
    return fetchImpl(url, init);
  }
  const wait = PASSING.has(first.status) ? RETRY_AFTER_FAILURE_MS : first.status === 429 ? retryAfterMs(first) : null;
  if (wait === null) return first;
  await first.body?.cancel();
  await sleep(wait);
  return fetchImpl(url, init);
}
