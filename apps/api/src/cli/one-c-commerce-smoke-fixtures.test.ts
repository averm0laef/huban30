import { describe, expect, it, vi } from "vitest";

import { parseImportXml } from "../one-c-exchange/commerce-ml.parser.js";
import {
  buildCommerceSmokeDeletionXml,
  tombstoneCommerceSmokeCatalogFixture,
} from "./one-c-commerce-smoke-fixtures.js";

const FIXTURE = {
  brand: "1c-brand-56d984d045",
  category: "commerce-smoke-category-staging-v1",
  product: "commerce-smoke-product-staging-v1",
  sku: "CML-STAGING-SMOKE-V1",
};

describe("CommerceML staging smoke fixtures", () => {
  it("deactivates both the temporary product and its technical category through CommerceML", () => {
    const parsed = parseImportXml(buildCommerceSmokeDeletionXml(
      FIXTURE,
      "2026-08-15T00:00:00.000Z",
    ));

    expect(parsed.headerRows.find((row) => row.entityType === "category")).toMatchObject({
      externalId: FIXTURE.category,
      isActive: false,
    });
    expect(parsed.bodyRows.find((row) => row.entityType === "product")).toMatchObject({
      externalId: FIXTURE.product,
      isActive: false,
    });
  });

  it("uses exact fixture ids in fail-safe cleanup and protects populated categories", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);

    await tombstoneCommerceSmokeCatalogFixture(execute, FIXTURE);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[0]?.[0]).toContain("UPDATE app.products");
    expect(execute.mock.calls[0]?.[1]).toEqual([FIXTURE.product]);
    expect(execute.mock.calls[1]?.[0]).toContain("UPDATE app.categories AS category");
    expect(execute.mock.calls[1]?.[0]).toContain("NOT EXISTS");
    expect(execute.mock.calls[1]?.[0]).toContain("product.is_active");
    expect(execute.mock.calls[1]?.[0]).toContain("child.is_active");
    expect(execute.mock.calls[1]?.[1]).toEqual([FIXTURE.category]);
    expect(execute.mock.calls[2]?.[0]).toContain("UPDATE app.brands AS brand");
    expect(execute.mock.calls[2]?.[0]).toContain("product.brand_id=brand.id");
    expect(execute.mock.calls[2]?.[0]).toContain("product.is_active");
    expect(execute.mock.calls[2]?.[1]).toEqual([FIXTURE.brand]);
    const cleanupSql = execute.mock.calls.flatMap((call) => call).join(" ");
    expect(cleanupSql).not.toContain("LIKE");
    expect(cleanupSql).not.toContain("DELETE");
  });
});
