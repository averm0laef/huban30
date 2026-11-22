import { describe, expect, it, vi } from "vitest";

import { UpstreamStatusError, UpstreamUnavailableError, type JsonResponse, type RequestJson } from "./http.js";
import { NINJAS_URL, VINROKU_URL, VPIC_URL, VehicleIdentity, type VehicleStore } from "./vehicle-identity.js";
import { checkUsVin, decodeLocal } from "./vin-decoder.js";

const LADA = "XTAGFK330JY144213";
const HONDA = "1HGCM82633A004352";
const CHASSIS = "MXPH14-0036630";
const NOW = new Date("2026-11-21T00:00:00Z");

const CHASSIS_RESPONSE = {
  ok: true, type: "chassis", query: { normalized: CHASSIS },
  matches: [
    { manufacturer: "Toyota", productionYear: 2025, chassisCode: "MXPH14", registrationType: "6AA-MXPH14",
      serialStartText: "0036630", serialEndText: "0071067", sourceUrl: "https://www.jama.or.jp/2025.pdf", sourcePage: 4 },
    { manufacturer: "Toyota", productionYear: 2024, chassisCode: "MXPH14", registrationType: "6AA-MXPH14",
      serialStartText: "0001005", serialEndText: "0036654", sourceUrl: "https://www.jama.or.jp/2024.pdf", sourcePage: 4 },
    { manufacturer: "Toyota", productionYear: 2023, chassisCode: "MXPH14", serialStartText: "0001005", serialEndText: "0036629" },
  ],
  catalogReferences: [{ manufacturer: "TOYOTA", model: "YARIS", chassisCode: "MXPH14", engines: ["M15A-FXE"], gearboxes: ["CVT"] }],
};

// vPIC flat record for the Honda as NHTSA publishes it (abridged).
const HONDA_VPIC = {
  Make: "HONDA", Model: "Accord", ModelYear: "2003", Trim: "EX-V6", BodyClass: "Coupe", Doors: "2",
  EngineCylinders: "6", EngineHP: "240", EngineModel: "J30A4", TransmissionStyle: "Automatic", TransmissionSpeeds: "5",
  Manufacturer: "AMERICAN HONDA MOTOR CO., INC.", ErrorCode: "0",
};

class MemoryVehicleStore implements VehicleStore {
  cache = new Map<string, unknown>();
  quota = new Map<string, { remaining: number; resetAt: number }>();
  async getCached(kind: string, id: string) { return this.cache.get(`${kind}:${id}`); }
  async getQuota(provider: string) { return this.quota.get(provider) ?? null; }
  async putCached(kind: string, id: string, payload: unknown) { this.cache.set(`${kind}:${id}`, payload); }
  async saveQuota(provider: string, _limit: number | null, remaining: number, resetAt: number) { this.quota.set(provider, { remaining, resetAt }); }
}

function identity(http: RequestJson, ninjas: { key?: string; mode?: string } = {}) {
  const store = new MemoryVehicleStore();
  return {
    service: new VehicleIdentity({ ninjasKey: () => ninjas.key, ninjasMode: () => ninjas.mode ?? "off", requestJson: http, store }),
    store,
  };
}

function reply(data: unknown, headers: Record<string, string> = {}): JsonResponse {
  return { data, headers };
}

describe("VIN decoding", () => {
  it("decodes LADA locally and settles the Vesta model year", async () => {
    const http = vi.fn<RequestJson>(async () => { throw new Error("no network for LADA"); });
    const info = await identity(http).service.identify(`  ${LADA.toLowerCase()}\n`);
    expect([info.status, info.source, info.check_digit]).toEqual(["decoded", "vininfo", "not_assessed"]);
    expect(info.vehicle).toMatchObject({
      make: "LADA", manufacturer: "AvtoVAZ", model: "Vesta", model_year: 2018, engine_model: "21179",
      plant_city: "Izhevsk", body: "Station Wagon", doors: "5",
    });
    expect(http).not.toHaveBeenCalled();
    expect(decodeLocal(LADA, NOW).vehicle.model_year).toBe(2018);
  });

  it("decodes the Honda through vPIC online once and serves the repeat from the cache", async () => {
    const http = vi.fn<RequestJson>(async () => reply({ Results: [HONDA_VPIC] }));
    const { service } = identity(http);
    const info = await service.identify(HONDA);
    expect([info.status, info.source, info.check_digit]).toEqual(["decoded", "nhtsa_vpic_online", "match"]);
    expect(info.vehicle).toMatchObject({ make: "HONDA", model: "Accord", model_year: 2003, engine_hp: "240", transmission_speeds: "5" });
    await service.identify(HONDA);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe(`${VPIC_URL}${HONDA}?format=json`);
    expect(checkUsVin(HONDA).matches).toBe(true);
  });

  it("keeps vPIC error codes: check digit mismatch is partial and no trim is invented", async () => {
    const raw = { Make: "HONDA", Model: "Accord", ModelYear: "2003", ErrorCode: "1", Trim: "Not Applicable" };
    const info = await identity(async () => reply({ Results: [raw] })).service.identify(HONDA);
    expect([info.source, info.check_digit, info.status]).toEqual(["nhtsa_vpic_online", "mismatch", "partial"]);
    expect(info.vehicle).not.toHaveProperty("trim");
  });

  it("does not publish guessed models or years", async () => {
    const byd = await identity(async () => reply({ Results: [{ Make: "BYD", Model: "Electric Bus Chassis", ModelYear: "2022", ErrorCode: "1,4,14" }] }))
      .service.identify("LC0CE4CB6N0123456");
    expect([byd.status, byd.vehicle]).toEqual(["partial", { make: "BYD" }]);
    const peugeot = await identity(async () => reply({ Results: [{ Make: "PEUGEOT", ModelYear: "1987", ErrorCode: "1,5,14,400", PlantCountry: "FRANCE" }] }))
      .service.identify("VF3AAA123HA123456");
    expect([peugeot.status, peugeot.vehicle]).toEqual(["partial", { make: "PEUGEOT" }]);
  });

  it("falls back to the WMI table when vPIC is down and refuses an unknown maker", async () => {
    const down: RequestJson = async () => { throw new UpstreamUnavailableError("timeout"); };
    const info = await identity(down).service.identify("JHM12345678901234");
    expect([info.status, info.source, info.vehicle]).toEqual(["partial", "vininfo", { manufacturer: "Honda" }]);
    await expect(identity(down).service.identify("ZZZ12345678901234")).rejects.toMatchObject({ status: 503, code: "vpic_unavailable" });
  });

  it("rejects malformed chassis numbers and Cyrillic look-alikes", async () => {
    for (const vin of ["BNR32-30AB66", "ХTAGFK330JY144213"]) {
      await expect(identity(async () => reply({})).service.identify(vin)).rejects.toMatchObject({ status: 400, code: "invalid_vin" });
    }
  });

  it("computes the US check digit, including X and the ? placeholder", () => {
    const result = checkUsVin("1M8GDM9A?KP042788");
    expect(result).toMatchObject({ matches: null, expected_check_digit: "X", vin_with_check_digit: "1M8GDM9AXKP042788" });
    expect(() => checkUsVin(CHASSIS)).toThrow(expect.objectContaining({ code: "chassis_number" }));
  });
});

describe("Japanese chassis numbers", () => {
  it("keeps both candidate years, names the Yaris and asks VINROKU once", async () => {
    const http = vi.fn<RequestJson>(async () => reply(CHASSIS_RESPONSE, { "ratelimit-limit": "100", "ratelimit-remaining": "99" }));
    const { service, store } = identity(http, { key: "demo-secret", mode: "demo" });
    const info = await service.identify(" mxph14 — 0036630 ");
    expect([info.status, info.chassis]).toEqual(["ambiguous", CHASSIS]);
    expect((info.matches as Array<{ production_year: number }>).map((match) => match.production_year)).toEqual([2025, 2024]);
    expect((info.catalog_references as Array<{ model: string }>)[0]!.model).toBe("YARIS");
    expect(info).not.toHaveProperty("vehicle");
    const repeat = await service.identify(CHASSIS);
    expect(repeat.cached).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe(`${VINROKU_URL}?q=${CHASSIS}`);
    expect(store.quota.get("vinroku")?.remaining).toBe(99);
  });

  it("stops at the exhausted daily VINROKU quota", async () => {
    const http = vi.fn<RequestJson>();
    const { service, store } = identity(http);
    store.quota.set("vinroku", { remaining: 0, resetAt: Date.now() / 1000 + 3600 });
    await expect(service.identify(CHASSIS)).rejects.toMatchObject({ status: 429, code: "vinroku_rate_limited" });
    expect(http).not.toHaveBeenCalled();
  });

  it("reports a VINROKU refusal and uses API Ninjas only when configured", async () => {
    const refused: RequestJson = async () => { throw new UpstreamStatusError(403, {}); };
    await expect(identity(refused).service.identify(CHASSIS)).rejects.toMatchObject({ code: "vinroku_http_error" });
    const empty = { ...CHASSIS_RESPONSE, matches: [], catalogReferences: [] };
    const http = vi.fn<RequestJson>(async (url) => (url.startsWith(VINROKU_URL)
      ? reply(empty) : reply({ vin: CHASSIS, manufacturer: "Toyota", model: "Yaris" })));
    const info = await identity(http, { key: "demo-secret", mode: "demo" }).service.identify(CHASSIS);
    expect([info.type, info.source, (info.vehicle as { model: string }).model]).toEqual(["chassis", "api_ninjas", "Yaris"]);
  });
});

describe("API Ninjas VIN fallback", () => {
  it("sends the key as a header, never caches, and is skipped when off", async () => {
    const vin = "LGXCE4CB1R2065480";
    const partial = { Make: "BYD", ErrorCode: "8" };
    const full = { vin, country: "China", year: "2024", manufacturer: "BYD", model: "Yuan Plus", class: "SUV" };
    const http = vi.fn<RequestJson>(async (url) => (url.startsWith(VPIC_URL) ? reply({ Results: [partial] }) : reply(full)));
    const { service } = identity(http, { key: "demo-secret", mode: "demo" });
    const first = await service.identify(vin);
    const second = await service.identify(vin);
    expect([first.source, (first.vehicle as { model: string }).model]).toEqual(["api_ninjas", "Yuan Plus"]);
    expect(second.source).toBe("api_ninjas");
    const ninjaCalls = http.mock.calls.filter(([url]) => url.startsWith(NINJAS_URL));
    expect(ninjaCalls).toHaveLength(2);
    expect(ninjaCalls[0]![1]?.headers).toEqual({ "X-Api-Key": "demo-secret" });
    const off = vi.fn<RequestJson>(async () => reply({ Results: [partial] }));
    expect((await identity(off).service.identify(vin)).source).toBe("nhtsa_vpic_online");
    expect(off.mock.calls.every(([url]) => !url.startsWith(NINJAS_URL))).toBe(true);
  });
});
