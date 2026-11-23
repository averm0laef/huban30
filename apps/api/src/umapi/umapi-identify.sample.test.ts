import { describe, expect, it } from "vitest";

import { isOwnCode, makerNamedIn, nameNumbers, partCandidates, sameMaker } from "./umapi-identify.js";

// Real names and numbers of the owner's base (random sample, 24.11.2026).
describe("which numbers a product is looked up by", () => {
  it("reads the original number behind SAT's «ST-» prefix", () => {
    expect(partCandidates({ brand: null, name: "Фильтр топливный TOYOTA HILUX SURF/4RUNNER ##N21# 3RZ/2TR/1GR/5VZ 02-09/ LAND CRUISER PRADO 120", sku: "ST-23300-31090" }))
      .toEqual([{ article: "ST-23300-31090", brand: null, via: "own" }, { article: "23300-31090", brand: null, via: "own" }]);
  });

  it("reads it without the dash too, and leaves other articles starting with «ST» whole", () => {
    expect(partCandidates({ brand: null, name: "ST-04111-64345 Ремкомплект ДВС 2C/2C-T TOYOTA", sku: "ST0411164345" }).map((c) => c.article))
      .toEqual(["ST0411164345", "0411164345"]);
    expect(partCandidates({ brand: "AutoProfi", name: "Щетка стеклоочистителя AUTOPROFI 24\"", sku: "STD24" }).map((c) => c.article)).toEqual(["STD24"]);
  });

  it("never asks about 1С's own codes, and finds the number written in the name", () => {
    expect(isOwnCode("00-00022450")).toBe(true);
    expect(isOwnCode("ST-23300-31090")).toBe(false);
    expect(partCandidates({ brand: "ContiTech", name: "AVX13X1385 Ремень клиновой Contitech", sku: "13X1385" }).map((c) => c.article)).toEqual(["13X1385", "AVX13X1385"]);
    expect(partCandidates({ brand: "MILES", name: "Фильтр воздушный AK372/1 LYNX LA-1649-1 MILES AFAC051", sku: "AK372/1" }).map((c) => c.article))
      .toEqual(["AK372/1", "LA-1649-1", "AFAC051"]);
    expect(partCandidates({ brand: "SHEFT", name: "(LX1734) Фильтр воздушный MB Actros Euro 5 SHEFT 16015-FS", sku: "16015FS" }).map((c) => c.article))
      .toEqual(["16015FS", "LX1734"]);
  });

  it("does not take sizes, years, engines or chassis codes for part numbers", () => {
    expect(nameNumbers("А/шина 185/75R16C-8PR Triangle TR737 104/102Q зима", "00-00042045")).not.toContain("185/75R16C-8PR");
    expect(nameNumbers("Натяжной ролик ремня ГРМ TOYOTA 1JZ-GE/1JZ-GTE", "U00345F")).toEqual([]);
    expect(nameNumbers("Датчик кислородный TOYOTA SUCCEED 02-/COROLLA NZE120 1NZFE", "ST-89465-20810")).toEqual([]);
    expect(nameNumbers("Лампа H4 12V 60/55W P43t SUP +30% Osram", "64193SUP")).toEqual([]);
  });

  it("knows the catalogue's names of the owner's makers", () => {
    expect(sameMaker("ASAKASHI", "JS ASAKASHI")).toBe(true);
    expect(sameMaker("OSRAM", "ams-OSRAM")).toBe(true);
    expect(sameMaker("ContiTech", "CONTINENTAL CTAM")).toBe(true);
    expect(sameMaker("SAT", "TOYOTA SAT")).toBe(false);
    expect(makerNamedIn("(LX1734) Фильтр воздушный MAHLE", ["MAHLE", "KNECHT"])).toBe("MAHLE");
    expect(makerNamedIn("Фильтр воздушный", ["MAHLE", "KNECHT"])).toBeNull();
  });
});
