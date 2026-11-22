import { describe, expect, it } from "vitest";

import { crossRowsFromCard } from "./parts-finder-crosses.store.js";

describe("crossRowsFromCard", () => {
  it("pairs the part with every group and trusts only same-part groups", () => {
    const rows = crossRowsFromCard({
      part: { article: "W 75/3", brand: "MANN-FILTER" },
      groups: {
        analogs: [{ article: "OC 90", brand: "MAHLE" }, { article: "PH5796", brand: "FRAM", manufacturer_verified: true }],
        oe: [{ article: "04152-40060", brand: "TOYOTA" }],
        replaced_by: [{ article: "W 75/4", brand: "MANN-FILTER" }],
      },
    });
    expect(rows.map((row) => [row.crossArticle, row.confirmed])).toEqual([
      ["OC 90", false], ["PH5796", true], ["04152-40060", true], ["W 75/4", true],
    ]);
    expect(rows.every((row) => row.article === "W 75/3" && row.brand === "MANN-FILTER")).toBe(true);
  });

  it("uses the current part when the card was replaced and skips incomplete rows", () => {
    const rows = crossRowsFromCard({
      part: { article: "OLD1", brand: "X" }, current: { article: "NEW1", brand: "X" },
      groups: { analogs: [{ article: "A1" }, { brand: "Y" }, { article: "B2", brand: "Y" }] },
    });
    expect(rows).toEqual([{ article: "NEW1", brand: "X", confirmed: false, crossArticle: "B2", crossBrand: "Y" }]);
    expect(crossRowsFromCard({ status: "choose_brand" })).toEqual([]);
  });
});
