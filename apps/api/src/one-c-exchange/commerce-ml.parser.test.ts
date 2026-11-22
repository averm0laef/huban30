import { describe, expect, it } from "vitest";

import {
  CommerceMlParseError,
  EXCHANGE_WAREHOUSE_EXTERNAL_ID,
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
<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="2026-08-06T03:00:00">
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
  <Каталог СодержитТолькоИзменения="false">
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
<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="2026-08-06T04:00:00">
  <ПакетПредложений СодержитТолькоИзменения="true">
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

  it("rejects anything malformed or zero", () => {
    expect(parseMoneyToKopeks("12.5.6")).toBeNull();
    expect(parseMoneyToKopeks("abc")).toBeNull();
    expect(parseMoneyToKopeks("-5")).toBeNull();
    expect(parseMoneyToKopeks("0")).toBeNull();
    expect(parseMoneyToKopeks("0,00")).toBeNull();
  });

  it("accepts the formats 1C really exports: comma, spaces, up to 4 decimals rounded half-up", () => {
    expect(parseMoneyToKopeks("1250,50")).toBe(125050);
    expect(parseMoneyToKopeks("1 250,50")).toBe(125050);
    expect(parseMoneyToKopeks("1\u00a0250.5")).toBe(125050);
    expect(parseMoneyToKopeks("1.999")).toBe(200);
    expect(parseMoneyToKopeks("1.994")).toBe(199);
    expect(parseMoneyToKopeks("99.9950")).toBe(10000);
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

  it("prefers the standard Каталог flag over a conflicting legacy root flag", () => {
    const xml = DEEP_CATEGORY_IMPORT_XML
      .replace("<КоммерческаяИнформация ", '<КоммерческаяИнформация СодержитТолькоИзменения="true" ');
    expect(parseImportXml(xml).containsOnlyChanges).toBe(false);
  });

  it("loads products that use the predefined Код requisite instead of Артикул", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация>
  <Каталог СодержитТолькоИзменения="true">
    <Товары>
      <Товар>
        <Ид>product-with-code</Ид>
        <Наименование>Товар без артикула</Наименование>
        <Артикул />
        <Описание>Полезное описание</Описание>
        <ЗначенияРеквизитов>
          <ЗначениеРеквизита><Наименование>Код</Наименование><Значение>00000000165</Значение></ЗначениеРеквизита>
        </ЗначенияРеквизитов>
      </Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
    const product = parseImportXml(xml).bodyRows.find((row) => row.entityType === "product");
    expect(product).toMatchObject({ sku: "00000000165" });
  });

  describe("<Описание>", () => {
    // In the owner's base this field holds stock-take notes and shelf numbers, not a text for customers.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация>
  <Каталог СодержитТолькоИзменения="true">
    <Товары>
      <Товар>
        <Ид>product-with-note</Ид>
        <Артикул>C9431</Артикул>
        <Наименование>Сайлентблок рычага подвески</Наименование>
        <Описание>аудит 27 03 2026 КОРОБКА 35</Описание>
      </Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
    const description = (options?: Parameters<typeof parseImportXml>[1]) => {
      const product = parseImportXml(xml, options).bodyRows.find((row) => row.entityType === "product");
      return product?.entityType === "product" ? product.description : undefined;
    };

    it("is dropped unless the caller asks to publish descriptions", () => {
      expect(description()).toBeNull();
    });

    it("is kept when the base is set to publish descriptions", () => {
      expect(description({ publishDescriptions: true })).toBe("аудит 27 03 2026 КОРОБКА 35");
    });
  });

  it("maps CommerceML deletion markers to inactive categories and products", () => {
    const xml = DEEP_CATEGORY_IMPORT_XML
      .replace("<Ид>g-filters</Ид>", "<Ид>g-filters</Ид><ПометкаУдаления>true</ПометкаУдаления>")
      .replace("<Ид>product-2</Ид>", "<Ид>product-2</Ид><ПометкаУдаления>true</ПометкаУдаления>");
    const result = parseImportXml(xml);
    expect(result.headerRows.find((row) => row.entityType === "category" && row.externalId === "g-filters"))
      .toMatchObject({ isActive: false });
    expect(result.bodyRows.find((row) => row.entityType === "product" && row.externalId === "product-2"))
      .toMatchObject({ isActive: false });
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

  it("never imports a non-RUB price as roubles", () => {
    const usd = OFFERS_XML.replace("<Валюта>руб</Валюта>", "<Валюта>USD</Валюта>");
    const prices = parseOffersXml(usd).bodyRows.filter((row) => row.entityType === "price");
    expect(prices.some((row) => row.entityType === "price" && row.productExternalId === "product-1")).toBe(false);
    expect(prices.some((row) => row.entityType === "price" && row.productExternalId === "product-2")).toBe(true);
  });

  it("prefers the standard ПакетПредложений flag over a conflicting root flag", () => {
    const xml = OFFERS_XML
      .replace("<КоммерческаяИнформация ", '<КоммерческаяИнформация СодержитТолькоИзменения="false" ');
    expect(parseOffersXml(xml).containsOnlyChanges).toBe(true);
  });
});

describe("parseOffersXml price types, warehouses and characteristics", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="2026-08-06T04:00:00">
  <ПакетПредложений СодержитТолькоИзменения="false">
    <Ид>offers-2</Ид>
    <ТипыЦен>
      <ТипЦены><Ид>wholesale</Ид><Наименование>Оптовая</Наименование></ТипЦены>
      <ТипЦены><Ид>retail</Ид><Наименование>Розничная</Наименование></ТипЦены>
    </ТипыЦен>
    <Предложения>
      <Предложение>
        <Ид>p-1</Ид>
        <Цены>
          <Цена><ИдТипаЦены>wholesale</ИдТипаЦены><ЦенаЗаЕдиницу>900</ЦенаЗаЕдиницу></Цена>
          <Цена><ИдТипаЦены>retail</ИдТипаЦены><ЦенаЗаЕдиницу>1 100,00</ЦенаЗаЕдиницу></Цена>
        </Цены>
        <Количество>3.000</Количество>
      </Предложение>
      <Предложение>
        <Ид>p-2#size-s</Ид>
        <Цены><Цена><ИдТипаЦены>retail</ИдТипаЦены><ЦенаЗаЕдиницу>500</ЦенаЗаЕдиницу></Цена></Цены>
        <Склад ИдСклада="a" КоличествоНаСкладе="2"/>
        <Склад ИдСклада="b" КоличествоНаСкладе="1"/>
      </Предложение>
      <Предложение>
        <Ид>p-2#size-m</Ид>
        <Цены><Цена><ИдТипаЦены>retail</ИдТипаЦены><ЦенаЗаЕдиницу>520</ЦенаЗаЕдиницу></Цена></Цены>
        <Количество>4</Количество>
      </Предложение>
      <Предложение>
        <Ид>p-3</Ид>
        <Цены><Цена><ИдТипаЦены>retail</ИдТипаЦены><ЦенаЗаЕдиницу>100</ЦенаЗаЕдиницу></Цена></Цены>
        <Количество>-2</Количество>
      </Предложение>
    </Предложения>
  </ПакетПредложений>
</КоммерческаяИнформация>`;

  it("takes the retail price, not the first listed one", () => {
    const price = parseOffersXml(xml).bodyRows.find((row) => row.entityType === "price" && row.productExternalId === "p-1");
    expect(price).toMatchObject({ amountKopeks: 110000 });
  });

  it("honours an explicitly configured price type", () => {
    const price = parseOffersXml(xml, { priceTypeName: "Оптовая" }).bodyRows
      .find((row) => row.entityType === "price" && row.productExternalId === "p-1");
    expect(price).toMatchObject({ amountKopeks: 90000 });
  });

  it("reads fractional, per-warehouse and negative stock and adds up characteristics", () => {
    const stock = new Map<string, number>();
    for (const row of parseOffersXml(xml).bodyRows) {
      if (row.entityType === "stock") stock.set(row.productExternalId, (stock.get(row.productExternalId) ?? 0) + row.quantityOnHand);
    }
    expect(stock.get("p-1")).toBe(3);
    expect(stock.get("p-2")).toBe(7);
    expect(stock.get("p-3")).toBe(0);
    expect(stock.has("p-2#size-s")).toBe(false);
  });

  it("keeps the per-warehouse split and still adds characteristics per warehouse", () => {
    const result = parseOffersXml(xml);
    const p2 = result.bodyRows.filter((row) => row.entityType === "stock" && row.productExternalId === "p-2");
    expect(p2).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityOnHand: 2, warehouseExternalId: "a" }),
      expect.objectContaining({ quantityOnHand: 1, warehouseExternalId: "b" }),
      // size-m only had a flat <Количество>: it stays on the synthetic warehouse.
      expect.objectContaining({ quantityOnHand: 4, warehouseExternalId: EXCHANGE_WAREHOUSE_EXTERNAL_ID }),
    ]));
    expect(result.headerRows.filter((row) => row.entityType === "warehouse").map((row) => row.externalId))
      .toEqual([EXCHANGE_WAREHOUSE_EXTERNAL_ID, "a", "b"]);
    expect(result.carriesStock).toBe(true);
  });
});

describe("parseImportXml product names", () => {
  // The owner's staff type notes for themselves into names in 1С. Everything on the site is derived from the stored
  // name — the order of a section, the search, the address of the product's page, the caption of its photo — so
  // the notes are taken out where the name enters the site, not only where it is shown.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08">
  <Каталог СодержитТолькоИзменения="true">
    <Товары>
      <Товар><Ид>p-clip</Ид><Артикул>KP-170</Артикул><Наименование>(Ш) +++ Клипса крепежная TORSO КОРОБКА 9</Наименование></Товар>
      <Товар><Ид>p-oil</Ид><Артикул>GZ-205</Артикул><Наименование>(15) В РОЗЛИВ Масло моторное Gazpromneft 10W-40</Наименование></Товар>
      <Товар><Ид>p-pads</Ид><Артикул>180.000088</Артикул><Наименование>(29088) Тормозные колодки дисковые MAN/DAF ROSTAR</Наименование></Товар>
      <Товар><Ид>p-note</Ид><Артикул>00-001</Артикул><Наименование>АУДИТ 17.07.2025</Наименование></Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
  const product = (externalId: string) => {
    const row = parseImportXml(xml).bodyRows.find((candidate) => candidate.entityType === "product" && candidate.externalId === externalId);
    if (row?.entityType !== "product") throw new Error(`no product ${externalId}`);
    return row;
  };

  it("stores a name without the staff's notes typed into it", () => {
    expect(product("p-clip").name).toBe("Клипса крепежная TORSO");
    expect(product("p-oil").name).toBe("В РОЗЛИВ Масло моторное Gazpromneft 10W-40");
  });

  it("builds the page address and the search text from the name without the notes", () => {
    expect(product("p-clip").slug).toMatch(/^klipsa-krepezhnaya-torso-[0-9a-f]+$/u);
    expect(product("p-clip").searchText).toBe("KP-170 Клипса крепежная TORSO");
  });

  it("keeps a part number in brackets and a name that is nothing but a note", () => {
    expect(product("p-pads").name).toBe("(29088) Тормозные колодки дисковые MAN/DAF ROSTAR");
    expect(product("p-note").name).toBe("АУДИТ 17.07.2025");
  });
});

describe("parseImportXml search text", () => {
  // Names in the owner's base are typed with shorthand and with Latin letters that look like Russian ones; the
  // search compares a query with the text below, so the words such a name is read by are added to it.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08">
  <Каталог СодержитТолькоИзменения="true">
    <Товары>
      <Товар><Ид>p-seal</Ид><Артикул>90311-34022</Артикул><Наименование>Cальник привода FR TY NCP1#</Наименование></Товар>
      <Товар><Ид>p-scent</Ид><Артикул>AU-1</Артикул><Наименование>Аром-р AURA FRESH CAR GEL Black Ice</Наименование></Товар>
      <Товар><Ид>p-plain</Ид><Артикул>W 914/2</Артикул><Наименование>Фильтр масляный MANN</Наименование></Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;
  const searchTextOf = (externalId: string) => {
    const row = parseImportXml(xml).bodyRows.find((candidate) => candidate.entityType === "product" && candidate.externalId === externalId);
    return row?.entityType === "product" ? row.searchText : undefined;
  };

  it("adds the Russian word a name with a Latin look-alike letter is read by", () => {
    expect(searchTextOf("p-seal")).toBe("90311-34022 Cальник привода FR TY NCP1# сальник");
  });

  it("adds the word 1С shorthand stands for", () => {
    expect(searchTextOf("p-scent")).toBe("AU-1 Аром-р AURA FRESH CAR GEL Black Ice ароматизатор");
  });

  it("leaves a name that is written as it is read as it was", () => {
    expect(searchTextOf("p-plain")).toBe("W 914/2 Фильтр масляный MANN");
  });

  it("does not change the name itself", () => {
    expect(parseImportXml(xml).bodyRows.find((row) => row.entityType === "product" && row.externalId === "p-seal"))
      .toMatchObject({ name: "Cальник привода FR TY NCP1#" });
  });
});

describe("parseImportXml properties, brands, vehicle data and photos", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08">
  <Классификатор>
    <Свойства>
      <Свойство>
        <Ид>prop-brand</Ид><Наименование>Производитель</Наименование><ТипЗначений>Справочник</ТипЗначений>
        <ВариантыЗначений><Справочник><ИдЗначения>v-bosch</ИдЗначения><Значение>BOSCH</Значение></Справочник></ВариантыЗначений>
      </Свойство>
      <Свойство>
        <Ид>prop-make</Ид><Наименование>Марка автомобиля</Наименование><ТипЗначений>Справочник</ТипЗначений>
        <ВариантыЗначений><Справочник><ИдЗначения>v-toyota</ИдЗначения><Значение>Toyota</Значение></Справочник></ВариантыЗначений>
      </Свойство>
      <Свойство><Ид>prop-appl</Ид><Наименование>Применяемость</Наименование><ТипЗначений>Строка</ТипЗначений></Свойство>
    </Свойства>
    <Склады><Склад><Ид>wh-1</Ид><Наименование>Склад на Ленина</Наименование></Склад></Склады>
  </Классификатор>
  <Каталог СодержитТолькоИзменения="true">
    <Товары>
      <Товар>
        <Ид>p-1</Ид><Артикул>0 986 452 041</Артикул><Наименование>Фильтр масляный</Наименование>
        <Картинка>import_files/ab/p-1.jpg</Картинка>
        <Картинка>import_files/ab/../../etc/passwd</Картинка>
        <ЗначенияСвойств>
          <ЗначениеСвойства><Ид>prop-brand</Ид><Значение>v-bosch</Значение></ЗначениеСвойства>
          <ЗначениеСвойства><Ид>prop-make</Ид><Значение>v-toyota</Значение></ЗначениеСвойства>
          <ЗначениеСвойства><Ид>prop-appl</Ид><Значение>Camry V40</Значение></ЗначениеСвойства>
        </ЗначенияСвойств>
      </Товар>
      <Товар Статус="Удален"><Ид>p-2</Ид><Артикул>X-2</Артикул><Наименование>Снят</Наименование></Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;

  it("takes the brand from a Производитель property and resolves reference values to text", () => {
    const result = parseImportXml(xml);
    const product = result.bodyRows.find((row) => row.entityType === "product" && row.externalId === "p-1");
    expect(product).toMatchObject({
      attributes: { "Марка автомобиля": "Toyota", "Применяемость": "Camry V40", "Производитель": "BOSCH" },
      imagePaths: ["import_files/ab/p-1.jpg"],
    });
    expect(product?.entityType === "product" && product.searchText).toBe("0 986 452 041 Фильтр масляный Toyota Camry V40");
    const brand = result.headerRows.find((row) => row.entityType === "brand");
    expect(brand).toMatchObject({ name: "BOSCH" });
    expect(product).toMatchObject({ brandExternalId: brand?.externalId });
    expect(result.headerRows.find((row) => row.entityType === "warehouse")).toMatchObject({ externalId: "wh-1", name: "Склад на Ленина" });
  });

  it("treats Статус=Удален like ПометкаУдаления", () => {
    expect(parseImportXml(xml).bodyRows.find((row) => row.entityType === "product" && row.externalId === "p-2"))
      .toMatchObject({ isActive: false });
  });

  it("resolves a goods file without <Свойства> from the stored dictionary and returns the merged one", () => {
    const first = parseImportXml(xml);
    const goodsOnly = xml.replace(/<Классификатор>[\s\S]*<\/Классификатор>/u, "");
    const withoutDictionary = parseImportXml(goodsOnly);
    // Unknown property: kept under its id, and a GUID-like value never becomes a brand.
    expect(withoutDictionary.headerRows.some((row) => row.entityType === "brand")).toBe(false);
    const withDictionary = parseImportXml(goodsOnly, { knownProperties: first.properties });
    expect(withDictionary.bodyRows.find((row) => row.entityType === "product" && row.externalId === "p-1"))
      .toMatchObject({ attributes: { "Производитель": "BOSCH" } });
    expect(withDictionary.properties["prop-brand"]).toEqual({ name: "Производитель", values: { "v-bosch": "BOSCH" } });
  });
});

describe("parseOffersXml: which 1С price type becomes the site's price", () => {
  // The owner's base has exactly two price types: «Оптовая цена» (what the shop sells at) and «Учетная цена» (its cost).
  type PriceType = readonly [id: string, name: string];
  const WHOLESALE: PriceType = ["t-sell", "Оптовая цена"];
  const COST: PriceType = ["t-cost", "Учетная цена"];
  const SMALL_WHOLESALE: PriceType = ["t-small", "Мелкий опт"];

  /** One offer per entry: the prices it lists, in this order, as [type id, amount in roubles]. */
  function offersXml(types: readonly PriceType[], offers: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>>): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ДатаФормирования="2026-11-22T10:00:00">
  <ПакетПредложений СодержитТолькоИзменения="true">
    <ТипыЦен>${types.map(([id, name]) => `<ТипЦены><Ид>${id}</Ид><Наименование>${name}</Наименование></ТипЦены>`).join("")}</ТипыЦен>
    <Предложения>
${Object.entries(offers).map(([id, prices]) => `      <Предложение><Ид>${id}</Ид><Цены>${
    prices.map(([type, amount]) => `<Цена><ИдТипаЦены>${type}</ИдТипаЦены><ЦенаЗаЕдиницу>${amount}</ЦенаЗаЕдиницу></Цена>`).join("")
  }</Цены><Количество>1</Количество></Предложение>`).join("\n")}
    </Предложения>
  </ПакетПредложений>
</КоммерческаяИнформация>`;
  }

  /** Product id → price in kopeks, for the price rows the parser produced. */
  function prices(xml: string, options?: Parameters<typeof parseOffersXml>[1]): Record<string, number> {
    return Object.fromEntries(parseOffersXml(xml, options).bodyRows
      .flatMap((row) => (row.entityType === "price" ? [[row.productExternalId, row.amountKopeks] as const] : [])));
  }

  it("takes the selling price when the file also carries the cost price", () => {
    const xml = offersXml([COST, WHOLESALE], { "p-1": [["t-cost", 449], ["t-sell", 700]] });

    expect(prices(xml)).toEqual({ "p-1": 70_000 });
  });

  it("publishes no price when the cost price is the only one the file carries", () => {
    const xml = offersXml([COST], { "p-1": [["t-cost", 449]] });

    expect(prices(xml)).toEqual({});
  });

  it("takes the cost price only when staff named that price type for the base", () => {
    const xml = offersXml([COST, WHOLESALE], { "p-1": [["t-cost", 449], ["t-sell", 700]] });

    expect(prices(xml, { priceTypeName: "Учетная цена" })).toEqual({ "p-1": 44_900 });
  });

  it("uses one price type for the whole file: the first selling type listed", () => {
    const xml = offersXml([WHOLESALE, SMALL_WHOLESALE], {
      "p-1": [["t-sell", 700], ["t-small", 650]],
      // This offer lists the other type first and must still get the same type as the rest of the file.
      "p-2": [["t-small", 90], ["t-sell", 100]],
      // This offer has no price of the chosen type: no price rather than a price of another type.
      "p-3": [["t-small", 55]],
    });

    expect(prices(xml)).toEqual({ "p-1": 70_000, "p-2": 10_000 });
  });

  it("says which price type it took", () => {
    const xml = offersXml([COST, WHOLESALE], { "p-1": [["t-cost", 449], ["t-sell", 700]] });

    expect(parseOffersXml(xml).priceTypeName).toBe("Оптовая цена");
    expect(parseOffersXml(offersXml([COST], { "p-1": [["t-cost", 449]] })).priceTypeName).toBeNull();
  });
});

describe("parseOffersXml split 2.08+ files", () => {
  it("reads named warehouses from <Остатки> and a price-only file carries no stock", () => {
    const rests = `<КоммерческаяИнформация xmlns="urn:1C.ru:commerceml_210"><ПакетПредложений СодержитТолькоИзменения="false">
      <Склады><Склад><Ид>w1</Ид><Наименование>Центральный</Наименование></Склад></Склады>
      <Предложения><Предложение><Ид>p-1</Ид><Остатки><Остаток><Склад><Ид>w1</Ид><Количество>4</Количество></Склад></Остаток>
      <Остаток><Склад><Ид>w2</Ид><Количество>1</Количество></Склад></Остаток></Остатки></Предложение></Предложения>
    </ПакетПредложений></КоммерческаяИнформация>`;
    const result = parseOffersXml(rests);
    expect(result.bodyRows).toEqual([
      { entityType: "stock", productExternalId: "p-1", quantityOnHand: 4, version: 1, warehouseExternalId: "w1" },
      { entityType: "stock", productExternalId: "p-1", quantityOnHand: 1, version: 1, warehouseExternalId: "w2" },
      { entityType: "stock", productExternalId: "p-1", quantityOnHand: 0, version: 1, warehouseExternalId: EXCHANGE_WAREHOUSE_EXTERNAL_ID },
    ]);
    expect(result.headerRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: "w1", name: "Центральный" }),
      expect.objectContaining({ externalId: "w2", keepExistingName: true }),
    ]));
    const prices = parseOffersXml(`<КоммерческаяИнформация><ПакетПредложений СодержитТолькоИзменения="false"><Предложения>
      <Предложение><Ид>p-1</Ид><Цены><Цена><ЦенаЗаЕдиницу>10</ЦенаЗаЕдиницу></Цена></Цены></Предложение>
    </Предложения></ПакетПредложений></КоммерческаяИнформация>`);
    expect(prices.carriesStock).toBe(false);
    expect(prices.bodyRows).toEqual([{ amountKopeks: 1000, currency: "RUB", entityType: "price", productExternalId: "p-1", version: 1 }]);
  });
});

// The owner's base names no manufacturer at all; the brand filter of the catalogue was empty for 42 723 items.
describe("the brand of a product whose manufacturer 1С does not name", () => {
  const xmlOf = (goods: string) => `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-11-23T10:00:00">
  <Классификатор><Ид>c</Ид><Наименование>Классификатор</Наименование></Классификатор>
  <Каталог СодержитТолькоИзменения="false"><Ид>cat</Ид><Товары>${goods}</Товары></Каталог>
</КоммерческаяИнформация>`;
  const brandOf = (goods: string, id: string) => {
    // Brand rows go ahead of the products, among the header rows.
    const parsed = parseImportXml(xmlOf(goods));
    const rows = [...parsed.headerRows, ...parsed.bodyRows];
    const product = rows.find((row) => row.entityType === "product" && row.externalId === id);
    const brandId = product?.entityType === "product" ? product.brandExternalId : undefined;
    const brand = rows.find((row) => row.entityType === "brand" && row.externalId === brandId);
    return brand?.entityType === "brand" ? brand.name : null;
  };

  it("is the maker written in the name", () => {
    expect(brandOf("<Товар><Ид>p1</Ид><Артикул>SL-1767</Артикул><Наименование>SL-1767 Втулка амортизатора зад прав/лев SUFIX</Наименование></Товар>", "p1")).toBe("SUFIX");
  });

  it("is what 1С names, when it does name a manufacturer", () => {
    expect(brandOf("<Товар><Ид>p2</Ид><Артикул>A1</Артикул><Наименование>Колодка тормозная HOFER</Наименование><Изготовитель><Ид>m</Ид><Наименование>ATE</Наименование></Изготовитель></Товар>", "p2")).toBe("ATE");
  });

  it("is not the make of the car the part is for", () => {
    expect(brandOf("<Товар><Ид>p3</Ид><Артикул>A2</Артикул><Наименование>Фильтр масляный Toyota Corolla 1.6</Наименование></Товар>", "p3")).toBeNull();
  });

  it("is one brand row for all the products of one maker", () => {
    const rows = parseImportXml(xmlOf(
      "<Товар><Ид>p4</Ид><Артикул>B1</Артикул><Наименование>Сальник NOK 90311-38034</Наименование></Товар>"
      + "<Товар><Ид>p5</Ид><Артикул>B2</Артикул><Наименование>Сальник коленвала NOK 90311-99999</Наименование></Товар>",
    )).headerRows;
    expect(rows.filter((row) => row.entityType === "brand").map((row) => row.name)).toEqual(["NOK"]);
  });
});
