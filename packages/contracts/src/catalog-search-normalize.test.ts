import { describe, expect, it } from "vitest";

import { foldHomoglyphs, normalizeArticleNumber, normalizeBrand, normalizeSearchQuery } from "./catalog-search-normalize.js";

// apps/api/src/catalog/catalog-search-normalize.test.ts covers
// normalizeSearchQuery/foldHomoglyphs/normalizeArticleNumber against the
// re-exported shim; this file is the canonical location and adds the
// normalizeBrand coverage that module never had.

describe("normalizeArticleNumber", () => {
  it("folds Cyrillic С (Es) to Latin C regardless of which script the article used", () => {
    // The task's own example: a customer or 1C operator on a Russian
    // keyboard types Cyrillic С where a Latin C was meant.
    expect(normalizeArticleNumber("С1234")).toBe(normalizeArticleNumber("C1234"));
    expect(normalizeArticleNumber("С1234")).toBe("C1234");
  });

  it("treats spaces, dashes and slashes as the same nothing", () => {
    const canonical = normalizeArticleNumber("W9142");
    expect(normalizeArticleNumber("W 914/2")).toBe(canonical);
    expect(normalizeArticleNumber("W-914-2")).toBe(canonical);
    expect(normalizeArticleNumber("w914/2")).toBe(canonical);
  });
});

describe("normalizeBrand", () => {
  it("upper-cases and strips whitespace and hyphens", () => {
    const canonical = normalizeBrand("MANN");
    expect(normalizeBrand("mann")).toBe(canonical);
    expect(normalizeBrand("MANN-FILTER")).toBe("MANNFILTER");
    expect(normalizeBrand("MANN FILTER")).toBe("MANNFILTER");
    expect(normalizeBrand("  mann   filter  ")).toBe("MANNFILTER");
  });

  it("does not fold Cyrillic homoglyphs (unlike normalizeArticleNumber) or resolve synonyms", () => {
    // Deliberate: docs/CATALOG_MATCHING.md calls the brand-synonym table a
    // manually curated, hand-filled list -- normalizeBrand must not guess at
    // it, so two spellings that are not literally the same after the fold
    // stay distinct (the safe direction to fail in).
    expect(normalizeBrand("BOSCH")).not.toBe(normalizeBrand("БОШ"));
  });

  it("treats a missing brand as an empty, not a wildcard, key", () => {
    expect(normalizeBrand("")).toBe("");
    expect(normalizeBrand("   ")).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeBrand("Mann-Filter");
    expect(normalizeBrand(once)).toBe(once);
  });
});

describe("normalizeSearchQuery + foldHomoglyphs (re-check at the shared location)", () => {
  it("compose to the same canonical article form normalizeArticleNumber returns", () => {
    expect(foldHomoglyphs(normalizeSearchQuery("СР-914").toUpperCase()).replace(/[\s.\-/]+/gu, "")).toBe(
      normalizeArticleNumber("СР-914"),
    );
    expect(normalizeArticleNumber("СР-914")).toBe("CP914");
  });
});
