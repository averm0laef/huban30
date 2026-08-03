import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import {
  SupplierSearchQuerySchema,
  type SupplierPartView,
  type SupplierSearchResponse,
} from "@an30/contracts";

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

// Every supplier part is tagged "under_order" — never the shop's own
// "в наличии" shelf-stock shape — so a client cannot render a Rossko result
// as if it were 1C inventory. See SupplierPartView in @an30/contracts.
function toPartView(part: SupplierPart): SupplierPartView {
  return {
    availability: "under_order",
    brand: part.brand,
    crosses: part.crosses.map(toPartView),
    guid: part.guid,
    name: part.name,
    partNumber: part.partNumber,
    stocks: part.stocks.map((stock) => ({
      deliveryTime: stock.deliveryTime,
      id: stock.id,
      priceKopeks: stock.priceKopeks,
      quantity: stock.quantity,
    })),
  };
}

@Injectable()
export class SupplierSearchService {
  constructor(@Inject(SUPPLIER_PROVIDER) private readonly supplier: SupplierProvider) {}

  async search(input: unknown): Promise<SupplierSearchResponse> {
    const query = parse(SupplierSearchQuerySchema, input);
    const result = await this.supplier.search(query.q);
    return {
      message: result.message,
      parts: result.parts.map(toPartView),
      query: query.q,
      source: "rossko",
      success: result.success,
    };
  }
}
