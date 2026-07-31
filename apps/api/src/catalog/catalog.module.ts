import { Module } from "@nestjs/common";

import { CatalogImportController, OneCMachineController } from "./catalog-import.controller.js";
import { CatalogApplyService } from "./catalog-apply.service.js";
import { CatalogImportService } from "./catalog-import.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";

@Module({
  controllers: [CatalogImportController, OneCMachineController],
  providers: [CatalogApplyService, CatalogImportService, OneCIntegrationService],
})
export class CatalogModule {}
