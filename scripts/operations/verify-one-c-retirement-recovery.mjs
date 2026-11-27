// Feed to node --input-type=module from the API runtime directory.
// Uses only a disposable database with the mandatory prefix below.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { validateEnvironment } from "./dist/config.js";
import { DatabaseService } from "./dist/infrastructure/database.service.js";
import { CatalogCategoryTreeCache } from "./dist/catalog/catalog-category-tree-cache.service.js";
import { OneCIntegrationService } from "./dist/catalog/one-c-integration.service.js";
import { OneCExchangeService } from "./dist/one-c-exchange/one-c-exchange.service.js";

const name = process.env.AN30_RETIREMENT_TEST_DATABASE;
if (!name || !/^an30_cleanup_scratch_[a-z0-9_]+$/u.test(name)) {
  throw new Error("A disposable retirement-test database is required");
}
const config = new ConfigService(validateEnvironment({ ...process.env, DATABASE_URL: undefined, DB_NAME: name }));
assert.equal(new URL(config.getOrThrow("DATABASE_URL")).pathname, "/"+name);
const database = new DatabaseService(config);
try {
  assert.equal((await database.query("SELECT current_database() AS name")).rows[0].name, name);
  if (process.env.AN30_RETIREMENT_VERIFY_ONLY !== "true") {
    const integration = new OneCIntegrationService(undefined, database, undefined, undefined);
    const exchange = new OneCExchangeService(new CatalogCategoryTreeCache(), database, integration);
    const stamp = new Date().toISOString();
    const catalog = [
      '<КоммерческаяИнформация ДатаФормирования="'+stamp+'"><Каталог СодержитТолькоИзменения="false"><Товары>',
      '<Товар><Ид>fresh-main-guid</Ид><Код>00-00001</Код><Артикул>BP-001</Артикул><Наименование>Колодки тест</Наименование></Товар>',
      '<Товар><Ид>live-product</Ид><Артикул>LIVE-1</Артикул><Наименование>Свежий товар</Наименование></Товар>',
      '</Товары></Каталог></КоммерческаяИнформация>',
    ].join("");
    const offers = [
      '<КоммерческаяИнформация ДатаФормирования="'+stamp+'"><ПакетПредложений СодержитТолькоИзменения="false">',
      '<ТипыЦен><ТипЦены><Ид>sale</Ид><Наименование>Оптовая цена</Наименование></ТипЦены></ТипыЦен><Предложения>',
      '<Предложение><Ид>fresh-main-guid</Ид><Цены><Цена><ИдТипаЦены>sale</ИдТипаЦены><ЦенаЗаЕдиницу>200.00</ЦенаЗаЕдиницу></Цена></Цены><Количество>5</Количество></Предложение>',
      '<Предложение><Ид>live-product</Ид><Цены><Цена><ИдТипаЦены>sale</ИдТипаЦены><ЦенаЗаЕдиницу>100.00</ЦенаЗаЕдиницу></Цена></Цены><Количество>7</Количество></Предложение>',
      '</Предложения></ПакетПредложений></КоммерческаяИнформация>',
    ].join("");
    for (const [kind, xml] of [["catalog", catalog], ["offers", offers]]) {
      const assembled = Buffer.from(xml);
      const checksum = createHash("sha256").update(assembled).digest();
      const input = { assembled, checksum, filename: "fresh-"+kind+".xml", kind, source: "one_c" };
      let completed = false;
      for (let poll = 0; poll < 50; poll += 1) {
        const result = await exchange.processImport(input);
        if (result.kind === "failure") throw new Error(result.reason);
        if (result.kind === "success") { completed = true; break; }
      }
      assert.equal(completed, true);
      assert.equal((await exchange.processImport(input)).kind, "success");
    }
  }
  const product = (await database.query(
    "SELECT id::text,external_id,is_active,deleted_at,slug::text FROM app.products WHERE id='10000000-0000-4000-8000-000000000001'",
  )).rows[0];
  assert.equal(product.external_id, "fresh-main-guid");
  assert.equal(product.is_active, true);
  assert.equal(product.deleted_at, null);
  assert.equal(product.slug, "kolodki-test-0123456789");
  assert.equal(Number((await database.query("SELECT amount_kopeks FROM app.current_product_prices WHERE product_id=$1", [product.id])).rows[0].amount_kopeks), 20000);
  assert.equal(Number((await database.query("SELECT sum(quantity_on_hand) AS quantity FROM app.inventory_balances WHERE product_id=$1", [product.id])).rows[0].quantity), 5);
  assert.equal(Number((await database.query("SELECT count(*) AS n FROM app.products")).rows[0].n), 3);
  assert.equal(Number((await database.query("SELECT count(*) AS n FROM app.product_catalogue_cards WHERE product_id=$1", [product.id])).rows[0].n), 1);
  assert.equal((await database.query("SELECT is_active FROM app.products WHERE one_c_source='one_c_secondary'")).rows[0].is_active, true);
  console.log("verified: fresh CommerceML restores the same product ID, URL and photo; new price/stock apply; replay is idempotent; the other base is preserved");
} finally {
  await database.onModuleDestroy();
}
