import { describe, expect, it } from "vitest";

import { catalogQueryPrefillMessage, EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY, EXPERT_HELP_PRODUCT_STORAGE_KEY, productCompatibilityPrefillMessage } from "./expert-help-prefill";

describe("catalog expert-help prefill", () => {
  it("retains the searched part and asks for vehicle details", () => {
    expect(catalogQueryPrefillMessage("W914/2")).toBe(
      "Ищу деталь: W914/2\nАвтомобиль: ",
    );
    expect(EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY).toBe("an30:expert-help:catalog-query-prefill");
  });

  it("retains the exact product name and article for a compatibility request", () => {
    expect(productCompatibilityPrefillMessage("Фильтр масляный", "W914/2")).toBe(
      "Проверьте совместимость детали «Фильтр масляный», артикул W914/2.\nАвтомобиль: ",
    );
    expect(EXPERT_HELP_PRODUCT_STORAGE_KEY).toBe("an30:expert-help:product-prefill");
  });
});
