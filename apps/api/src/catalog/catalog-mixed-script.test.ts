import { describe, expect, it } from "vitest";

import { repairMixedScript } from "./catalog-mixed-script.js";

describe("a Latin look-alike letter typed inside a Russian word", () => {
  // 167 names of the owner's 1С base carry one: «Cальник» with a Latin C, «Pемень» with a Latin P.
  it.each([
    ["Cальник привода FR TY NCP1#/2#/3#", "Сальник привода FR TY NCP1#/2#/3#"],
    ["Pемень автомобильный  (150 руб)", "Ремень автомобильный  (150 руб)"],
    ["Щеточный узел cтартера NISSAN ALMERA N15", "Щеточный узел стартера NISSAN ALMERA N15"],
    ["Hасос для автономки 24v", "Насос для автономки 24v"],
    ["Kолодки тормозные передние Газель НЕКСТ ADR", "Колодки тормозные передние Газель НЕКСТ ADR"],
    ["Крестовина карданного вала УAЗ (d-29)", "Крестовина карданного вала УАЗ (d-29)"],
    ["Гaйкa 104.123 самоконтрящаяся", "Гайка 104.123 самоконтрящаяся"],
  ])("%s → %s", (typed, meant) => {
    expect(repairMixedScript(typed)).toBe(meant);
  });

  it.each([
    // Latin words, part numbers and brand names stay as they are.
    "Фильтр масляный MANN W914/2", "TOYOTA COROLLA 97-02", "Масло моторное 5W-40 4 л", "ST-90919-02249 Катушка зажигания", "KYB 334305",
    // One Russian letter in front of a Latin word is a brand («ЗTON»), not a typo.
    "Автошампунь ЗTON 550 мл МасАвто",
    // A Latin letter that looks like no Russian one is left alone: a small «m» is not «м».
    "Сальник привода Lевый", "Шланг торm D10mm/L550mm",
  ])("leaves «%s» as it is", (name) => {
    expect(repairMixedScript(name)).toBe(name);
  });
});
