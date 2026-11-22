// Real-database check of the hidden shelf (HIDDEN_CATEGORY_SLUG): what a
// customer sees after staff point a 1С group at «Не показывать на сайте».
// Skipped unless CATALOG_SEARCH_DATABASE_URL points at a scratch database --
// see catalog-search-regression.test.ts for how to prepare one.

import { createHash } from "node:crypto";

import { NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { OneCExchangeService } from "../one-c-exchange/one-c-exchange.service.js";
import { TecdocService } from "../tecdoc/tecdoc.service.js";
import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { HIDDEN_CATEGORY_LABEL, HIDDEN_CATEGORY_SLUG } from "./catalog-known-categories.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { CatalogRecategorizeService } from "./catalog-recategorize.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

/** Everything this file creates carries this prefix, so it can be removed without touching other fixtures. */
const PREFIX = "ithidden-";
const WORKSHOP_GROUP = `${PREFIX}sto`;
const SERVICE_NAME = "Замена топл фильтра";
const PART_NAME = "Фильтр масляный MANN W914/2";

/** The owner's base keeps the workshop's price list in the same 1С list as parts: a service in the group «СТО» and a part. */
const IMPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-11-22T14:00:00">
  <Классификатор><Ид>${PREFIX}classifier</Ид><Наименование>Классификатор</Наименование>
    <Группы><Группа><Ид>${WORKSHOP_GROUP}</Ид><Наименование>СТО</Наименование></Группа></Группы>
  </Классификатор>
  <Каталог СодержитТолькоИзменения="true">
    <Ид>${PREFIX}catalog</Ид>
    <Товары>
      <Товар><Ид>${PREFIX}service</Ид><Артикул>${PREFIX}SRV-1</Артикул><Наименование>${SERVICE_NAME}</Наименование><Группы><Ид>${WORKSHOP_GROUP}</Ид></Группы></Товар>
      <Товар><Ид>${PREFIX}part</Ид><Артикул>${PREFIX}W914</Артикул><Наименование>${PART_NAME}</Наименование></Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;

describe.skipIf(!url)("the hidden shelf (real PostgreSQL)", () => {
  let database: DatabaseService;
  let storefront: CatalogPublicService;
  let sorting: CatalogRecategorizeService;
  let staff: AuthContext;

  const publicNames = async (query: string) => (await storefront.products({ limit: "24", q: query })).items.map((item) => item.name);
  const slugOf = async (externalId: string) => (await database.query<{ slug: string }>(
    "SELECT slug::text AS slug FROM app.products WHERE external_id = $1", [externalId],
  )).rows[0]!.slug;
  const hideWorkshopGroup = () => sorting.setGroupMapping(
    { categorySlug: HIDDEN_CATEGORY_SLUG, groupExternalId: WORKSHOP_GROUP, source: "one_c" }, staff,
  );

  async function removeEverythingThisFileCreated(): Promise<void> {
    await database.query(
      "DELETE FROM app.product_prices WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)", [`${PREFIX}%`],
    );
    await database.query("DELETE FROM app.products WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.brands WHERE external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.one_c_group_mappings WHERE group_external_id LIKE $1", [`${PREFIX}%`]);
    await database.query("DELETE FROM app.one_c_exchange_runs WHERE filename LIKE $1", [`${PREFIX}%`]);
  }

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    const cache = new CatalogCategoryTreeCache();
    storefront = new CatalogPublicService(cache, database, {
      name: "local", read: async () => Buffer.alloc(0), remove: async () => undefined, store: async () => undefined,
    } as never);
    sorting = new CatalogRecategorizeService(database, undefined, cache);
    // A group mapping records who made it; the staff member stays in the scratch database between runs.
    const email = `${PREFIX}staff@an30.local`;
    const existing = await database.query<{ id: string }>("SELECT id FROM app.users WHERE email = $1", [email]);
    const userId = existing.rows[0]?.id
      ?? (await database.query<{ id: string }>("INSERT INTO app.users (email) VALUES ($1) RETURNING id", [email])).rows[0]!.id;
    staff = { role: "admin", userId } as AuthContext;
  });

  beforeEach(async () => {
    await removeEverythingThisFileCreated();
    const exchange = new OneCExchangeService(
      new CatalogCategoryTreeCache(), database,
      new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never),
    );
    const assembled = Buffer.from(IMPORT_XML, "utf8");
    const checksum = createHash("sha256").update(assembled).digest();
    for (let poll = 0; poll < 50; poll += 1) {
      const outcome = await exchange.processImport({ assembled, checksum, filename: `${PREFIX}import.xml`, kind: "catalog" });
      if (outcome.kind === "success") return;
      if (outcome.kind === "failure") throw new Error(outcome.reason);
    }
    throw new Error("the import did not finish in 50 polls");
  });

  afterAll(async () => {
    await removeEverythingThisFileCreated();
    await database?.onModuleDestroy?.();
  });

  it("offers the hidden shelf among the sections staff can choose", () => {
    expect(sorting.sections()).toContainEqual({ label: HIDDEN_CATEGORY_LABEL, slug: HIDDEN_CATEGORY_SLUG });
  });

  it("hides the products of a 1С group from search once staff put the group on the hidden shelf", async () => {
    // Until then the service is public: its name reads like a filter.
    expect(await publicNames(SERVICE_NAME)).toContain(SERVICE_NAME);

    await hideWorkshopGroup();

    expect(await publicNames(SERVICE_NAME)).not.toContain(SERVICE_NAME);
  });

  it("answers «not found» for the page of a hidden product", async () => {
    await hideWorkshopGroup();

    await expect(storefront.product(await slugOf(`${PREFIX}service`))).rejects.toBeInstanceOf(NotFoundException);
  });

  it("still takes the price of a hidden product from 1С, without counting it as refused", async () => {
    await hideWorkshopGroup();
    // Price only: a stock row would write to app.inventory_events, an append-only ledger a test cannot clean up.
    const offers = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-11-22T14:30:00">
  <ПакетПредложений СодержитТолькоИзменения="true"><Ид>${PREFIX}offers</Ид>
    <ТипыЦен><ТипЦены><Ид>t-sell</Ид><Наименование>Оптовая цена</Наименование></ТипЦены></ТипыЦен>
    <Предложения><Предложение><Ид>${PREFIX}service</Ид><Цены>
      <Цена><ИдТипаЦены>t-sell</ИдТипаЦены><ЦенаЗаЕдиницу>500</ЦенаЗаЕдиницу><Валюта>RUB</Валюта></Цена>
    </Цены></Предложение></Предложения>
  </ПакетПредложений>
</КоммерческаяИнформация>`, "utf8");
    const exchange = new OneCExchangeService(
      new CatalogCategoryTreeCache(), database,
      new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never),
    );
    const checksum = createHash("sha256").update(offers).digest();
    for (let poll = 0; poll < 50; poll += 1) {
      const outcome = await exchange.processImport({ assembled: offers, checksum, filename: `${PREFIX}offers.xml`, kind: "offers" });
      if (outcome.kind !== "progress") break;
    }

    const run = await database.query<{ rows_rejected: number; status: string }>(
      "SELECT status, rows_rejected FROM app.one_c_exchange_runs WHERE filename = $1", [`${PREFIX}offers.xml`],
    );
    expect(run.rows).toEqual([{ rows_rejected: 0, status: "completed" }]);
  });

  it("does not answer a fitment question about a hidden product, nor spend a catalogue request on it", async () => {
    // A branded product with a real-looking number: without the hidden shelf the fitment lookup would go to TecDoc.
    const brand = await database.query<{ id: string }>(
      "INSERT INTO app.brands (external_id, name, slug) VALUES ($1, 'ITHIDDEN', $2) RETURNING id", [`${PREFIX}brand`, `${PREFIX}brand`],
    );
    const hidden = await database.query<{ id: string }>(
      "UPDATE app.products SET brand_id = $2 WHERE external_id = $1 RETURNING id", [`${PREFIX}service`, brand.rows[0]!.id],
    );
    await hideWorkshopGroup();
    const asked = vi.fn(async () => []);
    const tecdoc = new TecdocService({ enabled: true, get: asked } as never, undefined as never, database);

    const answer = await tecdoc.productFitment(hidden.rows[0]!.id, {}, { ip: "203.0.113.7" });

    expect(answer).toEqual({ status: "not_found" });
    expect(asked).not.toHaveBeenCalled();
  });

  it("leaves the shop's other products public", async () => {
    await hideWorkshopGroup();

    expect(await publicNames("W914")).toContain(PART_NAME);
  });
});
