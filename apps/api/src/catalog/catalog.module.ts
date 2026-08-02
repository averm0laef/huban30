import { Module } from "@nestjs/common";

import { CatalogImportController, OneCMachineController } from "./catalog-import.controller.js";
import { CatalogSearchController } from "./catalog-search.controller.js";
import { CatalogSearchService } from "./catalog-search.service.js";
import { CatalogApplyService } from "./catalog-apply.service.js";
import { CatalogImportService } from "./catalog-import.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";

@Module({
  controllers: [CatalogImportController, CatalogSearchController, OneCMachineController],
  providers: [CatalogApplyService, CatalogImportService, CatalogSearchService, OneCIntegrationService],
})
export class CatalogModule {}
