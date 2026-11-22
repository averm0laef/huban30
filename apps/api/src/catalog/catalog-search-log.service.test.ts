import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import { CatalogSearchLogService } from "./catalog-search-log.service.js";

function service() {
  const query = vi.fn(async () => ({ rows: [] }));
  return { log: new CatalogSearchLogService({ query } as unknown as DatabaseService), query };
}

describe("CatalogSearchLogService", () => {
  it("records the cleaned first-page query with its result count", () => {
    const { log, query } = service();
    log.record({ q: "Колодки  Веста", offset: "0" }, 0);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("catalog_search_log"), ["колодки веста", 0]);
  });
  it("ignores later pages, browsing without text and bad counts", () => {
    const { log, query } = service();
    log.record({ q: "фильтр", offset: "24" }, 10);
    log.record({ category: "filtry" }, 10);
    log.record({ q: "фильтр" }, undefined);
    expect(query).not.toHaveBeenCalled();
  });
  it("never throws when the insert fails", async () => {
    const query = vi.fn(async () => { throw new Error("relation does not exist"); });
    const log = new CatalogSearchLogService({ query } as unknown as DatabaseService);
    expect(() => log.record({ q: "масло" }, 3)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
