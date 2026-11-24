// «фильтр салона ауди а4»: the car a search request names, read from our own vehicle catalog (no paid call).
import { describe, expect, it } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import { VehicleCatalogService } from "./vehicle-catalog.service.js";

const MAKES = [
  { id: 100000001, name: "AUDI", umapi_id: 5 },
  { id: 100000002, name: "TOYOTA", umapi_id: 111 },
  { id: 100000003, name: "TOYOTA (FAW)", umapi_id: 999 },
];
const model = (id: number, makeId: number, name: string, short: string, from: string, to: string | null) => ({
  id, make_id: makeId, name, produced_from: new Date(from), produced_to: to ? new Date(to) : null, short_name: short,
});
const MODELS = [
  model(200000001, 100000001, "A4 B7 (8EC, B7)", "A4", "2004-11-01", "2008-06-01"),
  model(200000002, 100000001, "A4 B8 (8K2, B8)", "A4", "2007-11-01", "2015-12-01"),
  model(200000003, 100000001, "A6 C7 (4G2, 4GC)", "A6", "2010-11-01", "2018-09-01"),
  model(200000004, 100000002, "CAMRY седан (_V7_)", "CAMRY", "2017-01-01", null),
  model(200000005, 100000002, "COROLLA (_E12_)", "COROLLA", "2001-11-01", "2007-02-01"),
];

function catalog(): VehicleCatalogService {
  const database = {
    query: async (sql: string) => ({ rows: sql.includes("vehicle_catalog_makes") && !sql.includes("vehicle_catalog_models") ? MAKES : sql.includes("FROM app.vehicle_catalog_models") ? MODELS : [] }),
  } as unknown as DatabaseService;
  return new VehicleCatalogService(database);
}

describe("VehicleCatalogService.understand", () => {
  it("reads the make and the model in Russian spelling, and leaves the part", async () => {
    const found = await catalog().understand("фильтр салона ауди а4");
    expect(found).toMatchObject({ family: "A4", label: "Audi A4", part: "фильтр салона" });
    expect(found!.make.slug).toBe("audi");
    expect(found!.models.map((item) => item.id)).toEqual([200000001, 200000002]);
  });

  it("narrows the generations by a body code or a year typed along", async () => {
    expect((await catalog().understand("колодки audi a4 b8"))!.models.map((item) => item.id)).toEqual([200000002]);
    expect((await catalog().understand("колодки audi a4 2006"))!.models.map((item) => item.id)).toEqual([200000001]);
  });

  it("reads a well-known model without its make", async () => {
    expect(await catalog().understand("амортизатор камри")).toMatchObject({ family: "Camry", part: "амортизатор" });
  });

  it("is no car request without a car, without a model, or without a part", async () => {
    expect(await catalog().understand("фильтр салона")).toBeNull();
    expect(await catalog().understand("фильтр салона ауди")).toBeNull();
    expect(await catalog().understand("audi a4")).toBeNull();
    expect(await catalog().understand("audi a4 2008")).toBeNull();
  });
});
