/** Outbound JSON over HTTPS for FAPI, VINROKU, vPIC and API Ninjas. */

// VINROKU answers 403 to library default agents; a neutral service name works.
export const USER_AGENT = "AN30-parts-finder/1.0";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface JsonResponse {
  data: unknown;
  headers: Record<string, string>;
}

export interface JsonRequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type RequestJson = (url: string, options?: JsonRequestOptions) => Promise<JsonResponse>;

/** The provider answered with a non-2xx status. */
export class UpstreamStatusError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Record<string, string>,
  ) {
    super(`upstream answered ${status}`);
    this.name = "UpstreamStatusError";
  }
}

/** Network failure, timeout, redirect, oversize or non-JSON body. */
export class UpstreamUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`upstream unavailable: ${reason}`);
    this.name = "UpstreamUnavailableError";
  }
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => { record[key.toLowerCase()] = value; });
  return record;
}

/** JSON.parse without NaN/Infinity tricks (JSON has none) and with a size cap. */
export const requestJson: RequestJson = async (url, options = {}) => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT, ...options.headers },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch (error) {
    throw new UpstreamUnavailableError(error instanceof Error ? error.name : "network");
  }
  const headers = headerRecord(response.headers);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamStatusError(response.status, headers);
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new UpstreamUnavailableError("response_too_large");
        }
        chunks.push(chunk.value);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    // An empty 200 is its own reason: UMAPI's getCrossInfo answers so for a number it does not know (24.11.2026).
    if (!text.trim()) throw new UpstreamUnavailableError("empty_body");
    return { data: JSON.parse(text) as unknown, headers };
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) throw error;
    throw new UpstreamUnavailableError("invalid_body");
  }
};
