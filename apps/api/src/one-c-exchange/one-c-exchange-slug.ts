// Slugs and brand keys synthesised for CommerceML rows that never carry a
// slug of their own. Every function here is pure and deterministic: the same
// name/externalId must always fold to the same slug, or an unchanged product
// would look "updated" on every sync and defeat the noop/idempotency
// detection in CatalogImportService (see one-c-exchange-run.service.ts,
// which resolves a row's version by comparing this output against what is
// already stored).

import { createHash } from "node:crypto";

import { normalizeSearchQuery } from "../catalog/catalog-search-normalize.js";

const TRANSLITERATION: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

function transliterate(value: string): string {
  return [...value.toLowerCase()].map((character) => TRANSLITERATION[character] ?? character).join("");
}

/** Short, stable, non-reversible id derived from a value — used to keep a synthesised slug unique per externalId without exposing 1C's raw identifier. */
export function shortId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 10);
}

/**
 * Builds a slug matching packages/contracts' SlugSchema (lowercase ASCII,
 * digits and single hyphens) from a human name plus a stable id. The id is
 * always suffixed so two products that happen to share a generic name (very
 * common in an auto-parts catalog — "Колодки тормозные" repeats constantly)
 * never collide, and so the slug is deterministic across repeated syncs.
 */
export function buildSlug(name: string, externalId: string): string {
  const base = transliterate(normalizeSearchQuery(name))
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-")
    .slice(0, 140);
  const suffix = shortId(externalId);
  return base ? `${base}-${suffix}` : `item-${suffix}`;
}

/** Deterministic key for a synthesised brand row: same manufacturer text (any case/spacing) always yields the same brand. */
export function buildBrandExternalId(manufacturerName: string): string {
  return `1c-brand-${shortId(normalizeSearchQuery(manufacturerName).toUpperCase())}`;
}
