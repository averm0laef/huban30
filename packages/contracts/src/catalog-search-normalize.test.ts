import { describe, expect, it } from "vitest";

import {
  alternateSearchQueries,
  foldHomoglyphs,
  foldYo,
  normalizeArticleNumber,
  normalizeBrand,
  normalizeSearchQuery,
  swapKeyboardLayoutToCyrillic,
  transliterateLatinToCyrillic,
} from "./catalog-search-normalize.js";

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

describe("transliterateLatinToCyrillic", () => {
  it("phonetically transliterates a Latin spelling of a Cyrillic word", () => {
    // The task's own example: a customer types "filtr" meaning "фильтр".
    // The soft sign has no Latin sound, so this recovers as "филтр" -- close
    // enough for the caller's trigram-similarity fallback to still find it.
    expect(transliterateLatinToCyrillic("filtr")).toBe("филтр");
  });

  it("prefers the longest digraph match so 'shch' is not read as 'sh' + 'ch'", () => {
    expect(transliterateLatinToCyrillic("shchetka")).toBe("щетка");
  });

  it("leaves digits and punctuation untouched", () => {
    expect(transliterateLatinToCyrillic("tormoz-2000")).toBe("тормоз-2000");
  });
});

describe("swapKeyboardLayoutToCyrillic", () => {
  it("recovers a Cyrillic word typed with the OS keyboard layout left on English", () => {
    // The task's own example: "фильтр" typed on a QWERTY-mapped layout comes
    // out as "abkmnh" -- physical key position, not phonetics.
    expect(swapKeyboardLayoutToCyrillic("abkmnh")).toBe("фильтр");
  });

  it("is a different transformation from transliteration for the same input", () => {
    expect(swapKeyboardLayoutToCyrillic("filtr")).not.toBe(transliterateLatinToCyrillic("filtr"));
  });
});

describe("alternateSearchQueries", () => {
  it("returns both the transliteration and layout-swap candidates for a Latin query", () => {
    expect(alternateSearchQueries("filtr")).toEqual([
      transliterateLatinToCyrillic("filtr"),
      swapKeyboardLayoutToCyrillic("filtr"),
    ]);
    expect(alternateSearchQueries("filtr")).toEqual(["филтр", "ашдек"]);
  });

  it("returns nothing for a query that already contains Cyrillic letters", () => {
    expect(alternateSearchQueries("фильтр")).toEqual([]);
  });

  it("returns nothing for a short/mostly-numeric query such as an article number", () => {
    expect(alternateSearchQueries("w914-2")).toEqual([]);
    expect(alternateSearchQueries("12")).toEqual([]);
  });

  it("drops a candidate a digraph collapses below the minimum length, keeping the other", () => {
    // "sh" -> "ш" alone collapses the transliteration of "sha" to two
    // characters ("ша"), below MIN_ALTERNATE_QUERY_LENGTH -- only the
    // layout-swap candidate ("ырф") survives.
    expect(transliterateLatinToCyrillic("sha").length).toBeLessThan(3);
    expect(alternateSearchQueries("sha")).toEqual([swapKeyboardLayoutToCyrillic("sha")]);
  });
});

describe("foldYo", () => {
  it("folds ё to е -- the AN30 search-gap example", () => {
    // The task's own example: a product stored as "Щётка стеклоочистителя"
    // must be reachable by the plain, near-universal spelling "щетка".
    expect(foldYo("щётка")).toBe("щетка");
    expect(foldYo("Щётка стеклоочистителя Bosch 600мм")).toBe("Щетка стеклоочистителя Bosch 600мм");
  });

  it("folds both directions -- a query typed with ё and a query typed without ё converge to the same key", () => {
    // This is the actual fix, not just the fold in isolation: whichever
    // side (query or stored name) happens to use ё, both end up comparing
    // the same folded text -- see catalog-public.service.ts's module
    // comment on why the query and the generated name_folded/
    // search_text_folded columns (migration 0025) must run through an
    // equivalent fold.
    expect(foldYo("щётка")).toBe(foldYo("щетка"));
  });

  it("folds the upper-case letter too, independently of the rest of the string's case", () => {
    expect(foldYo("ЁЖИК")).toBe("ЕЖИК");
    expect(foldYo("Ёлка")).toBe("Елка");
  });

  it("leaves text with no ё/Ё untouched, including a plain article number", () => {
    expect(foldYo("Фильтр масляный")).toBe("Фильтр масляный");
    expect(foldYo("W 914/2")).toBe("W 914/2");
    expect(foldYo("")).toBe("");
  });

  it("is idempotent", () => {
    const once = foldYo("Щётка");
    expect(foldYo(once)).toBe(once);
  });
});
