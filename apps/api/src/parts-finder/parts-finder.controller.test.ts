import { HttpException, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { PERMISSIONS_KEY, PUBLIC_ROUTE_KEY } from "../auth/auth.decorators.js";
import { validateEnvironment } from "../config.js";
import type { RateLimitService } from "../security/rate-limit.service.js";
import { PartsFinderBodyLimitMiddleware } from "./parts-finder-body-limit.middleware.js";
import { PARTS_FINDER_RATE_LIMITS, PartsFinderController, StaffPartsFinderController } from "./parts-finder.controller.js";
import type { PartsFinderService } from "./parts-finder.service.js";

function setup(rejectScope?: string) {
  const calls: string[] = [];
  const consume = vi.fn(async (scope: string, _identity: string, _limit: number, _window: number) => {
    calls.push(`limit:${scope}`);
    if (scope === rejectScope) throw new HttpException("Слишком много попыток. Повторите позже.", HttpStatus.TOO_MANY_REQUESTS);
  });
  const handler = (name: string) => vi.fn(async () => { calls.push(`service:${name}`); return { ok: name }; });
  const finder = {
    crosses: handler("crosses"),
    makes: handler("makes"),
    models: handler("models"),
    modifications: handler("modifications"),
    resolve: handler("resolve"),
    search: handler("search"),
    suggest: handler("suggest"),
    shopAnalogs: handler("shopAnalogs"),
    status: vi.fn(() => ({ enabled: true })),
    usage: handler("usage"),
    vehicle: handler("vehicle"),
  };
  const controller = new PartsFinderController({ consume } as unknown as RateLimitService, finder as unknown as PartsFinderService);
  return { calls, consume, controller, finder };
}

const request = { ip: "203.0.113.7" } as FastifyRequest;

describe("PartsFinderController rate limits", () => {
  it.each([
    ["search", "parts-finder-search", 30, 60],
    ["vehicle", "parts-finder-vehicle", 20, 60],
    ["crosses", "parts-finder-crosses", 6, 600],
    ["shopAnalogs", "parts-finder-shop-analogs", 30, 60],
    ["resolve", "parts-finder-resolve", 30, 60],
  ] as const)("%s consumes %s (%i per %i s) per IP before calling the service", async (route, scope, limit, window) => {
    const { calls, consume, controller, finder } = setup();
    const body = { query: "x" };
    await expect(controller[route](body, request)).resolves.toEqual({ ok: route });
    expect(consume).toHaveBeenCalledWith(scope, "203.0.113.7", limit, window);
    // Every route that can reach a paid catalogue says whose request it is: the paid call is then counted
    // against that visitor's share of the day (and TecDoc answers only a visitor's own request). Decoding a VIN
    // and looking in the shop's own catalogue cost nothing and name nobody.
    const paid = route === "resolve" || route === "search" || route === "crosses";
    expect(finder[route]).toHaveBeenCalledWith(body, ...(paid ? [{ ip: "203.0.113.7" }] : []));
    expect(calls).toEqual([`limit:${scope}`, `service:${route}`]);
  });

  it.each([
    ["models", "parts-finder-picker", 60, 60],
    ["modifications", "parts-finder-picker", 60, 60],
    ["suggest", "parts-finder-suggest", 120, 60],
  ] as const)("picker route %s consumes %s (%i per %i s)", async (route, scope, limit, window) => {
    const { consume, controller, finder } = setup();
    await controller[route]({ q: "x" }, request);
    expect(consume).toHaveBeenCalledWith(scope, "203.0.113.7", limit, window);
    // The picker reads our own UMAPI vehicle catalog: nobody pays for it, so the visitor is not passed on.
    expect(finder[route]).toHaveBeenCalledWith({ q: "x" });
  });

  it("makes are throttled with the picker limit", async () => {
    const { consume, controller } = setup();
    await controller.makes(request);
    expect(consume).toHaveBeenCalledWith("parts-finder-picker", "203.0.113.7", 60, 60);
  });

  it("stops at the limiter: a throttled crosses request never reaches FAPI", async () => {
    const { controller, finder } = setup("parts-finder-crosses");
    await expect(controller.crosses({ article: "W 75/3" }, request)).rejects.toMatchObject({ status: 429 });
    expect(finder.crosses).not.toHaveBeenCalled();
  });

  it("documents the limits in one place", () => {
    expect(PARTS_FINDER_RATE_LIMITS.crosses).toEqual({ limit: 6, scope: "parts-finder-crosses", windowSeconds: 600 });
  });

  it("status is not throttled", () => {
    const { consume, controller } = setup();
    expect(controller.status()).toEqual({ enabled: true });
    expect(consume).not.toHaveBeenCalled();
  });

  it("public routes are public; FAPI usage needs a staff catalog permission customers do not hold", () => {
    const reflector = new Reflector();
    expect(reflector.get(PUBLIC_ROUTE_KEY, PartsFinderController)).toBe(true);
    expect(reflector.get(PUBLIC_ROUTE_KEY, StaffPartsFinderController)).toBeUndefined();
    expect(reflector.get(PERMISSIONS_KEY, StaffPartsFinderController.prototype.usage)).toEqual(["catalog:write"]);
  });

  it("every staff route needs the catalog permission: credits, vehicle catalog, linking, cross review", () => {
    const reflector = new Reflector();
    const routes = Object.getOwnPropertyNames(StaffPartsFinderController.prototype).filter((name) => name !== "constructor");
    expect(routes).toEqual(expect.arrayContaining(["usage", "overview", "vehicleCatalog", "assortmentStatus", "linkAssortment", "crossReview", "decideCross"]));
    for (const name of routes) {
      const handler = (StaffPartsFinderController.prototype as unknown as Record<string, () => unknown>)[name]!;
      expect(reflector.get(PERMISSIONS_KEY, handler), name).toEqual(["catalog:write"]);
    }
  });
});

function runMiddleware(method: string, headers: Record<string, string>) {
  const response = { body: "", headers: {} as Record<string, string>, statusCode: 200 };
  const raw = {
    end: (body: string) => { response.body = body; },
    setHeader: (name: string, value: string) => { response.headers[name] = value; },
    set statusCode(value: number) { response.statusCode = value; },
  } as unknown as ServerResponse;
  const next = vi.fn();
  new PartsFinderBodyLimitMiddleware().use({ headers, method } as unknown as IncomingMessage, raw, next);
  return { next, response };
}

describe("PartsFinderBodyLimitMiddleware", () => {
  it("lets small JSON bodies and GET requests through", () => {
    expect(runMiddleware("POST", { "content-length": "120" }).next).toHaveBeenCalled();
    expect(runMiddleware("POST", { "content-length": "4096" }).next).toHaveBeenCalled();
    expect(runMiddleware("GET", {}).next).toHaveBeenCalled();
  });

  it("refuses large or chunked bodies before they are parsed", () => {
    const cases: Array<Record<string, string>> = [{ "content-length": "4097" }, { "content-length": "abc" }, { "transfer-encoding": "chunked" }];
    for (const headers of cases) {
      const { next, response } = runMiddleware("POST", headers);
      expect(next).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(413);
      expect(JSON.parse(response.body)).toEqual({ code: "parts_finder_body_too_large", error: "Запрос слишком большой." });
    }
  });
});

describe("parts finder configuration", () => {
  const base = { DATA_ENCRYPTION_KEY: "d".repeat(32), SESSION_SECRET: "s".repeat(32) };

  it("works without any provider key and keeps FAPI fitment off by default", () => {
    const config = validateEnvironment(base);
    expect([config.PARTS_FINDER_ENABLED, config.FAPI_KEY, config.FAPI_FITMENT_ENABLED, config.FAPI_DAILY_CREDIT_LIMIT, config.API_NINJAS_MODE])
      .toEqual([true, undefined, false, 1000, "off"]);
  });

  // One address could spend the site's whole day of credits in a couple of minutes (60 lists of engines a minute
  // at 8 credits each). A visitor's own share of the day: two cold searches and a few lists fit into 100.
  it("gives one visitor a share of the day's FAPI credits, 100 unless set otherwise", () => {
    expect(validateEnvironment(base).FAPI_VISITOR_DAILY_CREDIT_LIMIT).toBe(100);
    expect(validateEnvironment({ ...base, FAPI_VISITOR_DAILY_CREDIT_LIMIT: "250" }).FAPI_VISITOR_DAILY_CREDIT_LIMIT).toBe(250);
    expect(() => validateEnvironment({ ...base, FAPI_VISITOR_DAILY_CREDIT_LIMIT: "0" })).toThrow();
    expect(() => validateEnvironment({ ...base, FAPI_VISITOR_DAILY_CREDIT_LIMIT: "abc" })).toThrow();
  });

  it("reads optional keys from secret files; a missing or empty file means not configured", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const directory = mkdtempSync(join(tmpdir(), "an30-pf-"));
    writeFileSync(join(directory, "fapi"), "  test-fapi-value\n");
    writeFileSync(join(directory, "empty"), "\n");
    expect(validateEnvironment({ ...base, FAPI_KEY_FILE: join(directory, "fapi") }).FAPI_KEY).toBe("test-fapi-value");
    expect(validateEnvironment({ ...base, FAPI_KEY_FILE: join(directory, "empty") }).FAPI_KEY).toBeUndefined();
    expect(validateEnvironment({ ...base, FAPI_KEY_FILE: join(directory, "missing") }).FAPI_KEY).toBeUndefined();
    expect(validateEnvironment({ ...base, FAPI_FITMENT_ENABLED: "1", PARTS_FINDER_ENABLED: "false" })).toMatchObject({
      FAPI_FITMENT_ENABLED: true, PARTS_FINDER_ENABLED: false,
    });
  });
});
