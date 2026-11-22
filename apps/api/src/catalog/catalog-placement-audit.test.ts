import { describe, expect, it } from "vitest";

import { auditPlacement, formatAudit, readCommerceMl, readList } from "./catalog-placement-audit.js";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-11-22T10:00:00">
  <Классификатор><Ид>c</Ид><Наименование>Классификатор</Наименование>
    <Группы>
      <Группа><Ид>g-truck</Ид><Наименование>02. Грузовики</Наименование>
        <Группы><Группа><Ид>g-hub</Ид><Наименование>02.21 Ступица</Наименование>
          <Группы><Группа><Ид>g-hub-seal</Ид><Наименование>02.21.02 Ступица сальник</Наименование></Группа></Группы>
        </Группа></Группы>
      </Группа>
      <Группа><Ид>g-sto</Ид><Наименование>СТО</Наименование></Группа>
    </Группы>
  </Классификатор>
  <Каталог СодержитТолькоИзменения="false"><Ид>cat</Ид><Товары>
    <Товар><Ид>p1</Ид><Артикул>A1</Артикул><Наименование>Сальник 35x50x8 NOK</Наименование><Группы><Ид>g-hub-seal</Ид></Группы></Товар>
    <Товар><Ид>p2</Ид><Артикул>TG-48815-60121</Артикул><Наименование>Втулка Ti·GUAR</Наименование></Товар>
    <Товар><Ид>p3</Ид><Артикул>S1</Артикул><Наименование>Стартер снятие/установка</Наименование><Группы><Ид>g-sto</Ид></Группы></Товар>
    <Товар><Ид>p4</Ид><Артикул>W9142</Артикул><Наименование>Фильтр масляный MANN W914/2</Наименование><Группы><Ид>g-truck</Ид></Группы></Товар>
  </Товары></Каталог>
</КоммерческаяИнформация>`;

describe("the audit of an exchange file before the exchange", () => {
  it("reads the file with the exchange's own parser: every item with its article and its group", () => {
    const input = readCommerceMl(XML);

    expect(input.items).toEqual([
      { groupExternalId: "g-hub-seal", name: "Сальник 35x50x8 NOK", sku: "A1" },
      { groupExternalId: null, name: "Втулка Ti·GUAR", sku: "TG-48815-60121" },
      { groupExternalId: "g-sto", name: "Стартер снятие/установка", sku: "S1" },
      { groupExternalId: "g-truck", name: "Фильтр масляный MANN W914/2", sku: "W9142" },
    ]);
    expect(input.groups.get("g-hub-seal")).toEqual({ name: "02.21.02 Ступица сальник", parentExternalId: "g-hub" });
  });

  it("says what decided each item's shelf: the group, the name, the original number, or nothing", () => {
    const audit = auditPlacement(readCommerceMl(XML));

    expect(audit.total).toBe(4);
    expect(audit.bySource).toMatchObject({ group: 1, name: 1, none: 1, number: 1 });
    expect(audit.unsorted).toBe(1);
    expect(audit.withoutGroup).toBe(1);
  });

  it("counts the items of each section and shelf", () => {
    const audit = auditPlacement(readCommerceMl(XML));

    expect(audit.sections).toEqual([
      { count: 2, label: "Подвеска", shelves: [{ count: 1, label: "Стойки и втулки стабилизатора" }, { count: 1, label: "Ступицы и подшипники" }] },
      { count: 1, label: "Фильтры", shelves: [{ count: 1, label: "Масляные" }] },
    ]);
  });

  it("shows for every 1С group where its name points and what became of its items", () => {
    const audit = auditPlacement(readCommerceMl(XML));

    expect(audit.groups).toEqual([
      { byGroup: 0, byName: 1, path: "02. Грузовики", products: 1, queued: 0, section: null },
      { byGroup: 1, byName: 0, path: "02. Грузовики / 02.21 Ступица / 02.21.02 Ступица сальник", products: 1, queued: 0, section: "Подвеска → Ступицы и подшипники" },
      { byGroup: 0, byName: 0, path: "СТО", products: 1, queued: 1, section: null },
    ]);
  });

  it("lists the words the unsorted names are about", () => {
    expect(auditPlacement(readCommerceMl(XML)).queue).toEqual([{ count: 1, example: "Стартер снятие/установка", head: "стартер" }]);
  });

  it("reads a plain list of names as well", () => {
    const audit = auditPlacement(readList("Наименование\nАмортизатор передний KYB 334305\nA-123;MANN;Фильтр воздушный C25114\n\n"));

    expect(audit.total).toBe(2);
    expect(audit.bySource).toMatchObject({ name: 2 });
  });

  it("prints the report in plain Russian", () => {
    const lines = formatAudit(auditPlacement(readCommerceMl(XML)));

    expect(lines[0]).toBe("Товаров в файле: 4. Разложено по разделам: 3 (75.0 %), без раздела: 1 (25.0 %).");
    expect(lines).toContain("Что решило: группа 1С — 1, название товара — 1, оригинальный номер — 1, ничего (без раздела) — 1.");
    expect(lines.some((line) => line.includes("02.21.02 Ступица сальник") && line.includes("Подвеска → Ступицы и подшипники"))).toBe(true);
  });
});
