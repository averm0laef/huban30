import { describe, expect, it } from "vitest";

import { partTypeKey } from "../catalog/catalog-part-dictionary.js";
import { sameNumberIsSamePart, sideFromName, type PartSide } from "./same-part-number.js";

const side = (brand: string | null, section: string | null, name: string): PartSide => ({ brand, section, type: partTypeKey(name) });

const osramLamp = side("OSRAM", "avtolampy", "3930 Лампа T4W 24V BA9s Osram");
const osramLampTwin = side("OSRAM", "avtolampy", "Лампа OSRAM 3930");
const liquiMolyOil = side("LIQUI MOLY", "motornye-masla", "3930 10W-40 SL/CF OPTIMAL 4л/5л (полусинт.мотор.масло) Liqui Moly 3930");
const lynxFilter = side("LYNXAUTO", "filtry", "LC-341 Фильтр масляный LYNXauto Union C-341");
const luckyPaint = side(null, "avtohimiya", "Краска-аэрозоль LUCKY золотая, 530мл");
const clamp = side(null, "krepezh", "20-22 Хомут силовой 20-22мм");
const spanner = side(null, "instrumenty", "Ключ рожковый 20*22");
const kamazElement = side(null, "filtry", "элемент масляного фильтра 7405-1012040 бумага Евро+ЯМЗ МАЗ");
const kamazElementMesh = side(null, "filtry", "Элемент масляного фильтра 7405-1012040 м/сетка ДФВ 4803 Евро");
const kamazElementQueued = side(null, null, "Эл-т МФ ЕВРО (сетка) (Челны) Камаз 7405-1012040");

describe("a number shared by two products is one part only when the products agree", () => {
  it("keeps a second card of the same brand's part", () => {
    expect(sameNumberIsSamePart("3930", osramLamp, osramLampTwin)).toBe(true);
  });

  it("never makes another maker's product of that number an analog", () => {
    expect(sameNumberIsSamePart("3930", osramLamp, liquiMolyOil)).toBe(false);
    expect(sameNumberIsSamePart("3930", liquiMolyOil, osramLamp)).toBe(false);
  });

  it("asks a product of unknown brand for the same section and the same kind of part", () => {
    expect(sameNumberIsSamePart("LC341", lynxFilter, luckyPaint)).toBe(false);
    expect(sameNumberIsSamePart("2022", clamp, spanner)).toBe(false);
    expect(sameNumberIsSamePart("74051012040", kamazElement, kamazElementMesh)).toBe(true);
  });

  it("does not take the queue «Без категории» for a section", () => {
    expect(sameNumberIsSamePart("74051012040", kamazElement, kamazElementQueued)).toBe(false);
    expect(sameNumberIsSamePart("74051012040", kamazElementQueued, kamazElement)).toBe(false);
  });

  it("rejects the same kind of part from another section, and another kind from the same section", () => {
    expect(sameNumberIsSamePart("74051012040", kamazElement, side(null, "dvigatel", "Элемент масляного фильтра"))).toBe(false);
    expect(sameNumberIsSamePart("74051012040", kamazElement, side(null, "filtry", "Прокладка фильтра"))).toBe(false);
  });

  it("matches a short number of digits only within one brand", () => {
    const sameClamp = side(null, "krepezh", "Хомут силовой 20-22");
    expect(sameNumberIsSamePart("2022", clamp, sameClamp)).toBe(false);
    expect(sameNumberIsSamePart("2022", { ...clamp, brand: "NORMA" }, { ...sameClamp, brand: "NORMA" })).toBe(true);
    expect(sameNumberIsSamePart("A2022", kamazElement, { ...kamazElementMesh })).toBe(true);
  });

  it("takes a vehicle maker's original number standing as our product's article for that very part", () => {
    const toyotaBolt = { ...side(null, "dvigatel", "Болт шатунный Toyota Avensis (T220) 97-03"), originalNumber: true };
    const fromCatalogue: PartSide = { brand: "TOYOTA", section: null, type: null };
    expect(sameNumberIsSamePart("1326574030", fromCatalogue, toyotaBolt)).toBe(true);
    expect(sameNumberIsSamePart("1326574030", fromCatalogue, { ...toyotaBolt, originalNumber: false })).toBe(false);
    expect(sameNumberIsSamePart("1326574030", fromCatalogue, { ...toyotaBolt, brand: "MASUMA" })).toBe(false);
  });

  it("shows every product of the number to a customer who typed only the number", () => {
    expect(sameNumberIsSamePart("3930", null, liquiMolyOil)).toBe(true);
    expect(sameNumberIsSamePart("3930", null, osramLamp)).toBe(true);
  });

  it("reads a side known only by its name: a parts catalogue's description", () => {
    expect(sideFromName("OSRAM", "Лампа накаливания")).toEqual({ brand: "OSRAM", section: "avtolampy", type: partTypeKey("Лампа") });
    expect(sideFromName(null, "")).toEqual({ brand: null, section: null, type: null });
    expect(sameNumberIsSamePart("7506ULT", sideFromName("OSRAM", "Лампа накаливания"), side(null, "avtolampy", "Лампа P21W 7506ULT"))).toBe(true);
    expect(sameNumberIsSamePart("7506ULT", sideFromName("OSRAM", "Лампа накаливания"), side(null, "motornye-masla", "Масло 7506ULT"))).toBe(false);
    expect(sameNumberIsSamePart("3930", sideFromName("OSRAM", "Лампа накаливания"), side(null, "avtolampy", "Лампа 3930 24V"))).toBe(false);
  });
});
