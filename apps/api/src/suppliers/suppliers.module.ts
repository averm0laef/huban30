import { Module } from "@nestjs/common";

import {
  StaffSupplierWaitlistController,
  SupplierSearchController,
  SupplierWaitlistController,
} from "./suppliers.controller.js";
import { SupplierSearchService } from "./supplier-search.service.js";
import { SupplierWaitlistService } from "./supplier-waitlist.service.js";

@Module({
  controllers: [StaffSupplierWaitlistController, SupplierSearchController, SupplierWaitlistController],
  providers: [SupplierSearchService, SupplierWaitlistService],
})
export class SuppliersModule {}
