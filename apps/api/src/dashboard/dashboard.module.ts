import { Module } from "@nestjs/common";

import { StaffDashboardController } from "./dashboard.controller.js";
import { StaffDashboardService } from "./dashboard.service.js";

@Module({
  controllers: [StaffDashboardController],
  providers: [StaffDashboardService],
})
export class StaffDashboardModule {}
