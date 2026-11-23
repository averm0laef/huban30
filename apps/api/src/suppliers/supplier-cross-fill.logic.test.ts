import { describe, expect, it } from "vitest";

import type { SupplierPart } from "../adapters/provider-contracts.js";
import { decideSupplierLookup } from "./supplier-cross-fill.logic.js";

function part(brand: string, partNumber: string, crosses: SupplierPart[] = []): SupplierPart {
  return { brand, crosses, guid: `${brand}-${partNumber}`, name: "Фильтр масляный", partNumber, stocks: [] };
}

const IDENTITIES = new Map([["MANN", "MANNFILTER"]]);

describe("decideSupplierLookup", () => {
  it("stores the analogs of the part that carries our number under our brand", () => {
    const decision = decideSupplierLookup(
      [part("MANN-FILTER", "W 914/2", [part("BOSCH", "0451103318"), part("FILTRON", "OP 525")])],
      { brand: "MANN", sku: "W914/2" },
      IDENTITIES,
    );

    expect(decision.status).toBe("found");
    expect(decision.pairs).toEqual([
      { partA: { article: "W 914/2", brand: "MANN-FILTER" }, partB: { article: "0451103318", brand: "BOSCH" } },
      { partA: { article: "W 914/2", brand: "MANN-FILTER" }, partB: { article: "OP 525", brand: "FILTRON" } },
    ]);
  });

  it("stores nothing when the supplier knows the number only under other brands", () => {
    const decision = decideSupplierLookup(
      [part("SAKURA", "C-1004", [part("BOSCH", "0451103318")]), part("NIPPARTS", "C1004")],
      { brand: "FRAM", sku: "C1004" },
      IDENTITIES,
    );

    expect(decision).toEqual({ note: "SAKURA, NIPPARTS", pairs: [], status: "brand_mismatch" });
  });

  it("ignores parts the supplier matched by something other than our number", () => {
    const decision = decideSupplierLookup(
      [part("MANN-FILTER", "W914/26", [part("BOSCH", "0451103318")])],
      { brand: "MANN", sku: "W914/2" },
      IDENTITIES,
    );

    expect(decision).toEqual({ note: null, pairs: [], status: "not_found" });
  });

  it("keeps only our brand's analogs when several brands share the number", () => {
    const decision = decideSupplierLookup(
      [part("SAKURA", "C1004", [part("TOYOTA", "9091510001")]), part("FRAM", "C1004", [part("MANN-FILTER", "W 610/3")])],
      { brand: "Fram", sku: "C1004" },
      IDENTITIES,
    );

    expect(decision.pairs).toEqual([
      { partA: { article: "C1004", brand: "FRAM" }, partB: { article: "W 610/3", brand: "MANN-FILTER" } },
    ]);
  });

  it("says so when the supplier knows our part but names no analogs", () => {
    expect(decideSupplierLookup([part("MANN-FILTER", "W914/2")], { brand: "MANN-FILTER", sku: "W914/2" }, IDENTITIES))
      .toEqual({ note: null, pairs: [], status: "no_crosses" });
  });

  it("reports an empty answer as not found", () => {
    expect(decideSupplierLookup([], { brand: "MANN", sku: "W914/2" }, IDENTITIES).status).toBe("not_found");
  });
});
