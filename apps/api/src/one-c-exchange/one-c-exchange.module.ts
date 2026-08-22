import { Module } from "@nestjs/common";

import { CatalogModule } from "../catalog/catalog.module.js";
import { OneCExchangeSessionService } from "./one-c-exchange-session.service.js";
import { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";
import { OneCExchangeController } from "./one-c-exchange.controller.js";
import { OneCExchangeService } from "./one-c-exchange.service.js";

// Imports CatalogModule rather than redeclaring OneCIntegrationService or
// CatalogCategoryTreeCache: this exchange and the pre-existing JSON machine
// endpoint (catalog/catalog-import.controller.ts) are two wire protocols for
// the *same* 1С integration, and the storefront's category tree cache must
// stay a single shared instance regardless of which pipeline last changed a
// category.
@Module({
  controllers: [OneCExchangeController],
  imports: [CatalogModule],
  providers: [OneCExchangeService, OneCExchangeSessionService, OneCExchangeTempStorageService],
})
export class OneCExchangeModule {}
