import { describe, expect, it } from "vitest";

import { popularFamilies } from "./parts-finder-vehicles.service.js";

describe("vehicle picker views", () => {
  it("lists the region's usual models first, only those the catalogue has", () => {
    const models = [{ family: "Caldina", name: "Caldina Универсал (_T21_)" }, { family: "Corolla", name: "Corolla (_E12_)" }, { name: "Probox" }];
    expect(popularFamilies(["Camry", "corolla", "Probox", "Caldina"], models)).toEqual(["Corolla", "Probox", "Caldina"]);
    expect(popularFamilies(["RAV4", "Noah", "Voxy"], [{ family: "RAV 4", name: "RAV 4 I (_A1_)" }, { family: "Noah/Voxy", name: "Noah/Voxy (_R6_)" }])).toEqual(["RAV 4", "Noah/Voxy"]);
  });
});
