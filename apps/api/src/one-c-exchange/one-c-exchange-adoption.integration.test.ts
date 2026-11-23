// Real-database check: the first exchange from 1С takes over the products a list export loaded under their 1С codes
// (1С itself names products by its own identifiers) instead of adding the catalogue again and hiding the loaded one.
// Skipped unless CATALOG_SEARCH_DATABASE_URL points at a scratch database (see catalog/catalog-search-regression.test.ts).
// Runs on the second 1С base, so the "at least half of the live products" guard counts only this file's products.

import { createHash } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CatalogCategoryTreeCache } from "../catalog/catalog-category-tree-cache.service.js";
import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { OneCExchangeService } from "./one-c-exchange.service.js";
import type { OneCSource } from "./one-c-source.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;
const WORD = "пробапривязки";
const FILE = "itadopt-";

interface Item { article?: string; code?: string; codeAsRequisite?: boolean; id: string; name: string }

const xml = (items: Item[], onlyChanges: boolean, stamp: string) => `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="${stamp}">
  <Классификатор><Ид>itadopt</Ид><Наименование>Классификатор</Наименование></Классификатор>
  <Каталог СодержитТолькоИзменения="${onlyChanges}"><Ид>itadopt-cat</Ид><Товары>
${items.map((item) => `<Товар><Ид>${item.id}</Ид>${item.article ? `<Артикул>${item.article}</Артикул>` : ""}${
    item.code && !item.codeAsRequisite ? `<Код>${item.code}</Код>` : ""}<Наименование>${item.name} ${WORD}</Наименование>${
    item.code && item.codeAsRequisite
      ? `<ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>Код</Наименование><Значение>${item.code}</Значение></ЗначениеРеквизита></ЗначенияРеквизитов>`
      : ""}</Товар>`).join("\n")}
  </Товары></Каталог>
</КоммерческаяИнформация>`;

/** What a list export gives the trial upload: the 1С code stands for the identifier too. */
const loadedByCode = (codes: number[], article: (n: number) => string | undefined = (n) => `PR-${n}`): Item[] =>
  codes.map((n) => ({ article: article(n), code: `00-0000${n}`, id: `00-0000${n}`, name: `Сальник ${n}` }));

describe.skipIf(!url)("the first exchange from 1С takes over products loaded under their 1С codes (real PostgreSQL)", () => {
  let database: DatabaseService;
  let exchange: OneCExchangeService;
  let stamp = 0;

  const load = async (name: string, items: Item[], options: { onlyChanges?: boolean; source?: OneCSource } = {}) => {
    stamp += 1;
    const assembled = Buffer.from(xml(items, options.onlyChanges ?? false, `2026-11-23T10:00:${String(stamp).padStart(2, "0")}`), "utf8");
    const checksum = createHash("sha256").update(assembled).digest();
    for (let poll = 0; poll < 50; poll += 1) {
      const outcome = await exchange.processImport({
        assembled, checksum, filename: `${FILE}${name}-${stamp}.xml`, kind: "catalog", source: options.source ?? "one_c_secondary",
      });
      if (outcome.kind === "success") return;
      if (outcome.kind === "failure") throw new Error(outcome.reason);
    }
    throw new Error("the import did not finish");
  };
  /** The products of this test as the site keeps them, in the order of their names. */
  const products = async () => (await database.query<{
    active: boolean; id: string; name: string; pinned: boolean; sku: string; slug: string;
  }>(
    `SELECT id::text, sku::text, replace(name, $2, '') AS name, slug::text, is_active AS active, category_pinned AS pinned
     FROM app.products WHERE name LIKE $1 ORDER BY name, created_at`, [`%${WORD}%`, ` ${WORD}`],
  )).rows;
  const journal = async (name: string) => (await database.query<{ adopted: number; hidden: number; touched: number }>(
    `SELECT products_adopted AS adopted, products_hidden AS hidden, rows_touched AS touched
     FROM app.one_c_exchange_runs WHERE filename LIKE $1`, [`${FILE}${name}-%`],
  )).rows[0];
  const clean = async () => {
    await database.query("DELETE FROM app.products WHERE name LIKE $1", [`%${WORD}%`]);
    await database.query("DELETE FROM app.one_c_exchange_runs WHERE filename LIKE $1", [`${FILE}%`]);
  };

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    exchange = new OneCExchangeService(
      new CatalogCategoryTreeCache(), database,
      new OneCIntegrationService(undefined as never, database, undefined as never, undefined as never),
    );
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await database?.onModuleDestroy();
  });

  it("keeps every product in its row, at its address and in the section staff chose, when 1С names it by its own identifier and its code", async () => {
    await load("list", loadedByCode([1, 2, 3, 4], (n) => n === 4 ? undefined : `PR-${n}`));
    const before = await products();
    expect(before.map((row) => row.sku)).toEqual(["PR-1", "PR-2", "PR-3", "00-00004"]);
    await database.query("UPDATE app.products SET category_pinned = true WHERE id = $1", [before[1]?.id]);

    await load("first", [1, 2, 3, 4].map((n) => ({
      article: n === 4 ? undefined : `PR-${n}`, code: `00-0000${n}`, codeAsRequisite: n === 2, id: `guid-${n}`, name: `Сальник ${n}`,
    })));

    const after = await products();
    expect(after.map(({ active, id, name, sku, slug }) => ({ active, id, name, sku, slug })))
      .toEqual(before.map(({ id, name, sku, slug }) => ({ active: true, id, name, sku, slug })));
    expect(after[1]?.pinned).toBe(true);
    // Nothing about the products changed, so nothing is rewritten; nothing is hidden either.
    expect(await journal("first")).toEqual({ adopted: 4, hidden: 0, touched: 0 });

    // The next exchange knows them by the identifier of 1С and takes nothing over again.
    await load("second", [1, 2, 3, 4].map((n) => ({
      article: n === 4 ? undefined : `PR-${n}`, code: `00-0000${n}`, id: `guid-${n}`, name: `Сальник ${n}`,
    })));
    expect((await products()).map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(await journal("second")).toEqual({ adopted: 0, hidden: 0, touched: 0 });
  });

  it("hides the loaded products 1С does not have and adds the ones the list did not have", async () => {
    await load("list", loadedByCode([1, 2, 3, 4]));
    const before = await products();

    await load("first", [1, 2, 3, 5].map((n) => ({ article: `PR-${n}`, code: `00-0000${n}`, id: `guid-${n}`, name: `Сальник ${n}` })));

    const after = await products();
    expect(after.map((row) => [row.name, row.active])).toEqual([
      ["Сальник 1", true], ["Сальник 2", true], ["Сальник 3", true], ["Сальник 4", false], ["Сальник 5", true],
    ]);
    expect(after.slice(0, 4).map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(await journal("first")).toEqual({ adopted: 3, hidden: 1, touched: 1 });
  });

  it("keeps the former address answering when 1С renamed the product meanwhile", async () => {
    await load("list", loadedByCode([1, 2]));
    const before = await products();

    await load("first", [
      { article: "PR-1", code: "00-00001", id: "guid-1", name: "Сальник 1 усиленный" },
      { article: "PR-2", code: "00-00002", id: "guid-2", name: "Сальник 2" },
    ]);

    const after = await products();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after[0]?.slug).not.toBe(before[0]?.slug);
    expect(after[1]?.slug).toBe(before[1]?.slug);
    const former = await database.query<{ product_id: string }>(
      "SELECT product_id::text FROM app.product_slug_history WHERE slug = $1", [before[0]?.slug],
    );
    expect(former.rows).toEqual([{ product_id: before[0]?.id }]);
  });

  it("takes products over by their code when 1С sends only what has changed, in the main base too", async () => {
    await load("list", loadedByCode([1, 2]), { onlyChanges: true, source: "one_c" });
    const before = await products();

    await load("changes", [{ article: "PR-2", code: "00-00002", id: "guid-2", name: "Сальник 2" }], { onlyChanges: true, source: "one_c" });

    expect((await products()).map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(await journal("changes")).toEqual({ adopted: 1, hidden: 0, touched: 0 });
  });

  it("recognises products by article and name when the file of 1С carries no code", async () => {
    // Two loaded products share an article and a name: the file cannot say which of them is which.
    await load("list", [...loadedByCode([1, 2]), { article: "PR-9", code: "00-00008", id: "00-00008", name: "Сальник 9" },
      { article: "PR-9", code: "00-00009", id: "00-00009", name: "Сальник 9" }]);
    const before = await products();

    await load("first", [
      { article: "PR-1", id: "guid-1", name: "Сальник 1" }, { article: "PR-2", id: "guid-2", name: "Сальник 2" },
      { article: "PR-9", id: "guid-8", name: "Сальник 9" }, { article: "PR-9", id: "guid-9", name: "Сальник 9" },
    ]);

    const after = await products();
    expect(after.filter((row) => row.active).slice(0, 2).map((row) => row.id)).toEqual(before.slice(0, 2).map((row) => row.id));
    // The pair that cannot be told apart is replaced the old way: the loaded two are hidden, the two of 1С added.
    expect(after.filter((row) => row.name === "Сальник 9").map((row) => row.active).sort()).toEqual([false, false, true, true]);
    expect(await journal("first")).toEqual({ adopted: 2, hidden: 2, touched: 2 });
  });

  it("does not guess by name when the file carries only changes: a product it does not name is not gone from 1С", async () => {
    await load("list", loadedByCode([1, 2]));

    await load("changes", [{ article: "PR-1", id: "guid-1", name: "Сальник 1" }], { onlyChanges: true });

    expect((await products()).map((row) => row.name)).toEqual(["Сальник 1", "Сальник 1", "Сальник 2"]);
    expect(await journal("changes")).toEqual({ adopted: 0, hidden: 0, touched: 1 });
  });
});
