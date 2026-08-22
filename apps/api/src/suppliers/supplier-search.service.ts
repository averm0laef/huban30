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
function toPartView(part: SupplierPart, markupPercent: number): SupplierPartView {
  return {
    availability: "under_order",
    brand: part.brand,
    // Analogues are one level deep in the response: a cross of a cross is
    // noise for a shopper and multiplies the payload.
    crosses: part.crosses.slice(0, MAX_CROSSES_IN_RESPONSE).map((cross) => ({
      ...toPartView(cross, markupPercent),
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
    const shown = result.parts.slice(0, MAX_PARTS_IN_RESPONSE);
    return {
      message: result.message,
      parts: shown.map((part) => toPartView(part, this.markupPercent)),
      query: query.q,
      source: "rossko",
      success: result.success,
      totalFound: result.parts.length,
      truncated: result.parts.length > shown.length,
    };
  }
}
