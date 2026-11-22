// Real-database check of the 1С integration settings a staff member edits
// (OneCIntegrationService.getSettings / updateSettings). Skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a scratch database -- see
// catalog-search-regression.test.ts for how to prepare one.

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const actor = { role: "admin", userId: "00000000-0000-4000-8000-000000000001" } as AuthContext;

describe.skipIf(!url)("1С integration settings (real PostgreSQL)", () => {
  let database: DatabaseService;
  let service: OneCIntegrationService;

  const resetOptions = () => database.query("UPDATE app.integration_endpoints SET settings = '{}'::jsonb WHERE integration_key = 'one_c'");
  const update = (input: Record<string, unknown>) => service.updateSettings(input, actor, "127.0.0.1");

  beforeAll(() => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    const audit = { record: async () => undefined } as unknown as AuditService;
    service = new OneCIntegrationService(audit, database, undefined as never, undefined as never);
  });

  beforeEach(resetOptions);

  afterAll(async () => {
    await resetOptions();
    await database?.onModuleDestroy?.();
  });

  it("does not publish 1С descriptions until a staff member turns it on", async () => {
    expect(await service.getSettings()).toMatchObject({ publishDescriptions: false });
  });

  it("remembers that descriptions are to be published", async () => {
    await update({ publishDescriptions: true });

    expect(await service.getSettings()).toMatchObject({ publishDescriptions: true });
  });

  it("keeps the choice when another setting is saved later", async () => {
    await update({ publishDescriptions: true });

    await update({ expectedSyncMinutes: 30 });

    expect(await service.getSettings()).toMatchObject({ expectedSyncMinutes: 30, publishDescriptions: true });
  });
});
