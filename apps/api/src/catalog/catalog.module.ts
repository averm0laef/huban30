import { Module } from "@nestjs/common";

import { CatalogImportController, OneCMachineController } from "./catalog-import.controller.js";
import { CatalogPublicController } from "./catalog-public.controller.js";
import { CatalogPublicService } from "./catalog-public.service.js";
import { CatalogSearchController } from "./catalog-search.controller.js";
import { CatalogSearchService } from "./catalog-search.service.js";
import { CatalogApplyService } from "./catalog-apply.service.js";
import { CatalogImportService } from "./catalog-import.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";

@Module({
  controllers: [
    CatalogImportController,
    CatalogPublicController,
    CatalogSearchController,
    OneCMachineController,
  ],
  providers: [
    CatalogApplyService,
    CatalogImportService,
    CatalogPublicService,
    CatalogSearchService,
    OneCIntegrationService,
  ],
})
export class CatalogModule {}
