import { describe, expect, it, vi } from "vitest";

import { fetchWithOneRetry } from "./api-fetch";

const answer = (status: number, headers: Record<string, string> = {}) => new Response("{}", { headers, status });

describe("a server-side read of the catalogue that the API could not answer at once", () => {
  it("asks once more after a short pause when the API restarts or a proxy drops the call", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(answer(503)).mockResolvedValueOnce(answer(200));
    const sleep = vi.fn(async () => undefined);
    expect((await fetchWithOneRetry("http://api/x", {}, { fetchImpl, sleep })).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it("asks once more after a dropped connection, then gives up", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchWithOneRetry("http://api/x", {}, { fetchImpl, sleep: async () => undefined })).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waits out a short Retry-After of too many requests, and only a short one", async () => {
    const sleep = vi.fn(async () => undefined);
    const shortWait = vi.fn<typeof fetch>().mockResolvedValueOnce(answer(429, { "Retry-After": "1" })).mockResolvedValueOnce(answer(200));
    expect((await fetchWithOneRetry("http://api/x", {}, { fetchImpl: shortWait, sleep })).status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(1000);

    const longWait = vi.fn<typeof fetch>().mockResolvedValue(answer(429, { "Retry-After": "40" }));
    expect((await fetchWithOneRetry("http://api/x", {}, { fetchImpl: longWait, sleep })).status).toBe(429);
    const noHint = vi.fn<typeof fetch>().mockResolvedValue(answer(429));
    expect((await fetchWithOneRetry("http://api/x", {}, { fetchImpl: noHint, sleep })).status).toBe(429);
    expect(longWait).toHaveBeenCalledTimes(1);
    expect(noHint).toHaveBeenCalledTimes(1);
  });

  it("does not repeat an answer that will not change: found, not found, a bad request", async () => {
    for (const status of [200, 400, 404]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer(status));
      expect((await fetchWithOneRetry("http://api/x", {}, { fetchImpl, sleep: async () => undefined })).status).toBe(status);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});
