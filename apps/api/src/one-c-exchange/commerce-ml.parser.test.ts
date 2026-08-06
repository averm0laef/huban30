import { describe, expect, it } from "vitest";

import {
  CommerceMlParseError,
  parseImportXml,
  parseMoneyToKopeks,
  parseOffersXml,
} from "./commerce-ml.parser.js";

// Modelled on the real CommerceML 2 shape 1C actually exports (nested
// Классификатор/Группы, Товар with Ид/Наименование/Артикул/Изготовитель/
// Группы/ЗначенияСвойств), not a simplified shape invented for convenience —
// this project has previously shipped fixtures that encoded the same mistake
// as the code they tested.
const DEEP_CATEGORY_IMPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="2026-08-06T03:00:00" СодержитТолькоИзменения="false">
  <Классификатор>
    <Ид>classifier-1</Ид>
    <Наименование>АН-30</Наименование>
    <Группы>
      <Группа>
        <Ид>g-brakes</Ид>
        <Наименование>Тормозная система</Наименование>
        <Группы>
          <Группа>
            <Ид>g-pads</Ид>
            <Наименование>Колодки</Наименование>
            <Группы>
              <Группа>
                <Ид>g-pads-front</Ид>
                <Наименование>Передние</Наименование>
              </Группа>
            </Группы>
          </Группа>
        </Группы>
      </Группа>
      <Группа>
        <Ид>g-filters</Ид>
        <Наименование>Фильтры</Наименование>
      </Группа>
    </Группы>
  </Классификатор>
  <Каталог>
    <Ид>catalog-1</Ид>
    <Товары>
      <Товар>
        <Ид>product-1</Ид>
        <Наименование>Колодки тормозные передние</Наименование>
        <Артикул>W914/2</Артикул>
        <Изготовитель>ATE</Изготовитель>
        <Группы>
          <Ид>g-pads-front</Ид>
        </Группы>
        <ЗначенияСвойств>
          <ЗначениеСвойства>
            <Ид>fitment</Ид>
            <Значение>передняя ось</Значение>
          </ЗначениеСвойства>
        </ЗначенияСвойств>
      </Товар>
      <Товар>
        <Ид>product-2</Ид>
        <Наименование>Фильтр масляный</Наименование>
        <Артикул>OF-1</Артикул>
        <Изготовитель>MANN</Изготовитель>
        <Группы>
          <Ид>g-filters</Ид>
        </Группы>
      </Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;

const OFFERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="2026-08-06T04:00:00" СодержитТолькоИзменения="true">
  <ПакетПредложений>
    <Ид>offers-1</Ид>
    <Предложения>
      <Предложение>
        <Ид>product-1</Ид>
        <Артикул>W914/2</Артикул>
        <Цены>
          <Цена>
            <ЦенаЗаЕдиницу>1250.50</ЦенаЗаЕдиницу>
            <Валюта>руб</Валюта>
          </Цена>
        </Цены>
        <Количество>14</Количество>
      </Предложение>
      <Предложение>
        <Ид>product-2</Ид>
        <Артикул>OF-1</Артикул>
        <Цены>
          <Цена>
            <ЦенаЗаЕдиницу>560</ЦенаЗаЕдиницу>
          </Цена>
        </Цены>
        <Количество>3</Количество>
      </Предложение>
      <Предложение>
        <Ид>product-broken-price</Ид>
        <Цены>
          <Цена>
            <ЦенаЗаЕдиницу>12.5.6</ЦенаЗаЕдиницу>
          </Цена>
        </Цены>
        <Количество>7</Количество>
      </Предложение>
    </Предложения>
  </ПакетПредложений>
</КоммерческаяИнформация>`;

describe("parseMoneyToKopeks", () => {
  it("parses a clean decimal amount by string arithmetic", () => {
    expect(parseMoneyToKopeks("1250.50")).toBe(125_050);
    expect(parseMoneyToKopeks("99")).toBe(9_900);
    expect(parseMoneyToKopeks("  1.5 ")).toBe(150);
  });

  it("rejects anything malformed rather than rounding or coercing it", () => {
    expect(parseMoneyToKopeks("12.5.6")).toBeNull();
    expect(parseMoneyToKopeks("1250,50")).toBeNull();
    expect(parseMoneyToKopeks("abc")).toBeNull();
    expect(parseMoneyToKopeks("-5")).toBeNull();
    expect(parseMoneyToKopeks("0")).toBeNull();
    expect(parseMoneyToKopeks("1.999")).toBeNull();
  });
});

describe("parseImportXml", () => {
  it("walks an arbitrarily deep category tree and preserves parent links", () => {
    const result = parseImportXml(DEEP_CATEGORY_IMPORT_XML);
    const categories = result.headerRows.filter((row) => row.entityType === "category");
    expect(categories).toHaveLength(4);
    const byId = new Map(categories.map((row) => [row.entityType === "category" ? row.externalId : "", row]));
    expect(byId.get("g-brakes")?.parentExternalId).toBeNull();
    expect(byId.get("g-pads")?.parentExternalId).toBe("g-brakes");
    expect(byId.get("g-pads-front")?.parentExternalId).toBe("g-pads");
    expect(byId.get("g-filters")?.parentExternalId).toBeNull();
  });

  it("maps Ид/Наименование/Артикул/Изготовитель/Группы and synthesises a brand row", () => {
    const result = parseImportXml(DEEP_CATEGORY_IMPORT_XML);
    const products = result.bodyRows.filter((row) => row.entityType === "product");
    expect(products).toHaveLength(2);
    const pads = products.find((row) => row.entityType === "product" && row.externalId === "product-1");
    expect(pads).toMatchObject({
      categoryExternalId: "g-pads-front",
      externalId: "product-1",
      name: "Колодки тормозные передние",
      sku: "W914/2",
    });
    expect(pads?.entityType === "product" ? pads.attributes : null).toEqual({ fitment: "передняя ось" });
    const brands = result.headerRows.filter((row) => row.entityType === "brand");
    expect(brands.map((row) => row.entityType === "brand" ? row.name : "")).toEqual(
      expect.arrayContaining(["ATE", "MANN"]),
    );
    // Two different manufacturers must never collapse onto the same brand row.
    expect(new Set(brands.map((row) => row.entityType === "brand" ? row.externalId : "")).size).toBe(2);
    expect(result.productExternalIds).toEqual(["product-1", "product-2"]);
  });

  it("reads СодержитТолькоИзменения=false as a full snapshot", () => {
    expect(parseImportXml(DEEP_CATEGORY_IMPORT_XML).containsOnlyChanges).toBe(false);
  });

  it("treats a missing or non-'false' СодержитТолькоИзменения as a delta by default", () => {
    const withoutFlag = DEEP_CATEGORY_IMPORT_XML.replace(' СодержитТолькоИзменения="false"', "");
    expect(parseImportXml(withoutFlag).containsOnlyChanges).toBe(true);
    const garbled = DEEP_CATEGORY_IMPORT_XML.replace('СодержитТолькоИзменения="false"', 'СодержитТолькоИзменения="maybe"');
    expect(parseImportXml(garbled).containsOnlyChanges).toBe(true);
  });

  it("never lets a corrupt file reach the catalog", () => {
    expect(() => parseImportXml("<КоммерческаяИнформация><Открыт")).toThrow(CommerceMlParseError);
    expect(() => parseImportXml("<НеТоЧтоНадо></НеТоЧтоНадо>")).toThrow(CommerceMlParseError);
    expect(() => parseImportXml("")).toThrow(CommerceMlParseError);
  });

  it("drops a single product missing a required field instead of failing the whole file", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация>
  <Каталог>
    <Товары>
      <Товар>
        <Ид>ok-product</Ид>
        <Наименование>Годный товар</Наименование>
        <Артикул>OK-1</Артикул>
      </Товар>
      <Товар>
        <Ид>broken-product</Ид>
        <Артикул>BROKEN-1</Артикул>
      </Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
    const result = parseImportXml(xml);
    expect(result.productExternalIds).toEqual(["ok-product"]);
    expect(result.bodyRows).toHaveLength(1);
  });

  it("drops a single group missing a required field instead of failing the whole file, keeping its siblings", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация>
  <Классификатор>
    <Группы>
      <Группа>
        <Наименование>Без Ид, будет пропущена</Наименование>
      </Группа>
      <Группа>
        <Ид>ok-group</Ид>
        <Наименование>Годная группа</Наименование>
      </Группа>
    </Группы>
  </Классификатор>
</КоммерческаяИнформация>`;
    const result = parseImportXml(xml);
    const categories = result.headerRows.filter((row) => row.entityType === "category");
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({ externalId: "ok-group" });
  });
});

describe("parseOffersXml", () => {
  it("parses several offers into price + stock rows against the one synthetic warehouse", () => {
    const result = parseOffersXml(OFFERS_XML);
    const prices = result.bodyRows.filter((row) => row.entityType === "price");
    const stocks = result.bodyRows.filter((row) => row.entityType === "stock");
    expect(prices).toHaveLength(2); // the broken-price offer's price row is dropped
    expect(stocks).toHaveLength(3); // its stock row (Количество was well-formed) still comes through
    expect(prices.find((row) => row.entityType === "price" && row.productExternalId === "product-1"))
      .toMatchObject({ amountKopeks: 125_050, currency: "RUB" });
    expect(stocks.find((row) => row.entityType === "stock" && row.productExternalId === "product-1"))
      .toMatchObject({ quantityOnHand: 14 });
    expect(result.headerRows).toHaveLength(1);
    expect(result.headerRows[0]).toMatchObject({ code: "1C", entityType: "warehouse" });
  });

  it("reads СодержитТолькоИзменения=true as a delta", () => {
    expect(parseOffersXml(OFFERS_XML).containsOnlyChanges).toBe(true);
  });
});
