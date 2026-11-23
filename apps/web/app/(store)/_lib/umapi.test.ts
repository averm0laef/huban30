import { describe, expect, it } from "vitest";

import { catalogCar, fitmentPath, readableName } from "./umapi";

describe("catalogue buttons on the product page", () => {
  it("sends the car of our vehicle catalog, and nothing for a car picked in the former list", () => {
    expect(catalogCar({ label: "Toyota Corolla", modelId: 100_000_200, modificationId: 100_015_508 })).toEqual({ model: 100_000_200, mod: 100_015_508 });
    expect(catalogCar({ label: "Toyota Corolla", modelId: 100_000_200 })).toEqual({ model: 100_000_200 });
    expect(catalogCar({ label: "Toyota Caldina", modelId: 412, modificationId: 9001 })).toBeNull();
    expect(catalogCar(null)).toBeNull();
  });

  it("builds the fitment address with the mode and the car", () => {
    expect(fitmentPath("p-1", "check", { model: 7, mod: 9 })).toBe("product/p-1/fitment?mode=check&model=7&mod=9");
    expect(fitmentPath("p-1", "list", null)).toBe("product/p-1/fitment?mode=list");
  });

  it("reads catalogue capitals as names, codes and short words untouched", () => {
    expect(readableName("MERCEDES-BENZ")).toBe("Mercedes-Benz");
    expect(readableName("SPRINTER 3,5-t Фургон (B906)")).toBe("Sprinter 3,5-t Фургон (B906)");
    expect(readableName("VW")).toBe("VW");
    expect(readableName("COROLLA седан (_E12_)")).toBe("Corolla седан (E12)");
    expect(readableName("1.5 (NZE121, NZE120_, ZZE123)")).toBe("1.5 (NZE121, NZE120, ZZE123)");
  });
});
