import { describe, expect, it } from "vitest";

import { foldHomoglyphs, normalizeArticleNumber, normalizeSearchQuery } from "./catalog-search-normalize.js";

describe("normalizeSearchQuery", () => {
  it("trims and collapses internal whitespace without changing case", () => {
    expect(normalizeSearchQuery("  тормозные   колодки  ")).toBe("тормозные колодки");
    expect(normalizeSearchQuery("W914/2")).toBe("W914/2");
  });
});

describe("foldHomoglyphs", () => {
  it("maps the named confusable Cyrillic letters to their Latin lookalikes", () => {
    // The task's own examples: С -> C, А -> A, Р -> P.
    expect(foldHomoglyphs("САР")).toBe("CAP");
    expect(foldHomoglyphs("ABC")).toBe("ABC");
  });

  it("leaves non-confusable Cyrillic letters untouched", () => {
    expect(foldHomoglyphs("ДВИГАТЕЛЬ")).not.toBe("DVIGATEL'");
    expect(foldHomoglyphs("Ж")).toBe("Ж");
  });
});

describe("normalizeArticleNumber", () => {
  it("folds an article to the same key regardless of spacing, hyphenation and case", () => {
    const canonical = normalizeArticleNumber("W914/2");
    expect(normalizeArticleNumber("W 914/2")).toBe(canonical);
    expect(normalizeArticleNumber("w914-2")).toBe(canonical);
    expect(normalizeArticleNumber("  w 914 - 2  ")).toBe(canonical);
    expect(canonical).toBe("W9142");
  });

  it("folds a Cyrillic-homoglyph-mixed article to the same key as the pure-Latin form", () => {
    // А Russian keyboard slip: Cyrillic С (Es) and Р (Er) typed for Latin C and P.
    const latin = normalizeArticleNumber("CP-914");
    const mixed = normalizeArticleNumber("СР-914"); // Cyrillic С and Р
    expect(mixed).toBe(latin);
    expect(latin).toBe("CP914");
  });

  it("strips only the punctuation used in article numbers, not letters or digits", () => {
    expect(normalizeArticleNumber("A.B/C-D E")).toBe("ABCDE");
  });

  it("is idempotent and stable across repeated normalisation", () => {
    const once = normalizeArticleNumber("W 914/2");
    expect(normalizeArticleNumber(once)).toBe(once);
  });
});
