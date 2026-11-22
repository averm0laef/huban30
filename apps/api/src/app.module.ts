import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";

import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { AdaptersModule } from "./adapters/adapters.module.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { PermissionsGuard } from "./auth/permissions.guard.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { ChatModule } from "./chat/chat.module.js";
import { ClientHubModule } from "./client-hub/client-hub.module.js";
import { ManagerDispatchModule } from "./dispatch/manager-dispatch.module.js";
import { CheckoutModule } from "./checkout/checkout.module.js";
import { validateEnvironment } from "./config.js";
import { GarageModule } from "./garage/garage.module.js";
import { HealthModule } from "./health/health.module.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { OneCExchangeModule } from "./one-c-exchange/one-c-exchange.module.js";
import { PartsFinderModule } from "./parts-finder/parts-finder.module.js";
import { SecurityModule } from "./security/security.module.js";
import { StaffDashboardModule } from "./dashboard/dashboard.module.js";
import { StaffModule } from "./staff/staff.module.js";
import { StorefrontModule } from "./storefront/storefront.module.js";
import { SuppliersModule } from "./suppliers/suppliers.module.js";
import { TecdocModule } from "./tecdoc/tecdoc.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    InfrastructureModule,
    AdaptersModule,
    SecurityModule,
    AuthModule,
    CatalogModule,
    ChatModule,
    ClientHubModule,
    ManagerDispatchModule,
    CheckoutModule,
    OneCExchangeModule,
    PartsFinderModule,
    StaffModule,
    StaffDashboardModule,
    StorefrontModule,
    SuppliersModule,
    TecdocModule,
    GarageModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
