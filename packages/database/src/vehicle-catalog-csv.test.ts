import { describe, expect, it } from "vitest";

import { REQUIRED_COLUMNS, parseCatalogLine, readVehicleCatalog } from "./vehicle-catalog-csv.js";

// Hand-made rows in the file's format (not copied from the licensed file).
const HEADER = REQUIRED_COLUMNS.map((name) => `"${name}"`).join(":");

interface RowInput {
  body?: string; capacity?: string; from?: string; fuel?: string; make?: string; makeId?: number; model?: string; modelFrom?: string;
  modelId?: number; modelTo?: string | null; name?: string; pcId: number; ps?: string; short?: string | null; to?: string | null; types?: string;
}

function row(input: RowInput): string {
  const quoted = (value: string | null | undefined) => (value === null || value === undefined ? "NULL" : `"${value.replaceAll("\"", "\"\"")}"`);
  const values: Record<string, string | null> = {
    MFA_BRAND: input.make ?? "TESTMOBIL", MFA_ID: String(input.makeId ?? 7), MS_CI_FROM: input.modelFrom ?? "2001-01-01",
    MS_CI_TO: input.modelTo === undefined ? "2007-12-01" : input.modelTo, MS_ID: String(input.modelId ?? 70), MS_NAME_DES: input.model ?? "ALPHA седан (_A1_)",
    MS_SHORT_NAME1_DES: input.short === undefined ? "ALPHA" : input.short, MS_SHORT_NAME2_DES: null, MS_TYPE: input.types ?? "PC",
    PCS_ABS: "0", PCS_ASR: "1", PCS_BODY_TYPE: input.body ?? "седан", PCS_BRAKE_SYSTEM: null, PCS_BRAKE_TYPE: null,
    PCS_CAPACITY_LT: input.capacity ?? "1.6000", PCS_CAPACITY_TECH: "1598.0000", PCS_CATALYSATOR_TYPE: null, PCS_CI_FROM: input.from ?? "2002-03-01",
    PCS_CI_TO: input.to === undefined ? "2006-05-01" : input.to, PCS_COU_ID: "0", PCS_DRIVE_TYPE: "Привод на передние колеса",
    PCS_ENGINE_TYPE: "Бензиновый двигатель", PCS_FUEL_MIXTURE: null, PCS_FUEL_TYPE: input.fuel ?? "бензин", PCS_GEAR_TYPE: null,
    PCS_NUMBER_OF_CYLINDERS: "4", PCS_NUMBER_OF_DOORS: null, PCS_NUMBER_OF_VALVES: "4", PCS_PC_ID: String(input.pcId),
    PCS_POWER_KW: "81.0000", PCS_POWER_PS: input.ps ?? "110.0000", PCS_VOLTAGE: null, PC_MODEL_DES: input.name ?? "1.6 (AB16)",
  };
  return REQUIRED_COLUMNS.map((name) => quoted(values[name])).join(":");
}

describe("parseCatalogLine", () => {
  it("reads colon-separated quoted values, NULL and doubled quotes", () => {
    expect(parseCatalogLine("\"1\":NULL:\"IR-9 \"\"Can-Am\"\"\":\"a:b\"")).toEqual(["1", null, "IR-9 \"Can-Am\"", "a:b"]);
  });

  it("keeps an empty last field and a bare number", () => {
    expect(parseCatalogLine("\"x\":")).toEqual(["x", null]);
    expect(parseCatalogLine("12:\"y\"")).toEqual(["12", "y"]);
  });

  it("refuses a broken line", () => {
    expect(() => parseCatalogLine("\"open")).toThrow();
    expect(() => parseCatalogLine("\"a\"b:\"c\"")).toThrow();
  });
});

describe("readVehicleCatalog", () => {
  it("builds makes, models and modifications with numbers and dates", () => {
    const file = readVehicleCatalog([HEADER, row({ pcId: 1 }), row({ name: "2.0 (CD20)", pcId: 2, capacity: "2.0000", ps: "150.0000", to: null })]);
    expect(file.rows).toBe(2);
    expect(file.problems).toEqual([]);
    expect(file.makes).toEqual([{ name: "TESTMOBIL", umapiId: 7 }]);
    expect(file.models).toEqual([{
      makeUmapiId: 7, name: "ALPHA седан (_A1_)", producedFrom: "2001-01-01", producedTo: "2007-12-01", series: null, shortName: "ALPHA",
      umapiId: 70, vehicleTypes: ["PC"],
    }]);
    expect(file.modifications.map((item) => [item.umapiId, item.name, item.capacityL, item.powerPs, item.producedTo])).toEqual([
      [1, "1.6 (AB16)", 1.6, 110, "2006-05-01"],
      [2, "2.0 (CD20)", 2, 150, null],
    ]);
    expect(file.modifications[0]).toMatchObject({ capacityCc: 1598, cylinders: 4, hasAbs: false, hasAsr: true, powerKw: 81 });
  });

  it("takes the name and dates most rows give, and an end before the start as unknown", () => {
    const file = readVehicleCatalog([
      HEADER,
      row({ model: "SX4 седан (GY)", modelTo: null, pcId: 1 }),
      row({ model: "SX4 седан (GY)", modelTo: null, pcId: 2 }),
      row({ model: "SX4 Saloon (GY)", modelTo: "1970-01-01", pcId: 3, types: "PC,E-PC" }),
      row({ from: "2010-01-01", pcId: 4, to: "1970-01-01" }),
    ]);
    expect(file.models[0]).toMatchObject({ name: "SX4 седан (GY)", producedTo: null, vehicleTypes: ["E-PC", "PC"] });
    expect(file.modifications.find((item) => item.umapiId === 4)?.producedTo).toBeNull();
  });

  it("reports unreadable rows with their line and loads the rest", () => {
    const file = readVehicleCatalog([HEADER, row({ pcId: 1 }), "\"broken", "\"2\":\"3\"", row({ pcId: 1 }), row({ name: "", pcId: 5 })]);
    expect(file.modifications.map((item) => item.umapiId)).toEqual([1]);
    expect(file.problems.map((problem) => problem.line)).toEqual([3, 4, 5, 6]);
  });

  it("uses the short name for a model without a name and skips a model with neither", () => {
    const file = readVehicleCatalog([
      HEADER,
      row({ model: "", modelId: 80, pcId: 1, short: "BETA" }),
      row({ model: "", modelId: 81, pcId: 2, short: null }),
    ]);
    expect(file.models.map((model) => [model.umapiId, model.name])).toEqual([[80, "BETA"]]);
    expect(file.modifications.map((item) => item.umapiId)).toEqual([1]);
    expect(file.problems).toHaveLength(1);
  });

  it("refuses a file that is not the passenger-car catalog", () => {
    expect(() => readVehicleCatalog(["\"A\":\"B\"", "\"1\":\"2\""])).toThrow(/нет колонок/u);
    expect(() => readVehicleCatalog([])).toThrow(/пустой/u);
  });
});
