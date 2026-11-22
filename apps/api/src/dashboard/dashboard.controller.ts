import { Controller, Get, Query } from "@nestjs/common";

import { RequirePermissions } from "../auth/auth.decorators.js";
import { StaffDashboardService } from "./dashboard.service.js";

@Controller("staff")
export class StaffDashboardController {
  constructor(private readonly dashboard: StaffDashboardService) {}

  @RequirePermissions("orders:read:any")
  @Get("dashboard")
  read(@Query("range") range?: string) {
    return this.dashboard.dashboard(range);
  }
}
