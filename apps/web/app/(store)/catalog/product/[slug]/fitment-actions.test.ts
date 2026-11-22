import { describe, expect, it } from "vitest";

import { FinderError } from "../../../_lib/parts-finder";
import { fitmentButtons, fitmentFailure, fitmentQuery, keepFitment, keptFitment } from "./fitment-actions";

const answer = { article: { brand: "MANN-FILTER", name: "Масляный фильтр", number: "W 68/3" }, makes: [], oems: [], status: "ok" as const, total: 0, verdict: "fits" as const };

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    clear: () => items.clear(), getItem: (key) => items.get(key) ?? null, key: () => null, get length() { return items.size; },
    removeItem: (key) => { items.delete(key); }, setItem: (key, value) => { items.set(key, value); },
  };
}

describe("the applicability buttons of a product page", () => {
  it("offers the check for the customer's car first, and the list of cars; without a car — the list and the car picker", () => {
    expect(fitmentButtons({ msId: 2 })).toEqual(["check", "list"]);
    expect(fitmentButtons(null)).toEqual(["list", "pick"]);
    // A car picked from the shop's own list has no catalogue ids: only the list.
    expect(fitmentButtons({})).toEqual(["list", "pick"]);
  });

  it("asks the API for exactly what the button means", () => {
    expect(fitmentQuery("check", { genId: 9001, msId: 2 })).toEqual({ gen: 9001, mode: "check", ms: 2 });
    expect(fitmentQuery("check", { msId: 2 })).toEqual({ mode: "check", ms: 2 });
    expect(fitmentQuery("list", { genId: 9001, msId: 2 })).toEqual({ mode: "list", ms: 2 });
    expect(fitmentQuery("list", null)).toEqual({ mode: "list" });
  });

  it("keeps an answer for the rest of the visit, per product, button and car", () => {
    const storage = memoryStorage();
    keepFitment(storage, "p1", "check", { genId: 9001, msId: 2 }, answer);
    expect(keptFitment(storage, "p1", "check", { genId: 9001, msId: 2 })).toEqual(answer);
    expect(keptFitment(storage, "p1", "check", { genId: 9002, msId: 2 })).toBeNull();
    expect(keptFitment(storage, "p1", "list", null)).toBeNull();
    storage.setItem("an30:fitment:p1:list:-:-", "{not json");
    expect(keptFitment(storage, "p1", "list", null)).toBeNull();
  });

  it("works without the browser's storage at all", () => {
    const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } } as unknown as Storage;
    expect(() => keepFitment(broken, "p1", "list", null, answer)).not.toThrow();
    expect(keptFitment(broken, "p1", "list", null)).toBeNull();
    expect(keptFitment(null, "p1", "list", null)).toBeNull();
  });

  it("sends the customer to a specialist when the day's checks are over, and says «unavailable» otherwise", () => {
    expect(fitmentFailure(new FinderError("…", "tecdoc_limited", 429))).toBe("expert");
    expect(fitmentFailure(new FinderError("Слишком много попыток", null, 429))).toBe("expert");
    expect(fitmentFailure(new FinderError("…", "tecdoc_unavailable", 503))).toBe("unavailable");
    expect(fitmentFailure(new Error("boom"))).toBe("unavailable");
  });
});
