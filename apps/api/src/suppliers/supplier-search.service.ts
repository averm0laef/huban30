import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import {
  SupplierSearchQuerySchema,
  type SupplierPartView,
  type SupplierSearchResponse,
} from "@an30/contracts";

import { applySupplierMarkup } from "./supplier-pricing.js";
import { extractCrossPairs } from "./supplier-cross-pairs.js";
import { rankSupplierParts } from "./supplier-ranking.js";
import { SupplierCrossQueueService } from "./supplier-cross-queue.service.js";
import {
  SUPPLIER_PROVIDER,
  type SupplierPart,
  type SupplierProvider,
} from "../adapters/provider-contracts.js";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({ error: "invalid_supplier_search_query", issues: result.error.issues });
  }
  return result.data;
}

/**
 * Response caps.
 *
 * A broad Russian query such as "тормозные колодки" comes back from Rossko
 * with dozens of parts, each carrying up to fifty analogues. Measured on the
 * live API that tree took about 19 s to answer and still 2.7 s when served
 * from cache, because the cost is in walking and serialising the tree rather
 * than in the network. Nobody shops through thousands of rows, so the
 * response is capped and the true total is reported alongside it.
 */
const MAX_PARTS_IN_RESPONSE = 24;
const MAX_CROSSES_IN_RESPONSE = 8;

// Every supplier part is tagged "under_order" — never the shop's own
// "в наличии" shelf-stock shape — so a client cannot render a Rossko result
// as if it were 1C inventory. See SupplierPartView in @an30/contracts.
function toPartView(part: SupplierPart, markupPercent: number, query: string): SupplierPartView {
  // Crosses get the same ranking pass as the top-level parts, for the same
  // reason: they are truncated to MAX_CROSSES_IN_RESPONSE right below, and
  // an unranked slice could just as easily cut the analogue with real stock
  // to keep one that has none. Ranking against the original query is a
  // no-op for the "exact match" signal here (a cross's partNumber, by
  // definition, differs from the query), which is fine — it simply leaves
  // hasOffers and name coherence to do the work among analogues.
  const rankedCrosses = rankSupplierParts(part.crosses, query);
  return {
    availability: "under_order",
    brand: part.brand,
    // Analogues are one level deep in the response: a cross of a cross is
    // noise for a shopper and multiplies the payload.
    crosses: rankedCrosses.slice(0, MAX_CROSSES_IN_RESPONSE).map((cross) => ({
      ...toPartView(cross, markupPercent, query),
      crosses: [],
    })),
    guid: part.guid,
    name: part.name,
    partNumber: part.partNumber,
    // Retail price only. The distributor's own figure never leaves the server.
    stocks: part.stocks.map((stock) => ({
      deliveryTime: stock.deliveryTime,
      id: stock.id,
      priceKopeks: applySupplierMarkup(stock.priceKopeks, markupPercent),
      quantity: stock.quantity,
    })),
  };
}

@Injectable()
export class SupplierSearchService {
  private readonly markupPercent: number;

  constructor(
    @Inject(SUPPLIER_PROVIDER) private readonly supplier: SupplierProvider,
    config: ConfigService,
    private readonly crossQueue: SupplierCrossQueueService,
  ) {
    this.markupPercent = config.get<number>("SUPPLIER_MARKUP_PERCENT") ?? 30;
  }

  async search(input: unknown): Promise<SupplierSearchResponse> {
    const query = parse(SupplierSearchQuerySchema, input);
    const result = await this.supplier.search(query.q);
    // Learn every cross this search turned up, but never make the customer
    // wait on it: persistence happens later, in apps/worker, off the
    // response path (see SupplierCrossQueueService and
    // apps/worker/src/article-cross-ingest.ts). Deliberately not awaited.
    // A failed SOAP result is not evidence, even if a malformed supplier
    // response happened to carry a PartsList alongside success=false.
    if (result.success) {
      const pairs = extractCrossPairs(result.parts);
      if (pairs.length > 0) this.crossQueue.enqueue(pairs);
    }
    // Rank before truncating: MAX_PARTS_IN_RESPONSE must cut the parts this
    // ranking pushed to the back (no offers, no match), never the best
    // answer, which is exactly what happened when the cap sliced Rossko's
    // own — unranked — order (see rankSupplierParts for the measured case).
    const ranked = rankSupplierParts(result.parts, query.q);
    const shown = ranked.slice(0, MAX_PARTS_IN_RESPONSE);
    return {
      message: result.message,
      parts: shown.map((part) => toPartView(part, this.markupPercent, query.q)),
      query: query.q,
      source: "rossko",
      success: result.success,
      totalFound: result.parts.length,
      truncated: result.parts.length > shown.length,
    };
  }
}
