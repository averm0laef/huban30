import { describe, expect, it } from "vitest";

import { catalogSearchHref, normalizeCatalogSearchText } from "./catalog-search-url";

describe("catalogSearchHref", () => {
  it("keeps the full search query when opening catalog results", () => {
    expect(catalogSearchHref("насос 123/AB?")).toBe("/catalog?q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81+123%2FAB%3F");
  });

  it("turns a pasted tab, line break or non-breaking space into one space", () => {
    expect(normalizeCatalogSearchText(" W914\t2\n")).toBe("W914 2");
    expect(normalizeCatalogSearchText("0\u00a0986\u00a0494\u00a0104")).toBe("0 986 494 104");
    expect(catalogSearchHref("  W 914/2  ")).toBe("/catalog?q=W+914%2F2");
  });

  it("caps the text at the catalog API limit", () => {
    expect(normalizeCatalogSearchText("а".repeat(200))).toHaveLength(120);
  });
});
