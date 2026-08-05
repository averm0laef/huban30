import { describe, expect, it } from "vitest";

import type { SupplierProvider, SupplierSearchResult } from "../adapters/provider-contracts.js";
import type { ConfigService } from "@nestjs/config";

// Markup is applied server-side; tests pin it so expected prices are explicit.
function makeConfig(markupPercent = 30): ConfigService {
  return { get: () => markupPercent } as unknown as ConfigService;
}

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
    }, makeConfig());
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
    const service = new SupplierSearchService(supplier, makeConfig());

    const result = await service.search({ q: "W914/2" });
    expect(result.source).toBe("rossko");
    expect(result.query).toBe("W914/2");
    expect(result.parts[0]?.availability).toBe("under_order");
    expect(result.parts[0]?.crosses[0]?.availability).toBe("under_order");
    // 456.70 at the shop's 30% margin, rounded up to a whole rouble.
    expect(result.parts[0]?.stocks[0]).toEqual({ deliveryTime: "2", id: "s1", priceKopeks: 59_400, quantity: 12 });
  });

  it("passes through a disabled or failed provider result without throwing", async () => {
    const service = new SupplierSearchService(makeSupplier({
      message: "Поиск у поставщика отключён",
      parts: [],
      success: false,
    }), makeConfig());
    const result = await service.search({ q: "W914/2" });
    expect(result).toEqual({
      message: "Поиск у поставщика отключён",
      parts: [],
      query: "W914/2",
      source: "rossko",
      success: false,
      totalFound: 0,
      truncated: false,
    });
  });

  it("caps a large result set and reports the true total", async () => {
    // A broad Russian query returns dozens of parts, each with up to fifty
    // analogues. Serialising that whole tree is what made the endpoint slow,
    // so the response is capped while the real count stays visible.
    const part = (index: number) => ({
      brand: `B${index}`,
      crosses: Array.from({ length: 30 }, (_, c) => ({
        brand: `C${c}`, crosses: [], guid: `cg${index}-${c}`,
        name: `cross ${c}`, partNumber: `CP${c}`, stocks: [],
      })),
      guid: `g${index}`,
      name: `part ${index}`,
      partNumber: `P${index}`,
      stocks: [],
    });
    const service = new SupplierSearchService(makeSupplier({
      message: "",
      parts: Array.from({ length: 54 }, (_, i) => part(i)),
      success: true,
    }), makeConfig());

    const result = await service.search({ q: "тормозные колодки" });

    expect(result.parts).toHaveLength(24);
    expect(result.totalFound).toBe(54);
    expect(result.truncated).toBe(true);
    expect(result.parts[0]?.crosses).toHaveLength(8);
    // Analogues stay one level deep so the payload cannot fan out.
    expect(result.parts[0]?.crosses[0]?.crosses).toEqual([]);
  });
});
