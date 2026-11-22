import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import { MemoryLedger, MemoryShares } from "./engine/fapi-memory-doubles.js";
import type { JsonResponse, RequestJson } from "./engine/http.js";
import type { RedisFapiVisitorShares } from "./fapi-visitor-shares.js";
import { PartsFinderEngine } from "./parts-finder.engine.js";

// One address could spend the site's whole day of FAPI credits in a couple of minutes: every paid call was
// counted against the site only. The engine now has to be told who pays for each paid call.
function engine(settings: Record<string, unknown>, ...answers: unknown[]) {
  const http = vi.fn<RequestJson>(async () => ({ data: answers.shift(), headers: {} }) as JsonResponse);
  const shares = new MemoryShares();
  const config = { get: (name: string) => ({ FAPI_KEY: "fake-fapi", ...settings })[name] } as unknown as ConfigService;
  return { engine: new PartsFinderEngine(config, new MemoryLedger() as never, {} as never, {} as never, shares as unknown as RedisFapiVisitorShares, http), http, shares };
}
const usage = { account: { st: "allowed", pl: "standard", inc: 30_000, rem: 29_000, u: 1_000 } };
const card = (article: string) => ({ candidates: [{ mfi: 7, ds: "Brand", n: article }] });
const VISITOR = "203.0.113.9";

describe("who pays for a paid lookup", () => {
  it("holds a visitor to the visitor's share of the day", async () => {
    const { engine: finder, http, shares } = engine({ FAPI_VISITOR_DAILY_CREDIT_LIMIT: 2 }, usage, card("A1"), card("A2"));
    await finder.crosses({ article: "A1" }, VISITOR);
    await finder.crosses({ article: "A2" }, VISITOR);
    await expect(finder.crosses({ article: "A3" }, VISITOR)).rejects.toMatchObject({ code: "fapi_visitor_limit", status: 429 });
    // The account, then two cards: the third request never reached FAPI.
    expect(http).toHaveBeenCalledTimes(3);
    expect(shares.of(VISITOR)).toBe(2);
  });

  it("does not hold the shop's own work (staff, background runs) to a visitor's share", async () => {
    const { engine: finder, shares } = engine({ FAPI_VISITOR_DAILY_CREDIT_LIMIT: 1 }, usage, card("S1"), card("S2"), card("S3"));
    await finder.crosses({ article: "S1" }, null);
    await finder.crosses({ article: "S2" }, null);
    await finder.fapiFor(null).fetch("/part", { n: "S3", limit: 100 }, 1);
    expect(shares.used.size).toBe(0);
  });

  it("gives a visitor 100 credits a day unless the settings say otherwise", () => {
    expect(engine({}).engine.visitorDailyLimit).toBe(100);
    expect(engine({ FAPI_VISITOR_DAILY_CREDIT_LIMIT: 40 }).engine.visitorDailyLimit).toBe(40);
  });

  it("counts a list fetched for a visitor against that visitor", async () => {
    const { engine: finder, shares } = engine({ FAPI_VISITOR_DAILY_CREDIT_LIMIT: 100 }, usage, { m: [{ dbi: 1, d: "Corolla" }] });
    await finder.fapiFor(VISITOR).fetch("/catalogList/dt/modelList", { mfi: 5 }, 8);
    expect(shares.of(VISITOR)).toBe(8);
  });
});
