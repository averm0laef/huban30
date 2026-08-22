import { describe, expect, it, vi } from "vitest";

import type { SupplierCrossPair } from "@an30/contracts";

import {
  canonicalizeCrossPair,
  dedupeCanonicalCrossPairs,
  ingestArticleCrosses,
  type CrossIngestExecutor,
} from "./article-cross-ingest.js";

function pair(articleA: string, brandA: string, articleB: string, brandB: string): SupplierCrossPair {
  return { partA: { article: articleA, brand: brandA }, partB: { article: articleB, brand: brandB } };
}

describe("canonicalizeCrossPair", () => {
  it("is symmetric: swapping partA/partB produces the identical canonical record", () => {
    const forward = canonicalizeCrossPair(pair("W914/2", "MANN", "OC90", "MAHLE"));
    const reverse = canonicalizeCrossPair(pair("OC90", "MAHLE", "W914/2", "MANN"));
    expect(forward).not.toBeNull();
    expect(forward).toEqual(reverse);
  });

  it("normalises Cyrillic-homoglyph and differently-punctuated articles to the same canonical identity", () => {
    // "СР-914" (Cyrillic С, Р) is a keyboard slip for Latin "CP-914" — both
    // must canonicalize identically, and so must "w 914/2" vs "W914-2". Raw
    // display fields legitimately differ (they preserve what was actually
    // typed); only the normalised identity has to agree.
    const a = canonicalizeCrossPair(pair("W 914/2", "Mann", "СР-914", "Bosch"));
    const b = canonicalizeCrossPair(pair("w914-2", "MANN", "CP-914", "BOSCH"));
    expect({ articleA: a?.articleA, brandA: a?.brandA, articleB: a?.articleB, brandB: a?.brandB, confident: a?.confident })
      .toEqual({ articleA: b?.articleA, brandA: b?.brandA, articleB: b?.articleB, brandB: b?.brandB, confident: b?.confident });
    expect(a?.articleA).toBe("CP914");
    expect(a?.articleB).toBe("W9142");
  });

  it("marks a pair confirmed only when both sides carry a brand", () => {
    expect(canonicalizeCrossPair(pair("W914/2", "MANN", "OC90", "MAHLE"))?.confident).toBe(true);
    expect(canonicalizeCrossPair(pair("W914/2", "MANN", "OC90", ""))?.confident).toBe(false);
    expect(canonicalizeCrossPair(pair("W914/2", "", "OC90", ""))?.confident).toBe(false);
  });

  it("rejects a pair with a blank article on either side", () => {
    expect(canonicalizeCrossPair(pair("", "MANN", "OC90", "MAHLE"))).toBeNull();
    expect(canonicalizeCrossPair(pair("W914/2", "MANN", "", "MAHLE"))).toBeNull();
  });

  it("rejects a self-pair once both sides normalise to the same article and brand", () => {
    expect(canonicalizeCrossPair(pair("W 914/2", "Mann", "w914-2", "MANN"))).toBeNull();
    // Same normalised article but a genuinely different brand is NOT a
    // self-pair — that is two different real parts that happen to share a
    // number under different brands.
    expect(canonicalizeCrossPair(pair("W914/2", "MANN", "W914/2", "BOSCH"))).not.toBeNull();
  });

  it("preserves the original, unnormalised spelling for display", () => {
    const record = canonicalizeCrossPair(pair("w 914 - 2", "mann", "OC-90", "Mahle"));
    expect([record?.articleARaw, record?.articleBRaw]).toContain("w 914 - 2");
    expect([record?.articleARaw, record?.articleBRaw]).toContain("OC-90");
  });
});

describe("dedupeCanonicalCrossPairs", () => {
  it("collapses the same pair seen from both directions into one record", () => {
    const records = dedupeCanonicalCrossPairs([
      pair("W914/2", "MANN", "OC90", "MAHLE"),
      pair("OC90", "MAHLE", "W914/2", "MANN"),
    ]);
    expect(records).toHaveLength(1);
  });

  it("collapses duplicate sightings that only differ in raw spacing/case into one confirmed record", () => {
    // Confidence is derived from the (article, brand) key itself, so two
    // sightings of the identical key always agree on confidence -- this
    // checks the dedup only keeps one row, not two, once formatting-only
    // differences are normalised away.
    const records = dedupeCanonicalCrossPairs([
      pair("W914/2", "MANN", "OC90", "MAHLE"),
      pair("w 914-2", "mann", "oc90", "Mahle"),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]?.confident).toBe(true);
  });

  it("keeps two distinct records when the same article is claimed under genuinely different brands", () => {
    // brand is part of the matching key (docs/CATALOG_MATCHING.md): an
    // article number with no stated brand and the same number under a real
    // brand are different identities, not the same pair at different
    // confidence -- deduping must not merge them.
    const records = dedupeCanonicalCrossPairs([
      pair("W914/2", "MANN", "OC90", ""),
      pair("W914/2", "MANN", "OC90", "MAHLE"),
    ]);
    expect(records).toHaveLength(2);
  });

  it("drops degenerate pairs (blank article, self-pair) without throwing", () => {
    expect(dedupeCanonicalCrossPairs([pair("", "MANN", "OC90", "MAHLE")])).toEqual([]);
  });
});

describe("ingestArticleCrosses", () => {
  function mockDatabase(): CrossIngestExecutor & { query: ReturnType<typeof vi.fn> } {
    return { query: vi.fn().mockResolvedValue({ rows: [] }) };
  }

  it("issues a single idempotent upsert statement for a batch, deduped by canonical pair", async () => {
    const database = mockDatabase();
    const pairs = [
      pair("W914/2", "MANN", "OC90", "MAHLE"),
      pair("w914-2", "mann", "oc-90", "mahle"), // same physical pair, different raw formatting
    ];

    const result = await ingestArticleCrosses(database, pairs, "rossko");

    expect(result).toEqual({ ingested: 1, skipped: 1 });
    expect(database.query).toHaveBeenCalledTimes(1);
    const [sql, values] = database.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (article_a, brand_a, article_b, brand_b) DO UPDATE");
    expect(sql).toContain("app.article_crosses.status = 'confirmed'");
    expect(sql).toContain("WHEN EXCLUDED.status = 'confirmed' THEN EXCLUDED.source");
    // article_a/article_b arrays (positions 1 and 5)
    expect(values[0]).toEqual(["OC90"]);
    expect(values[4]).toEqual(["W9142"]);
    // source and status arrays
    expect(values[8]).toEqual(["rossko"]);
    // Supplier crosses are evidence for the review queue, never enough to
    // widen customer search automatically (docs/CATALOG_MATCHING.md).
    expect(values[9]).toEqual(["unconfirmed"]);
    expect(values[10]).toEqual([null]);
  });

  it("running the same batch twice is idempotent: two calls, same canonical parameters each time", async () => {
    const database = mockDatabase();
    const pairs = [pair("W914/2", "MANN", "OC90", "MAHLE")];

    await ingestArticleCrosses(database, pairs, "rossko");
    await ingestArticleCrosses(database, pairs, "rossko");

    expect(database.query).toHaveBeenCalledTimes(2);
    const [, firstValues] = database.query.mock.calls[0] as [string, unknown[]];
    const [, secondValues] = database.query.mock.calls[1] as [string, unknown[]];
    // Same identity columns both times (article/brand arrays); confirmed_at
    // (index 10) is a fresh timestamp each call, which is fine — the SQL's
    // never-downgrade CASE (asserted above) is what keeps a real database
    // from overwriting an already-confirmed row's confirmed_at.
    expect(firstValues.slice(0, 9)).toEqual(secondValues.slice(0, 9));
  });

  it("marks an unconfirmed pair with a null confirmed_at, never auto-widening search", async () => {
    const database = mockDatabase();
    await ingestArticleCrosses(database, [pair("W914/2", "MANN", "OC90", "")], "rossko");

    const [, values] = database.query.mock.calls[0] as [string, unknown[]];
    expect(values[9]).toEqual(["unconfirmed"]);
    expect(values[10]).toEqual([null]);
  });

  it("confirms a complete pair only when it was explicitly entered through the manual source", async () => {
    const database = mockDatabase();
    await ingestArticleCrosses(database, [pair("W914/2", "MANN", "OC90", "MAHLE")], "manual");

    const [, values] = database.query.mock.calls[0] as [string, unknown[]];
    expect(values[9]).toEqual(["confirmed"]);
    expect(values[10]).toEqual([expect.any(String)]);
  });

  it("does nothing and reports every pair skipped when the batch has no linkable pairs", async () => {
    const database = mockDatabase();
    const result = await ingestArticleCrosses(database, [pair("", "MANN", "OC90", "MAHLE")], "rossko");
    expect(result).toEqual({ ingested: 0, skipped: 1 });
    expect(database.query).not.toHaveBeenCalled();
  });
});
