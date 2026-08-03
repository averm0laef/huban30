import { describe, expect, it } from "vitest";

import type { SupplierProvider, SupplierSearchResult } from "../adapters/provider-contracts.js";
import { SupplierSearchService } from "./supplier-search.service.js";

function makeSupplier(result: SupplierSearchResult): SupplierProvider {
  return { enabled: true, search: async () => result };
}

describe("SupplierSearchService", () => {
  it("rejects a query shorter than two characters before calling the provider", async () => {
    let called = false;
    const service = new SupplierSearchService({
      enabled: true,
      search: async () => { called = true; return { message: "", parts: [], success: true }; },
    });
    await expect(service.search({ q: "w" })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("tags every part and nested cross as under_order, never in_stock", async () => {
    const supplier = makeSupplier({
      message: "OK",
      parts: [{
        brand: "MANN",
        crosses: [{
          brand: "MAHLE",
          crosses: [],
          guid: "cross-1",
          name: "Аналог",
          partNumber: "OC90",
          stocks: [],
        }],
        guid: "g1",
        name: "Масляный фильтр",
        partNumber: "W914/2",
        stocks: [{ deliveryTime: "2", id: "s1", priceKopeks: 45_670, quantity: 12 }],
      }],
      success: true,
    });
    const service = new SupplierSearchService(supplier);

    const result = await service.search({ q: "W914/2" });
    expect(result.source).toBe("rossko");
    expect(result.query).toBe("W914/2");
    expect(result.parts[0]?.availability).toBe("under_order");
    expect(result.parts[0]?.crosses[0]?.availability).toBe("under_order");
    expect(result.parts[0]?.stocks[0]).toEqual({ deliveryTime: "2", id: "s1", priceKopeks: 45_670, quantity: 12 });
  });

  it("passes through a disabled or failed provider result without throwing", async () => {
    const service = new SupplierSearchService(makeSupplier({
      message: "Поиск у поставщика отключён",
      parts: [],
      success: false,
    }));
    const result = await service.search({ q: "W914/2" });
    expect(result).toEqual({
      message: "Поиск у поставщика отключён",
      parts: [],
      query: "W914/2",
      source: "rossko",
      success: false,
    });
  });
});
