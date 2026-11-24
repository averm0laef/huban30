import { describe, expect, it } from "vitest";

import { chosenCarCaption, vehicleCardActions, type PickedVehicle } from "./parts-finder";

const own: PickedVehicle = { label: "Toyota Caldina · T21 · 1997–2002", make: "Toyota", model: "Caldina", modelId: 412, modificationId: 9001 };
const withEngine: PickedVehicle = { ...own, tecdoc: { genId: 77, mfaId: 111, msId: 3344 } };
const withoutEngine: PickedVehicle = { ...own, tecdoc: { msId: 3344 } };

describe("what the «Ваш автомобиль» card of /podbor offers under the car", () => {
  // «Сохранить в гараж» used to sit inside the block that is drawn only with the TecDoc catalogue: without a
  // TecDoc key a signed-in customer could not save the car from this page at all, though the garage itself
  // takes a car of the shop's own catalogue.
  it("offers a signed-in customer to save the car when the shop works on its own catalogue", () => {
    expect(vehicleCardActions({ picked: own, saved: false, signedIn: true, source: "local", useVehicle: true }))
      .toEqual({ carCatalog: null, saveToGarage: true });
  });

  it("offers to save the car whether or not parts are being picked for it", () => {
    expect(vehicleCardActions({ picked: own, saved: false, signedIn: true, source: "local", useVehicle: false }).saveToGarage).toBe(true);
    expect(vehicleCardActions({ picked: withEngine, saved: false, signedIn: true, source: "tecdoc", useVehicle: false }).saveToGarage).toBe(true);
  });

  it("does not offer to save to a visitor who is not signed in, a car already saved, or a car typed as text", () => {
    expect(vehicleCardActions({ picked: own, saved: false, signedIn: false, source: "local", useVehicle: true }).saveToGarage).toBe(false);
    expect(vehicleCardActions({ picked: own, saved: true, signedIn: true, source: "local", useVehicle: true }).saveToGarage).toBe(false);
    expect(vehicleCardActions({ picked: null, saved: false, signedIn: true, source: "local", useVehicle: true }).saveToGarage).toBe(false);
  });

  it("opens the car's parts catalogue only with TecDoc, for a car whose engine is known, while parts are picked for it", () => {
    expect(vehicleCardActions({ picked: withEngine, saved: false, signedIn: false, source: "tecdoc", useVehicle: true }).carCatalog).toBe("open");
    expect(vehicleCardActions({ picked: withoutEngine, saved: false, signedIn: false, source: "tecdoc", useVehicle: true }).carCatalog).toBe("needs-engine");
    expect(vehicleCardActions({ picked: null, saved: false, signedIn: false, source: "tecdoc", useVehicle: true }).carCatalog).toBe("needs-engine");
    expect(vehicleCardActions({ picked: withEngine, saved: false, signedIn: false, source: "tecdoc", useVehicle: false }).carCatalog).toBeNull();
    expect(vehicleCardActions({ picked: withEngine, saved: false, signedIn: false, source: "local", useVehicle: true }).carCatalog).toBeNull();
  });
});

describe("the chosen car as the header names it", () => {
  // The header keeps one place for the car on every page: the visitor sees which car the shop is picking parts
  // for, and the place does not appear and disappear as the browser's storage is read.
  it("invites to choose a car when none is chosen", () => {
    expect(chosenCarCaption(null)).toEqual({ caption: "Выбрать авто", description: "Выбрать автомобиль для подбора запчастей" });
  });

  it("names the make and the model, and tells the rest to a screen reader and in the hint", () => {
    expect(chosenCarCaption(own)).toEqual({
      caption: "Toyota Caldina",
      description: "Ваш автомобиль: Toyota Caldina · T21 · 1997–2002. Открыть подбор",
    });
  });

  it("names a car known only as a line of text by the start of that line", () => {
    expect(chosenCarCaption({ label: "Toyota Gaia · SXM10 · 1998–2004 · 3S-FE" }).caption).toBe("Toyota Gaia");
    expect(chosenCarCaption({ label: "JTDBR32E720123456" }).caption).toBe("JTDBR32E720123456");
  });

  it("does not leave the place empty for a car without a usable name", () => {
    expect(chosenCarCaption({ label: "   " }).caption).toBe("Ваш автомобиль");
  });
});

describe("the car's parts catalogue from UMAPI (podbor/umapi-car-catalogue.tsx)", () => {
  const base = { saved: false, signedIn: false, source: "local" as const, useVehicle: true };
  it("opens for a car of our vehicle catalog with its engine, asks for the engine otherwise", () => {
    expect(vehicleCardActions({ ...base, picked: { label: "Audi A4", modelId: 100000002, modificationId: 100000777 }, umapi: true }).carCatalog).toBe("open");
    expect(vehicleCardActions({ ...base, picked: { label: "Audi A4", modelId: 100000002 }, umapi: true }).carCatalog).toBe("needs-engine");
  });

  it("is not offered while the catalogue does not answer, nor when parts are not picked for the car", () => {
    expect(vehicleCardActions({ ...base, picked: { label: "Audi A4", modificationId: 100000777 }, umapi: false }).carCatalog).toBeNull();
    expect(vehicleCardActions({ ...base, picked: { label: "Audi A4", modificationId: 100000777 }, umapi: true, useVehicle: false }).carCatalog).toBeNull();
  });
});
