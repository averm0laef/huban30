import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { VEHICLE_KIND_NAME_WORDS, vehicleKindOf, vehicleKindOfGroups, vehicleKindOfName } from "./catalog-vehicle-kind.js";

// Group names from the owner's 1С tree (local-data/1c/groups-tree-2026-11-22.txt), product names from his base.
describe("what kind of vehicle a product is for", () => {
  it.each([
    [["Номенклатура 2022", "01. Легковая", "Тормозная система"], "passenger"],
    [["Номенклатура 2022", "03. Отечественные авто", "ВАЗ"], "passenger"],
    [["Номенклатура 2022", "23. УАЗ"], "passenger"],
    [["Номенклатура 2022", "02. Грузовики", "Двигатель"], "truck"],
    [["Номенклатура 2022", "25. Камаз"], "truck"],
    [["Номенклатура 2022", "29. ГАЗеЛЬ"], "truck"],
    [["Номенклатура 2022", "00. Комерческий"], "truck"],
    [["Номенклатура 2022", "MT3"], "tractor"],
    [["Номенклатура 2022", "МТЗ", "Гидравлика"], "tractor"],
    [["Номенклатура 2022", "27. Сельхозтехника"], "tractor"],
    [["Номенклатура 2022", "24. Спец техника"], "tractor"],
    [["26. Фронтальный погрузчик"], "tractor"],
  ] as const)("reads the 1С groups %j as %s", (groups, kind) => {
    expect(vehicleKindOfGroups(groups)).toBe(kind);
  });

  it("reads machinery filed inside the trucks as machinery", () => {
    expect(vehicleKindOfGroups(["02. Грузовики", "Спец техника"])).toBe("tractor");
  });

  it("says nothing of groups that name no vehicle", () => {
    expect(vehicleKindOfGroups(["Номенклатура 2022", "10. Масла", "Моторные"])).toBeNull();
    expect(vehicleKindOfGroups(["28. Мотоциклы/мотозапчасти"])).toBeNull();
    expect(vehicleKindOfGroups([])).toBeNull();
  });

  it.each([
    ["Колодки тормозные передние Toyota Corolla 120", "passenger"],
    ["Амортизатор передний ВАЗ 2108 газомасляный", "passenger"],
    ["Крестовина карданного вала УАЗ", "passenger"],
    ["Вал карданный КАМАЗ-5320 межосевой", "truck"],
    ["Фильтр топливный HOWO A7", "truck"],
    ["Рессора задняя Газель 3302", "truck"],
    ["Насос водяной МАЗ, Урал ЯМЗ-236", "truck"],
    ["Гидрораспределитель МТЗ-82", "tractor"],
    ["Стартер ЮМЗ редукторный", "tractor"],
    ["Палец ковша погрузчика ZL-50", "tractor"],
  ] as const)("reads the make in the name «%s» as %s", (name, kind) => {
    expect(vehicleKindOfName(name)).toBe(kind);
  });

  it("takes a make only as a whole word", () => {
    // «МАЗ» inside «КАМАЗ» and «маз» inside «смазка»; «ВАЗ» inside «вазелин»; «газон» is not «газ».
    expect(vehicleKindOfName("Вал карданный КАМАЗ")).toBe("truck");
    expect(vehicleKindOfName("Смазка графитная 400 г")).toBeNull();
    expect(vehicleKindOfName("Вазелин технический")).toBeNull();
    expect(vehicleKindOfName("Лампа H7 12V 55W Osram")).toBeNull();
  });

  it("reads a part for a tractor and a truck as the tractor's", () => {
    expect(vehicleKindOfName("Шина 8.25R20 для МТЗ и КАМАЗ")).toBe("tractor");
  });

  it("believes the owner's group before the name", () => {
    expect(vehicleKindOf({ groupNames: ["01. Легковая"], productName: "Фильтр топливный КАМАЗ" })).toBe("passenger");
    expect(vehicleKindOf({ groupNames: ["10. Масла"], productName: "Фильтр топливный КАМАЗ" })).toBe("truck");
    expect(vehicleKindOf({ groupNames: [], productName: "Лампа H7" })).toBeNull();
  });

  it("fills the products already loaded (migration 0056) with the very same makes", () => {
    const sql = readFileSync(path.join(
      path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/database/migrations/0056_vehicle_kind_and_popularity.sql",
    ), "utf8");
    for (const [kind, words] of Object.entries(VEHICLE_KIND_NAME_WORDS)) {
      expect(sql).toContain(`(${words.join("|")})($|[^a-zа-я])' THEN '${kind}'`);
    }
    // The same order as here: a tractor's word wins over a truck's, a truck's over a passenger car's.
    expect(sql.indexOf("THEN 'tractor'")).toBeLessThan(sql.indexOf("THEN 'truck'"));
    expect(sql.indexOf("THEN 'truck'")).toBeLessThan(sql.indexOf("THEN 'passenger'"));
  });
});
