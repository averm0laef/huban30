import { Inject, Injectable } from "@nestjs/common";

import { CatalogSearchQuerySchema } from "@an30/contracts";

import { AI_PROVIDER, type AiProvider } from "../adapters/provider-contracts.js";
import { CatalogPublicService } from "./catalog-public.service.js";

@Injectable()
export class CatalogSearchService {
  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly catalog: CatalogPublicService,
  ) {}

  async search(input: unknown) {
    const query = CatalogSearchQuerySchema.parse(input);
    // Keep the compatibility endpoint, but delegate publication, currency,
    // inventory and ancestor visibility to the single public catalog policy.
    const result = await this.catalog.products({
      availability: "all",
      limit: query.limit,
      offset: 0,
      q: query.q,
      sort: "relevance",
    });
    return {
      ai: {
        enabled: this.ai.enabled,
        fallback: this.ai.enabled ? null : "AI отключён, используется точный поиск по каталогу 1С",
      },
      items: result.items,
      query: query.q,
    };
  }
}
