import { normalizeSearchQuery } from "@an30/contracts";

import type { SupplierPart } from "../adapters/provider-contracts.js";

/**
 * Reorders a Rossko search result so the customer sees what they can
 * actually buy, and the best match, first.
 *
 * Rossko's own GetSearch is a fuzzy match against a normalised article
 * number, not the exact string the customer typed. A search for "W 914/2"
 * (a real Mann oil filter, the shop's own reference case) also surfaces
 * "W9142" results from completely unrelated parts — even a radiator hose —
 * purely because stripping the space and the slash makes the two strings
 * equal to Rossko's engine. Measured on the live API, that search put the
 * zero-stock radiator hose first and the five-offer exact match for the
 * genuine Mann filter last. Rossko returns these in whatever order its own
 * engine ranked them, which tracks neither purchasability nor how closely a
 * result actually matches what was typed — so this function re-derives an
 * order that does, before the response is built and, critically, before
 * MAX_PARTS_IN_RESPONSE / MAX_CROSSES_IN_RESPONSE in supplier-search.service.ts
 * truncate the list. Ranking after truncation would let the cap silently
 * discard the best answer to keep a worse one that merely happened to sort
 * earlier in Rossko's own response.
 *
 * Three signals, applied in this priority order:
 *
 *  1. Has an offer at all. A part with an empty `stocks` is not something
 *     the customer can put in a basket today; it must never outrank a part
 *     with real stock, however good the paper match looks. Zero-offer parts
 *     are pushed to the bottom here, not dropped and not collapsed into a
 *     separate group: they still carry crosses/analogue information worth
 *     learning (see supplier-cross-pairs.ts), the storefront's own
 *     filterSupplierParts (apps/web/app/(store)/_lib/supplier-results.ts)
 *     already hides an entry that ends up with no offer of its own and no
 *     priced analogue, and collapsing them here would mean widening the
 *     public contract (SupplierSearchResponseSchema) for comparatively
 *     little benefit. This function only ever reorders; it never removes a
 *     part the rest of the system might still use.
 *  2. Exact match to what was typed. Comparing the query and the returned
 *     article through the same light fold used for the outbound SOAP call
 *     (trim, collapse whitespace, upper-case — nothing else stripped) tells
 *     apart "W 914/2" (what the customer typed, verbatim) from "W9142" (a
 *     normalised-article collision Rossko's engine treated as equivalent
 *     only after discarding punctuation). The former is direct evidence the
 *     customer found their part; the latter is much weaker and must rank
 *     below it.
 *  3. Name coherence. When most of the results for a query share the same
 *     kind of part — going by the first word of the name, so "Фильтр
 *     масляный" and "Фильтр масляный ВАЗ 2108-" still agree — a result
 *     whose name starts with a completely different word ("Шланг
 *     радиатора" among a page of filters) is almost certainly an article
 *     collision, not a real alternative. This is a demotion, not a filter:
 *     the outlier is never dropped, because a wrong exclusion silently
 *     loses a part the customer might actually have wanted, where a wrong
 *     position is merely a worse ranking and the part is still visible.
 *     With no clear plurality (every name distinct, or every part sharing
 *     one name) the signal cannot distinguish anything meaningful, so it is
 *     left inactive rather than demoting arbitrarily.
 *
 * Ties at every level keep Rossko's own relative order (a stable sort) —
 * that ordering is a weak prior, not evidence to discard, once the signals
 * above have already separated the strong matches from the noise.
 */
export function rankSupplierParts(parts: readonly SupplierPart[], rawQuery: string): SupplierPart[] {
  if (parts.length <= 1) return [...parts];

  const foldedQuery = normalizeSearchQuery(rawQuery).toUpperCase();
  const { majorityKey, signalActive } = nameMajority(parts);

  const scored = parts.map((part, index) => ({
    index,
    part,
    score: scorePart(part, foldedQuery, majorityKey, signalActive),
  }));

  scored.sort((a, b) => {
    if (a.score.hasOffers !== b.score.hasOffers) return b.score.hasOffers - a.score.hasOffers;
    if (a.score.exactMatch !== b.score.exactMatch) return b.score.exactMatch - a.score.exactMatch;
    if (a.score.nameCoherent !== b.score.nameCoherent) return b.score.nameCoherent - a.score.nameCoherent;
    // Stable fallback: preserve Rossko's own relative order.
    return a.index - b.index;
  });

  return scored.map((entry) => entry.part);
}

function nameKey(name: string): string {
  const [firstWord = ""] = normalizeSearchQuery(name).toLowerCase().split(" ");
  return firstWord;
}

function nameMajority(parts: readonly SupplierPart[]): { majorityKey: string; signalActive: boolean } {
  const counts = new Map<string, number>();
  for (const part of parts) {
    const key = nameKey(part.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let majorityKey = "";
  let majorityCount = 0;
  for (const [key, count] of counts) {
    if (count > majorityCount) {
      majorityKey = key;
      majorityCount = count;
    }
  }

  // A plurality of exactly one part proves nothing (every name could be
  // distinct), and a plurality covering every part means there is no
  // outlier to demote in the first place — in both cases the signal stays
  // inactive so every part scores as coherent.
  const signalActive = majorityCount > 1 && majorityCount < parts.length;
  return { majorityKey, signalActive };
}

interface PartScore {
  exactMatch: 0 | 1;
  hasOffers: 0 | 1;
  nameCoherent: 0 | 1;
}

function scorePart(
  part: SupplierPart,
  foldedQuery: string,
  majorityNameKey: string,
  nameSignalActive: boolean,
): PartScore {
  return {
    exactMatch: normalizeSearchQuery(part.partNumber).toUpperCase() === foldedQuery ? 1 : 0,
    hasOffers: part.stocks.length > 0 ? 1 : 0,
    nameCoherent: !nameSignalActive || nameKey(part.name) === majorityNameKey ? 1 : 0,
  };
}
