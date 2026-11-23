import { describe, expect, it } from "vitest";

import { UpstreamStatusError, UpstreamUnavailableError, type RequestJson } from "../parts-finder/engine/http.js";
import { UmapiError, UmapiGateway } from "./umapi.gateway.js";

const settings: Record<string, unknown> = { UMAPI_API_KEY: "test", UMAPI_ENABLED: true, UMAPI_VISITOR_DAILY_LIMIT: 0 };

function gateway(http: RequestJson) {
  const config = { get: (name: string) => settings[name] };
  const cache = { get: async () => undefined, set: async () => undefined, ttlSeconds: 86_400 };
  const budget = { note: () => undefined, take: async () => null };
  return new UmapiGateway(config as never, cache as never, budget as never, {} as never, {} as never, http);
}

const caller = { ip: "203.0.113.7" };

describe("UmapiGateway: «no such number» is an answer, not an outage", () => {
  it("takes getCrossInfo's empty 200 and a 404 as «not found»", async () => {
    const empty = gateway(async () => { throw new UpstreamUnavailableError("empty_body"); });
    expect(await empty.get("/v2/cross/parts/Analogs/getCrossInfo", { article: "28187E", brand: "X" }, caller, (value) => value, { whenNotFound: null })).toBeNull();
    const missing = gateway(async () => { throw new UpstreamStatusError(404, {}); });
    expect(await missing.get("/BrandRefinement/ZZZ", {}, caller, (value) => value, { whenNotFound: [] })).toEqual([]);
  });

  it("still calls a broken body or a network failure an outage", async () => {
    const broken = gateway(async () => { throw new UpstreamUnavailableError("invalid_body"); });
    await expect(broken.get("/BrandRefinement/ZZZ", {}, caller, (value) => value, { whenNotFound: [] })).rejects.toMatchObject({ failure: "unavailable" });
    const empty = gateway(async () => { throw new UpstreamUnavailableError("empty_body"); });
    await expect(empty.get("/Article/1", {}, caller, (value) => value)).rejects.toBeInstanceOf(UmapiError);
  });
});
