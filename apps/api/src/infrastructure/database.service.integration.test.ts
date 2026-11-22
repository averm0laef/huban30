// Real-database check of how the application connects to PostgreSQL.
// Skipped unless CATALOG_SEARCH_DATABASE_URL points at a scratch database --
// see catalog/catalog-search-regression.test.ts for how to prepare one.

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "./database.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

describe.skipIf(!url)("the application's connections to PostgreSQL (real database)", () => {
  let database: DatabaseService;

  beforeAll(() => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
  });

  afterAll(async () => {
    await database?.onModuleDestroy();
  });

  // Measured on the demo server with the owner's 42 723 items: the first page of the catalogue took 2.1 s, of
  // which 1.5 s was PostgreSQL compiling the query (JIT) and 0.5 s running it. The planner prices the listing's
  // per-product subqueries high enough to switch the compiler on, and it never pays for itself on a page of 24.
  it("run queries without just-in-time compilation", async () => {
    expect((await database.query<{ jit: string }>("SHOW jit")).rows[0]!.jit).toBe("off");
  });

  it("run transactions without it too", async () => {
    expect(await database.transaction(async (client) => (await client.query<{ jit: string }>("SHOW jit")).rows[0]!.jit)).toBe("off");
  });
});
