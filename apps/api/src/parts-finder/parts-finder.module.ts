import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";

import { CatalogSearchLogService } from "../catalog/catalog-search-log.service.js";
import { SuppliersModule } from "../suppliers/suppliers.module.js";
import { TecdocModule } from "../tecdoc/tecdoc.module.js";
import { PartsFinderBodyLimitMiddleware } from "./parts-finder-body-limit.middleware.js";
import { PartsFinderController, StaffPartsFinderController } from "./parts-finder.controller.js";
import { RedisFapiVisitorShares } from "./fapi-visitor-shares.js";
import { PartsFinderEngine } from "./parts-finder.engine.js";
import { PartsFinderService } from "./parts-finder.service.js";
import { PartsFinderAssortmentService } from "./parts-finder-assortment.service.js";
import { PartsFinderCrossReviewService } from "./parts-finder-cross-review.service.js";
import { PartsFinderCrossStore } from "./parts-finder-crosses.store.js";
import { PartsFinderShopService } from "./parts-finder-shop.service.js";
import { PgFapiLedgerStore, PgFitmentStore, PgVehicleStore } from "./parts-finder.stores.js";
import { PartsFinderVehiclesService } from "./parts-finder-vehicles.service.js";
import { VehicleCatalogService } from "./vehicle-catalog.service.js";

@Module({
  imports: [SuppliersModule, TecdocModule],
  controllers: [PartsFinderController, StaffPartsFinderController],
  providers: [
    CatalogSearchLogService,
    PartsFinderAssortmentService,
    PartsFinderCrossReviewService,
    PartsFinderCrossStore,
    PartsFinderEngine,
    PartsFinderService,
    PartsFinderShopService,
    PartsFinderVehiclesService,
    PgFapiLedgerStore,
    PgFitmentStore,
    PgVehicleStore,
    RedisFapiVisitorShares,
    VehicleCatalogService,
  ],
})
export class PartsFinderModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PartsFinderBodyLimitMiddleware).forRoutes(PartsFinderController);
  }
}
