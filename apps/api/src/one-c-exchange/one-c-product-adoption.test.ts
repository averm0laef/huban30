import type { OneCCatalogRow } from "@an30/contracts";
import { describe, expect, it } from "vitest";

import { parseImportXml } from "./commerce-ml.parser.js";
import { keptProductSlug, planProductAdoption } from "./one-c-product-adoption.js";
import { sourceExternalId } from "./one-c-source.js";

const product = (externalId: string, sku: string, name: string, oneCCode?: string): OneCCatalogRow => ({
  attributes: {}, brandExternalId: null, categoryExternalId: null, description: null, entityType: "product",
  externalId, isActive: true, name, searchText: null, sku, slug: "x", version: 1, ...(oneCCode ? { oneCCode } : {}),
});

describe("which products of a file can take over the ones already on the site", () => {
  it("pairs a product with its 1С code", () => {
    expect(planProductAdoption([product("guid-1", "A1", "Фильтр", "00-00000001")], "one_c")).toEqual({
      byCode: [{ codeExternalId: "00-00000001", externalId: "guid-1" }], byName: [],
    });
  });

  it("looks for the code the way the second base stores identifiers", () => {
    const plan = planProductAdoption([product("stored-guid", "A1", "Фильтр", "00-00000001")], "one_c_secondary");
    expect(plan.byCode).toEqual([{ codeExternalId: sourceExternalId("one_c_secondary", "00-00000001"), externalId: "stored-guid" }]);
  });

  it("leaves a product that is named by its own code: it is on the site under it already", () => {
    expect(planProductAdoption([product("00-00000001", "A1", "Фильтр", "00-00000001")], "one_c").byCode).toEqual([]);
  });

  it("leaves a code two products of the file share, and a code that is another product's identifier", () => {
    const plan = planProductAdoption([
      product("guid-1#red", "A1", "Фильтр красный", "00-00000001"),
      product("guid-1#blue", "A1", "Фильтр синий", "00-00000001"),
      product("guid-2", "A2", "Сальник", "00-00000003"),
      product("00-00000003", "A3", "Ремень", "00-00000003x"),
    ], "one_c");
    expect(plan.byCode).toEqual([{ codeExternalId: "00-00000003x", externalId: "00-00000003" }]);
  });

  it("leaves an identifier the file gives to two products", () => {
    expect(planProductAdoption([
      product("guid-1", "A1", "Фильтр", "00-00000001"), product("guid-1", "A2", "Ремень", "00-00000002"),
      product("guid-2", "A3", "Свеча"), product("guid-2", "A4", "Лампа"),
    ], "one_c")).toEqual({ byCode: [], byName: [] });
  });

  it("offers a product without a code by its article and name, only when no other product of the file has them", () => {
    const plan = planProductAdoption([
      product("guid-1", "A1", "Фильтр"),
      product("guid-2", "A2", "Колодки"),
      product("guid-3", "A2", "Колодки"),
      product("guid-4", "A1", "Фильтр", "00-00000004"),
    ], "one_c");
    expect(plan.byName).toEqual([]);
    expect(planProductAdoption([product("guid-1", "A1", "Фильтр"), product("guid-2", "A2", "Колодки")], "one_c").byName)
      .toEqual([{ externalId: "guid-1", name: "Фильтр", sku: "A1" }, { externalId: "guid-2", name: "Колодки", sku: "A2" }]);
  });
});

describe("the page address of a product the exchange updates", () => {
  it("stays when only the identifier behind its tail is new", () => {
    expect(keptProductSlug("filtr-maslyanyy-0123456789", "filtr-maslyanyy-abcdef0123")).toBe("filtr-maslyanyy-0123456789");
  });

  it("follows the name when the name changed", () => {
    expect(keptProductSlug("filtr-maslyanyy-0123456789", "filtr-vozdushnyy-abcdef0123")).toBe("filtr-vozdushnyy-abcdef0123");
  });

  it("is the incoming one when the stored address was not made by the exchange", () => {
    expect(keptProductSlug("filtr-maslyanyy", "filtr-maslyanyy-abcdef0123")).toBe("filtr-maslyanyy-abcdef0123");
  });
});

describe("the 1С code of a product in import.xml", () => {
  const file = (goods: string) => `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08"><Классификатор><Ид>c</Ид><Наименование>К</Наименование></Классификатор>
<Каталог СодержитТолькоИзменения="false"><Ид>cat</Ид><Товары>${goods}</Товары></Каталог></КоммерческаяИнформация>`;
  const codes = (goods: string) => parseImportXml(file(goods)).bodyRows
    .flatMap((row) => row.entityType === "product" ? [[row.sku, row.oneCCode]] : []);

  it("is read from <Код> and from the «Код» requisite, next to the article", () => {
    expect(codes(
      "<Товар><Ид>g1</Ид><Артикул>A1</Артикул><Код>00-00000001</Код><Наименование>Фильтр</Наименование></Товар>"
      + "<Товар><Ид>g2</Ид><Артикул>A2</Артикул><Наименование>Сальник</Наименование><ЗначенияРеквизитов><ЗначениеРеквизита>"
      + "<Наименование>Код</Наименование><Значение>00-00000002</Значение></ЗначениеРеквизита></ЗначенияРеквизитов></Товар>"
      + "<Товар><Ид>g3</Ид><Наименование>Ремень</Наименование><Код>00-00000003</Код></Товар>"
      + "<Товар><Ид>g4</Ид><Артикул>A4</Артикул><Наименование>Шрус</Наименование></Товар>",
    )).toEqual([["A1", "00-00000001"], ["A2", "00-00000002"], ["00-00000003", "00-00000003"], ["A4", undefined]]);
  });
});
