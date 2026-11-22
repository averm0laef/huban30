import { describe, expect, it } from "vitest";

import { codeWrittenInName } from "./catalog-search-sql.js";
import { searchTokenPlan } from "./catalog-search-tokens.js";

// Found by the owner on the full catalogue: «КС171» and «покрышка велосипед» found nothing though the goods exist.
// The same cases run against a real database in catalog-search-regression.test.ts; these hold the rules in CI.
describe("a part number written in a product's name", () => {
  it("is looked for as written, in Latin and in Cyrillic look-alikes", () => {
    expect(codeWrittenInName("KC171")).toEqual(["kc171", "кс171"]);
    expect(codeWrittenInName("KC117")).toEqual(["kc117", "кс117"]);
  });

  it("is looked for in Latin only when a letter has no Cyrillic look-alike", () => {
    expect(codeWrittenInName("8220434SX")).toEqual(["8220434sx"]);
    expect(codeWrittenInName("W9142")).toEqual(["w9142"]);
  });

  it("is left to the article when it is short or only digits of a few places", () => {
    expect(codeWrittenInName("2024")).toEqual([]);
    expect(codeWrittenInName("H7")).toEqual([]);
    expect(codeWrittenInName("12345")).toEqual([]);
    // Six digits or more are a number of their own, looked for once.
    expect(codeWrittenInName("123456")).toEqual(["123456"]);
  });
});

describe("an everyday query", () => {
  const texts = (query: string, word: number) => searchTokenPlan(query).alternatives.filter((item) => item.word === word).map((item) => item.text);

  it("does not require its little words", () => {
    expect(searchTokenPlan("покрышка на велик").words).toEqual(["покрышка", "велик"]);
    expect(searchTokenPlan("масло для тойоты").words).toEqual(["масло", "тойоты"]);
  });

  it("keeps a little word when there is nothing else to look for", () => {
    expect(searchTokenPlan("на").words).toEqual(["на"]);
  });

  it("reads «велосипед» and «велик» as the «вело…» the base writes", () => {
    expect(texts("покрышка велосипед", 2)).toContain("вело");
    expect(texts("покрышка на велик", 2)).toContain("вело");
    expect(texts("велосипедная покрышка", 1)).toContain("вело");
  });
});
