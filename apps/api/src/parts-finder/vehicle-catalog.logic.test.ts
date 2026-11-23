import { describe, expect, it } from "vitest";

import {
  CATALOG_ID_BASE, engineCodes, familyOf, isCatalogId, makeViews, modelView, modificationName, modificationView, prettyName, sortModifications,
} from "./vehicle-catalog.logic.js";

const TOYOTA = ["Camry", "Corolla", "RAV4", "Land Cruiser", "Land Cruiser Prado", "Probox", "Succeed", "Noah", "Voxy", "Mark II"];

describe("UMAPI catalog views", () => {
  it("tells a car of this catalog from one picked in the former list", () => {
    expect(isCatalogId(CATALOG_ID_BASE)).toBe(true);
    expect(isCatalogId(412)).toBe(false);
    expect(isCatalogId(undefined)).toBe(false);
  });

  it("names makes the way the shop does and keeps slugs unique", () => {
    const views = makeViews([
      { id: 100000003, name: "VW", umapi_id: 121 },
      { id: 100000001, name: "TOYOTA", umapi_id: 111 },
      { id: 100000002, name: "ALFA ROMEO", umapi_id: 2 },
      { id: 100000004, name: "TOYOTA (FAW)", umapi_id: 4000 },
      { id: 100000005, name: "VOLKSWAGEN", umapi_id: 9000 },
    ]);
    expect(views.map((view) => [view.name, view.slug, view.nameRu, view.rank])).toEqual([
      ["Alfa Romeo", "alfa-romeo", "Альфа Ромео", null],
      ["Toyota", "toyota", "Тойота", 1],
      ["Volkswagen", "volkswagen", "Фольксваген", 11],
      ["Toyota (FAW)", "toyota-faw", null, null],
      ["Volkswagen", "volkswagen-9000", "Фольксваген", 11],
    ]);
    expect(prettyName("MERCEDES-BENZ")).toBe("Mercedes-Benz");
  });

  it("finds the model people mean in a catalog generation", () => {
    expect(familyOf("COROLLA седан (_E12_)", "COROLLA", TOYOTA)).toBe("Corolla");
    expect(familyOf("LAND CRUISER 80 (_J8_)", "LAND CRUISER 80", TOYOTA)).toBe("Land Cruiser");
    expect(familyOf("LAND CRUISER PRADO (_J15_)", "LAND CRUISER PRADO", TOYOTA)).toBe("Land Cruiser Prado");
    expect(familyOf("PROBOX / SUCCEED (_P5_)", "PROBOX / SUCCEED", TOYOTA)).toBe("PROBOX / SUCCEED");
    expect(familyOf("RAV 4 III (_A3_)", "RAV 4", TOYOTA)).toBe("RAV 4");
    expect(familyOf("COROLLA CROSS (ZVG1_)", "COROLLA CROSS", TOYOTA)).toBe("COROLLA CROSS");
    expect(familyOf("COROLLA Verso (_E12_)", "COROLLA", TOYOTA)).toBe("Corolla");
    expect(familyOf("RIVA универсал (2104)", "NOVA", [])).toBeNull();
  });

  it("shows a generation by family, body code, body type and years", () => {
    const view = (name: string, short: string | null) => modelView({
      id: CATALOG_ID_BASE, make_id: 1, name, produced_from: "2000-08-01", produced_to: null, short_name: short,
    }, TOYOTA);
    expect(view("COROLLA седан (_E12_)", "COROLLA")).toMatchObject({ body: "седан", family: "Corolla", generation: "E12", yearFrom: 2000, yearTo: null });
    expect(view("LAND CRUISER 80 (_J8_)", "LAND CRUISER 80")).toMatchObject({ family: "Land Cruiser", generation: "80 · J8" });
    expect(view("RAV 4 III (_A3_)", "RAV 4")).toMatchObject({ family: "RAV4", generation: "III · A3" });
    expect(view("PROBOX / SUCCEED (_P5_)", "PROBOX / SUCCEED")).toMatchObject({ family: "Probox / Succeed", generation: "P5" });
    expect(view("MARK II IX седан (_X11_)", "MARK II")).toMatchObject({ body: "седан", family: "Mark II", generation: "IX · X11" });
    // The card shows the series and the body code apart.
    expect(view("COROLLA Verso (ZER_, ZZE12_, R1_)", "COROLLA")).toMatchObject({ bodyCode: "ZER, ZZE12, R1", series: "Verso" });
    expect(view("COROLLA седан (_E12_)", "COROLLA")).toMatchObject({ bodyCode: "E12", series: null });
    expect(view("LAND CRUISER 80 (_J8_)", "LAND CRUISER 80")).toMatchObject({ bodyCode: "J8", series: "80" });
  });

  it("reads engine codes and litres from a modification name", () => {
    expect(engineCodes("1.4 (L08, L68)")).toEqual(["L08", "L68"]);
    // «NZE121_» is a chassis code (the catalog marks those with «_»), not an engine.
    expect(engineCodes("1.5 VVT-i (NZE121_)")).toEqual([]);
    expect(engineCodes("1.8 (1ZZ-FE)")).toEqual(["1ZZ-FE"]);
    expect(engineCodes("316 (Ecotronic)")).toEqual([]);
    expect(engineCodes("1.6 16V")).toEqual([]);
    expect(modificationName("1.4 (L08, L68)")).toBe("1.4 л (L08, L68)");
    expect(modificationName("2.0 TCe (DZ1N)")).toBe("2.0 л TCe (DZ1N)");
    expect(modificationName("1.6")).toBe("1.6 л");
    expect(modificationName("530 d xDrive")).toBe("530 d xDrive");
    expect(modificationName("1.4 VVT-i (ZZE120_, ZZE120R)")).toBe("1.4 л VVT-i (ZZE120, ZZE120R)");
  });

  it("builds the engine line and sorts engines by volume, power and year", () => {
    const row = (id: number, name: string, capacity: string | null, ps: number | null, from: string) => ({
      body_type: "Хэтчбэк", capacity_l: capacity, drive_type: "Привод на передние колеса", fuel_type: "Бензин/автогаз (LPG)", id, name,
      power_ps: ps, produced_from: from, produced_to: null,
    });
    const view = modificationView(row(1, "1.4 (L08, L68)", "1.4", 90, "2006-07-01"));
    expect(view).toEqual({
      body: "Хэтчбэк", capacity: "1.4", drive: "передний привод", engine: "L08, L68", fuel: "бензин/автогаз (LPG)", id: 1,
      label: "1.4 л (L08, L68) · 90 л.с. · бензин/автогаз (LPG)", name: "1.4 л (L08, L68)", powerPs: 90, yearFrom: 2006, yearTo: null,
    });
    const sorted = sortModifications([
      modificationView(row(2, "1.6", "1.6", 115, "2008-01-01")),
      modificationView(row(3, "1.2", "1.2", 80, "2006-01-01")),
      modificationView(row(4, "1.6", "1.6", 105, "2006-01-01")),
      modificationView(row(5, "Electric", null, 136, "2020-01-01")),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([5, 3, 4, 2]);
  });
});
