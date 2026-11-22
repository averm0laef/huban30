import { Module } from "@nestjs/common";

import { CatalogCategoryTreeCache } from "./catalog-category-tree-cache.service.js";
import { CatalogImportController, OneCMachineController } from "./catalog-import.controller.js";
import { CatalogPublicController } from "./catalog-public.controller.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { CatalogSearchController } from "./catalog-search.controller.js";
import { CatalogSearchService } from "./catalog-search.service.js";
import { CatalogApplyService } from "./catalog-apply.service.js";
import { CatalogImportService } from "./catalog-import.service.js";
import { CatalogRecategorizeService } from "./catalog-recategorize.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";
import { CatalogEnrichmentController } from "./catalog-enrichment.controller.js";
import { CatalogEnrichmentService } from "./catalog-enrichment.service.js";
import { CatalogSearchLogService } from "./catalog-search-log.service.js";
import { CatalogQualityController } from "./catalog-quality.controller.js";
import { CatalogQualityService } from "./catalog-quality.service.js";

@Module({
  controllers: [
    CatalogEnrichmentController,
    CatalogImportController,
    CatalogPublicController,
    CatalogQualityController,
    CatalogSearchController,
    OneCMachineController,
  ],
  // CatalogSearchService is exported so the chat assistant (see
  // chat/chat-assistant.service.ts) can reuse the exact same deterministic
  // catalog search the storefront uses, rather than querying the catalog a
  // second, different way. CatalogCategoryTreeCache and OneCIntegrationService
  // are exported so one-c-exchange.module.ts can share the same cache
  // instance (a category the exchange writes must invalidate the same tree
  // the storefront reads) and the same integration_key='one_c' credentials
  // OneCMachineController already authenticates against, instead of standing
  // up a second, disconnected copy of either.
  exports: [CatalogCategoryTreeCache, CatalogSearchService, OneCIntegrationService],
  providers: [
    CatalogEnrichmentService,
    CatalogApplyService,
    CatalogCategoryTreeCache,
    CatalogImportService,
    CatalogPublicService,
    CatalogQualityService,
    CatalogRecategorizeService,
    CatalogSearchService,
    CatalogSearchLogService,
    OneCIntegrationService,
  ],
})
export class CatalogModule {}
