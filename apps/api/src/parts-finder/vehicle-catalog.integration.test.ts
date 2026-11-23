// Real-database check of the UMAPI vehicle catalog picker (docs/UMAPI.md): hand-made rows in
// app.vehicle_catalog_*, read the way the storefront reads them. Skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a scratch database (catalog/catalog-search-regression.test.ts).

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";
import { CATALOG_ID_BASE } from "./vehicle-catalog.logic.js";
import { VehicleCatalogService } from "./vehicle-catalog.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
// Catalog numbers far above the real file's (up to ~1 million) so a loaded catalog is never touched.
const MAKE = 1_900_000_001;
const MODELS = { alpha: 1_900_000_101, alphaOld: 1_900_000_102, beta: 1_900_000_103 } as const;

describe.skipIf(!url)("UMAPI vehicle catalog picker (real PostgreSQL)", () => {
  let database: DatabaseService;
  let catalog: VehicleCatalogService;
  const remove = async () => {
    await database.query("DELETE FROM app.vehicle_catalog_modifications WHERE umapi_id >= 1900000000");
    await database.query("DELETE FROM app.vehicle_catalog_models WHERE umapi_id >= 1900000000");
    await database.query("DELETE FROM app.vehicle_catalog_makes WHERE umapi_id >= 1900000000");
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    catalog = new VehicleCatalogService(database);
    await remove();
    await database.query("INSERT INTO app.vehicle_catalog_makes (umapi_id, name) VALUES ($1, 'TESTMOBIL')", [MAKE]);
    const model = async (umapiId: number, name: string, short: string, from: string, to: string | null) => database.query(
      `INSERT INTO app.vehicle_catalog_models (make_id, umapi_id, name, short_name, vehicle_types, produced_from, produced_to)
       SELECT id, $2, $3, $4, '{PC}', $5, $6 FROM app.vehicle_catalog_makes WHERE umapi_id = $1`,
      [MAKE, umapiId, name, short, from, to],
    );
    await model(MODELS.alpha, "ALPHA седан (_A2_)", "ALPHA", "2010-01-01", null);
    await model(MODELS.alphaOld, "ALPHA Хэтчбэк (_A1_)", "ALPHA", "2001-01-01", "2009-12-01");
    await model(MODELS.beta, "BETA (B1)", "BETA", "2005-01-01", "2012-01-01");
    const modification = async (umapiId: number, modelUmapiId: number, name: string, capacity: number, ps: number, active = true) => database.query(
      `INSERT INTO app.vehicle_catalog_modifications (model_id, umapi_id, name, capacity_l, power_ps, fuel_type, body_type, drive_type, produced_from, is_active)
       SELECT id, $2, $3, $4, $5, 'бензин', 'седан', 'Привод на передние колеса', '2010-01-01', $6 FROM app.vehicle_catalog_models WHERE umapi_id = $1`,
      [modelUmapiId, umapiId, name, capacity, ps, active],
    );
    await modification(1_900_001_001, MODELS.alpha, "2.0 (XB20)", 2, 150);
    await modification(1_900_001_002, MODELS.alpha, "1.6 (XA16)", 1.6, 110);
    await modification(1_900_001_003, MODELS.alpha, "1.4 (XA14)", 1.4, 90, false);
    await modification(1_900_001_004, MODELS.alphaOld, "1.3", 1.3, 75);
    // BETA has no shown engine: it is not offered.
    await modification(1_900_001_005, MODELS.beta, "1.0", 1, 60, false);
  }, 60_000);

  afterAll(async () => {
    if (database) await remove();
    await database?.onModuleDestroy?.();
  });

  it("is in use once it holds a shown modification", async () => {
    expect(await catalog.ready()).toBe(true);
  });

  it("lists the make with its models grouped by family, newest generation first", async () => {
    const makes = await catalog.makes();
    const make = makes.groups.flatMap((group) => group.makes).find((item) => item.slug === "testmobil");
    expect(make).toMatchObject({ name: "Testmobil" });
    expect(make!.id).toBeGreaterThanOrEqual(CATALOG_ID_BASE);
    const models = await catalog.models("testmobil");
    expect(models.source).toBe("umapi");
    expect(models.models.map((item) => [item.family, item.generation, item.body, item.yearFrom, item.yearTo])).toEqual([
      ["Alpha", "A2", "седан", 2010, null],
      ["Alpha", "A1", "хэтчбэк", 2001, 2009],
    ]);
  });

  it("gives the shown engines of a generation, smallest first", async () => {
    const alpha = (await catalog.models("testmobil")).models[0]!;
    const result = await catalog.modifications(alpha.id);
    expect(result.available).toBe(true);
    expect(result.modifications.map((item) => [item.name, item.engine, item.powerPs, item.drive])).toEqual([
      ["1.6 л (XA16)", "XA16", 110, "передний привод"],
      ["2.0 л (XB20)", "XB20", 150, "передний привод"],
    ]);
    await expect(catalog.modifications(12)).rejects.toMatchObject({ code: "vehicle_model_not_found" });
  });

  it("suggests the family by name and the generation by its body code", async () => {
    expect((await catalog.suggest("testmobil alpha"))[0]).toMatchObject({ family: "Alpha", label: "Testmobil Alpha", model: null });
    const byCode = await catalog.suggest("testmobil a1");
    expect(byCode[0]).toMatchObject({ label: "Testmobil Alpha A1", model: { generation: "A1" } });
  });

  it("describes a picked engine for the guided search, and refuses an unknown car", async () => {
    const alpha = (await catalog.models("testmobil")).models[0]!;
    const engine = (await catalog.modifications(alpha.id)).modifications[0]!;
    const car = await catalog.selected({ modificationId: engine.id });
    expect(car).toMatchObject({ capacity: "1.6", engine: "XA16", fapiModificationId: null, make: "Testmobil", model: "Alpha" });
    expect(car.label).toContain("Testmobil · Alpha · A2 · 1.6 л (XA16)");
    expect(catalog.owns({ modificationId: engine.id })).toBe(true);
    expect(catalog.owns({ modelId: 412 })).toBe(false);
    await expect(catalog.selected({ modificationId: CATALOG_ID_BASE - 1 })).rejects.toMatchObject({ code: "invalid_vehicle" });
  });
});
