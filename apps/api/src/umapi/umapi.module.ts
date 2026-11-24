import { Module } from "@nestjs/common";

import { SuppliersModule } from "../suppliers/suppliers.module.js";

import { ProductPhotoNormalizer } from "../catalog/product-photo-normalizer.js";
import { PartsFinderCrossStore } from "../parts-finder/parts-finder-crosses.store.js";
import { PartsFinderShopService } from "../parts-finder/parts-finder-shop.service.js";
import { UmapiBudgetService } from "./umapi-budget.service.js";
import { UmapiCacheService } from "./umapi-cache.service.js";
import { UmapiCarCatalogueService } from "./umapi-car-catalogue.service.js";
import { UmapiPhotoArchiveService } from "./umapi-photo-archive.service.js";
import { UmapiProductCardService } from "./umapi-product-card.service.js";
import { StaffUmapiController, UmapiCarCatalogueController, UmapiController } from "./umapi.controller.js";
import { UmapiGateway } from "./umapi.gateway.js";
import { UmapiService } from "./umapi.service.js";

/**
 * UMAPI for the product page's catalogue buttons (docs/UMAPI_INTEGRATION.md): compatibility, cars a part fits,
 * analogs we sell, photo. The vehicle catalog the picker reads is our own table (parts-finder/vehicle-catalog.*);
 * this module asks the API only when a visitor presses a button. The shop lookup is our own database query; it holds
 * no state, so this module has its own instance.
 */
@Module({
  // Rossko's answer names the analogues of a product the catalogue cannot name (photo by an analogue).
  imports: [SuppliersModule],
  controllers: [UmapiController, UmapiCarCatalogueController, StaffUmapiController],
  exports: [UmapiService],
  providers: [PartsFinderCrossStore, PartsFinderShopService, ProductPhotoNormalizer, UmapiPhotoArchiveService, UmapiProductCardService, UmapiBudgetService, UmapiCacheService, UmapiCarCatalogueService, UmapiGateway, UmapiService],
})
export class UmapiModule {}
