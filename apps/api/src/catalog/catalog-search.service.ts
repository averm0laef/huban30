import { Inject, Injectable } from "@nestjs/common";

import { CatalogSearchQuerySchema } from "@an30/contracts";

import { AI_PROVIDER, type AiProvider } from "../adapters/provider-contracts.js";
import { DatabaseService } from "../infrastructure/database.service.js";

interface SearchRow {
  available_quantity: string;
  id: string;
  name: string;
  price_kopeks: string | null;
  sku: string;
  slug: string;
}

@Injectable()
export class CatalogSearchService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async search(input: unknown) {
    const query = CatalogSearchQuerySchema.parse(input);
    // Catalog ranking stays reproducible even if an AI assistant is connected later.
    const terms = [query.q];
    const result = await this.database.query<SearchRow>(
      `WITH input AS (
         SELECT term,websearch_to_tsquery('simple',term) AS search_query
         FROM unnest($1::text[]) AS term
       )
       SELECT product.id,product.sku::text,product.name,product.slug::text,
              price.amount_kopeks::text AS price_kopeks,
              COALESCE(stock.available_quantity,0)::text AS available_quantity
       FROM app.products AS product
       LEFT JOIN LATERAL (
         SELECT amount_kopeks FROM app.product_prices
         WHERE product_id=product.id AND valid_to IS NULL
         ORDER BY valid_from DESC,id DESC LIMIT 1
       ) AS price ON true
       LEFT JOIN LATERAL (
         SELECT sum(quantity_on_hand-quantity_reserved) AS available_quantity
         FROM app.inventory_balances WHERE product_id=product.id
       ) AS stock ON true
       WHERE product.deleted_at IS NULL AND product.is_active
         AND EXISTS (
           SELECT 1 FROM input
           WHERE product.sku::text ILIKE term || '%'
              OR product.name ILIKE '%' || term || '%'
              OR to_tsvector('simple',coalesce(product.search_text,product.name)) @@ search_query
         )
       ORDER BY
         (lower(product.sku::text)=lower($2)) DESC,
         (product.sku::text ILIKE $2 || '%') DESC,
         (SELECT max(ts_rank_cd(
           to_tsvector('simple',coalesce(product.search_text,product.name)),search_query
         )) FROM input) DESC NULLS LAST,
         lower(product.name),product.id
       LIMIT $3`,
      [terms, query.q, query.limit],
    );
    return {
      ai: {
        enabled: this.ai.enabled,
        fallback: this.ai.enabled ? null : "AI отключён — используется точный поиск по каталогу 1С",
      },
      items: result.rows.map((row) => ({
        availableQuantity: Number(row.available_quantity),
        id: row.id,
        name: row.name,
        priceKopeks: row.price_kopeks === null ? null : Number(row.price_kopeks),
        sku: row.sku,
        slug: row.slug,
      })),
      query: query.q,
    };
  }
}
