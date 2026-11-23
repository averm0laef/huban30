import { Module } from "@nestjs/common";

import {
  StaffSupplierCrossFillController,
  StaffSupplierWaitlistController,
  SupplierSearchController,
  SupplierWaitlistController,
} from "./suppliers.controller.js";
import { SupplierCrossFillService } from "./supplier-cross-fill.service.js";
import { SupplierCrossQueueService } from "./supplier-cross-queue.service.js";
import { SupplierSearchService } from "./supplier-search.service.js";
import { SupplierWaitlistService } from "./supplier-waitlist.service.js";

@Module({
  controllers: [StaffSupplierCrossFillController, StaffSupplierWaitlistController, SupplierSearchController, SupplierWaitlistController],
  providers: [SupplierCrossFillService, SupplierCrossQueueService, SupplierSearchService, SupplierWaitlistService],
  // Reused by «Подбор по автомобилю» for "под заказ" offers on an article.
  exports: [SupplierSearchService],
})
export class SuppliersModule {}
