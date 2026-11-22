import { describe, expect, it } from "vitest";

import { cleanCapacity, coveredBySeed, modificationsStale, popularFamilies, regionOrder } from "./parts-finder-vehicles.service.js";

describe("vehicle picker views", () => {
  it("drops the unit FAPI writes into engine capacity", () => {
    expect(cleanCapacity("1.6 l")).toBe("1.6");
    expect(cleanCapacity("1,8 л")).toBe("1.8");
    expect(cleanCapacity("")).toBeNull();
    expect(cleanCapacity(null)).toBeNull();
  });

  it("hides seed models that a FAPI generation already names", () => {
    const fapi = ["Priora Седан (2170_)", "110 (2110)", "Samara (2108, 2109, 2113, 2114)", "Toscana (2107)", "Vesta (GFL_)"];
    expect(coveredBySeed("Priora", fapi)).toBe(true);
    expect(coveredBySeed("2110", fapi)).toBe(true);
    expect(coveredBySeed("2114", fapi)).toBe(true);
    expect(coveredBySeed("2107", fapi)).toBe(true);
    expect(coveredBySeed("Vesta", fapi)).toBe(true);
    expect(coveredBySeed("Iskra", fapi)).toBe(false);
    expect(coveredBySeed("Niva Legend", fapi)).toBe(false);
  });

  it("never pays twice for the engines of a generation that ended production", () => {
    const now = new Date("2026-11-21T00:00:00Z");
    const longAgo = new Date("2024-01-01T00:00:00Z");
    expect(modificationsStale({ modifications_checked_at: null, year_to: 2001 }, now)).toBe(true);
    expect(modificationsStale({ modifications_checked_at: longAgo, year_to: 2001 }, now)).toBe(false);
    expect(modificationsStale({ modifications_checked_at: longAgo, year_to: null }, now)).toBe(true);
    expect(modificationsStale({ modifications_checked_at: new Date("2026-10-01T00:00:00Z"), year_to: null }, now)).toBe(false);
  });

  it("fills Japanese makes first, then European ones", () => {
    expect(["Россия", "Корея", "Германия", "Япония", null].sort((a, b) => regionOrder(a) - regionOrder(b))).toEqual(["Япония", "Германия", "Корея", "Россия", null]);
  });

  it("lists the region's usual models first, only those the catalogue has", () => {
    const models = [{ family: "Caldina", name: "Caldina Универсал (_T21_)" }, { family: "Corolla", name: "Corolla (_E12_)" }, { name: "Probox" }];
    expect(popularFamilies(["Camry", "corolla", "Probox", "Caldina"], models)).toEqual(["Corolla", "Probox", "Caldina"]);
    expect(popularFamilies(["RAV4", "Noah", "Voxy"], [{ family: "RAV 4", name: "RAV 4 I (_A1_)" }, { family: "Noah/Voxy", name: "Noah/Voxy (_R6_)" }])).toEqual(["RAV 4", "Noah/Voxy"]);
    expect(coveredBySeed("RAV4", ["RAV 4 I (_A1_)"])).toBe(true);
    expect(coveredBySeed("Voxy", ["Noah/Voxy (_R6_)"])).toBe(true);
  });
});
