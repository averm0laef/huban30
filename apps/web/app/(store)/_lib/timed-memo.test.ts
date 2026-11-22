import { describe, expect, it, vi } from "vitest";

import { timedMemo } from "./timed-memo";

describe("a value the storefront keeps for a while instead of asking again", () => {
  // The category tree is the same for every visitor and changes only on a 1С exchange, yet every link to a section
  // that Next.js prefetched cost one request for it: the home page, the catalogue menu and /catalog together made
  // 63 in a minute against the API's limit of 60 per visitor.
  it("loads once and answers from memory until the time is up", async () => {
    let now = 1_000;
    const load = vi.fn(async () => "tree");
    const read = timedMemo(load, 30_000, () => now);

    expect(await read()).toBe("tree");
    now += 29_999;
    expect(await read()).toBe("tree");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads again once the time is up", async () => {
    let now = 1_000;
    const load = vi.fn().mockResolvedValueOnce("before the exchange").mockResolvedValueOnce("after the exchange");
    const read = timedMemo(load, 30_000, () => now);

    expect(await read()).toBe("before the exchange");
    now += 30_000;
    expect(await read()).toBe("after the exchange");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between callers that ask at the same moment", async () => {
    let release: (value: string) => void = () => undefined;
    const load = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const read = timedMemo(load, 30_000, () => 0);

    const first = read();
    const second = read();
    release("tree");

    expect(await first).toBe("tree");
    expect(await second).toBe("tree");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure: the next caller asks again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce("tree");
    const read = timedMemo(load, 30_000, () => 0);

    await expect(read()).rejects.toThrow("429");
    expect(await read()).toBe("tree");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
