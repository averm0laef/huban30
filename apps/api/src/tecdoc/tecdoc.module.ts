import { Module } from "@nestjs/common";

import { PartsFinderShopService } from "../parts-finder/parts-finder-shop.service.js";
import { TecdocBudgetService } from "./tecdoc-budget.service.js";
import { TecdocCacheService } from "./tecdoc-cache.service.js";
import { StaffTecdocController, TecdocController } from "./tecdoc.controller.js";
import { TecdocGateway } from "./tecdoc.gateway.js";
import { TecdocService } from "./tecdoc.service.js";

/**
 * TecDoc (tecdoc.site) as the vehicle and applicability catalogue — see
 * docs/TECDOC.md for what the provider's offer allows and how the request
 * budget works. The shop lookup is our own database query; it holds no state,
 * so this module has its own instance.
 */
@Module({
  controllers: [TecdocController, StaffTecdocController],
  exports: [TecdocService],
  providers: [PartsFinderShopService, TecdocBudgetService, TecdocCacheService, TecdocGateway, TecdocService],
})
export class TecdocModule {}
