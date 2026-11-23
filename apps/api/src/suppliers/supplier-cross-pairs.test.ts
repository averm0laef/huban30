import { describe, expect, it } from "vitest";

import type { SupplierPart } from "../adapters/provider-contracts.js";
import { extractCrossPairs } from "./supplier-cross-pairs.js";

function part(overrides: Partial<SupplierPart> = {}): SupplierPart {
  return {
    brand: "MANN",
    crosses: [],
    guid: "g1",
    name: "Фильтр",
    partNumber: "W914/2",
    stocks: [],
    ...overrides,
  };
}

describe("extractCrossPairs", () => {
  it("pairs a top-level part with each of its direct crosses", () => {
    const tree = [part({
      crosses: [
        part({ brand: "MAHLE", guid: "c1", partNumber: "OC90" }),
        part({ brand: "BOSCH", guid: "c2", partNumber: "F026" }),
      ],
    })];

    expect(extractCrossPairs(tree)).toEqual([
      { partA: { article: "W914/2", brand: "MANN" }, partB: { article: "OC90", brand: "MAHLE" } },
      { partA: { article: "W914/2", brand: "MANN" }, partB: { article: "F026", brand: "BOSCH" } },
    ]);
  });

  it("also pairs a cross with its own nested crosses, without inventing a transitive top-level edge", () => {
    const grandchild = part({ brand: "FILTRON", guid: "gc1", partNumber: "OP520" });
    const child = part({ brand: "MAHLE", crosses: [grandchild], guid: "c1", partNumber: "OC90" });
    const tree = [part({ crosses: [child] })];

    const pairs = extractCrossPairs(tree);
    expect(pairs).toEqual([
      { partA: { article: "W914/2", brand: "MANN" }, partB: { article: "OC90", brand: "MAHLE" } },
      { partA: { article: "OC90", brand: "MAHLE" }, partB: { article: "OP520", brand: "FILTRON" } },
    ]);
    // Never a direct top-level <-> grandchild pair — that link was never
    // actually stated by the supplier's tree, only implied transitively.
    expect(pairs.some((pair) => pair.partA.article === "W914/2" && pair.partB.article === "OP520")).toBe(false);
  });

  it("skips a cross entry with a blank part number instead of recording a degenerate pair", () => {
    const tree = [part({ crosses: [part({ guid: "c1", partNumber: "" })] })];
    expect(extractCrossPairs(tree)).toEqual([]);
  });

  it("returns no pairs for a part with no crosses", () => {
    expect(extractCrossPairs([part()])).toEqual([]);
  });

  it("caps the number of pairs extracted from a pathological tree", () => {
    const manyCrosses = Array.from({ length: 1_500 }, (_, index) => part({ guid: `c${index}`, partNumber: `CP${index}` }));
    const tree = [part({ crosses: manyCrosses })];
    expect(extractCrossPairs(tree).length).toBe(1_000);
  });
});
