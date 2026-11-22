// Real-database check: a real full exchange from 1С replaces a catalogue loaded earlier under other ids (the trial
// upload of the owner's list export uses 1С codes as ids; 1С itself sends GUIDs). Skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a scratch database (see catalog/catalog-search-regression.test.ts).
// Runs on the second 1С base, so the "at least half of the live products" guard counts only this file's products.

import { createHash } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProductPhotoStorage } from "../adapters/product-photo-storage.js";
import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { CatalogPublicService } from "../catalog/catalog-public.service.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { OneCExchangeService } from "./one-c-exchange.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const WORD = "пробазамены";
const FILE = "itreplace-";

const xml = (ids: string[], onlyChanges: boolean, stamp: string) => `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="${stamp}">
  <Классификатор><Ид>itreplace</Ид><Наименование>Классификатор</Наименование></Классификатор>
  <Каталог СодержитТолькоИзменения="${onlyChanges}"><Ид>itreplace-cat</Ид><Товары>
${ids.map((id) => `<Товар><Ид>${id}</Ид><Артикул>PZ-${id.split("-").at(-1)}</Артикул><Наименование>Фильтр ${WORD} ${id.split("-").at(-1)}</Наименование></Товар>`).join("\n")}
  </Товары></Каталог>
</КоммерческаяИнформация>`;

describe.skipIf(!url)("a real full exchange replaces a catalogue loaded under other ids (real PostgreSQL)", () => {
  let database: DatabaseService;
  let storefront: CatalogPublicService;
  let exchange: OneCExchangeService;

  const visible = async () => (await storefront.products({ limit: "24", q: WORD })).items.map((item) => item.name).sort();
  const load = async (name: string, content: string) => {
    const assembled = Buffer.from(content, "utf8");
    const checksum = createHash("sha256").update(assembled).digest();
    for (let poll = 0; poll < 50; poll += 1) {
      const outcome = await exchange.processImport({ assembled, checksum, filename: `${FILE}${name}.xml`, kind: "catalog", source: "one_c_secondary" });
      if (outcome.kind === "success") return;
      if (outcome.kind === "failure") throw new Error(outcome.reason);
    }
    throw new Error("the import did not finish");
  };
  const clean = async () => {
    await database.query("DELETE FROM app.products WHERE one_c_source = 'one_c_secondary' AND name LIKE $1", [`%${WORD}%`]);
    await database.query("DELETE FROM app.one_c_exchange_runs WHERE filename LIKE $1", [`${FILE}%`]);
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    const cache = new CatalogCategoryTreeCache();
    storefront = new CatalogPublicService(cache, database, new ProductPhotoStorage({ name: "local" } as never));
    exchange = new OneCExchangeService(cache, database, new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await database?.onModuleDestroy();
  });

  it("shows each product once after the same goods come again under new ids", async () => {
    await load("trial", xml(["code-1", "code-2", "code-3", "code-4"], false, "2026-11-23T10:00:00"));
    expect(await visible()).toHaveLength(4);

    await load("real", xml(["guid-1", "guid-2", "guid-3", "guid-4"], false, "2026-11-23T11:00:00"));

    expect(await visible()).toEqual([1, 2, 3, 4].map((n) => `Фильтр ${WORD} ${n}`));
    const rows = (await database.query<{ active: boolean; n: string }>(
      "SELECT is_active AS active, count(*)::text AS n FROM app.products WHERE one_c_source = 'one_c_secondary' AND name LIKE $1 GROUP BY 1 ORDER BY 1", [`%${WORD}%`],
    )).rows;
    expect(rows).toEqual([{ active: false, n: "4" }, { active: true, n: "4" }]);
  });

  it("hides nothing when 1С sends only what has changed", async () => {
    await load("changes", xml(["guid-5"], true, "2026-11-23T12:00:00"));
    expect(await visible()).toHaveLength(5);
  });

  it("hides nothing when a full file names fewer than half of the products: a cut-off export must not empty the shop", async () => {
    await load("cut-off", xml(["guid-1", "guid-2"], false, "2026-11-23T13:00:00"));
    expect(await visible()).toHaveLength(5);
  });
});
