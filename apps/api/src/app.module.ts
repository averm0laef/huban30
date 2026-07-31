import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";

import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { PermissionsGuard } from "./auth/permissions.guard.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CheckoutModule } from "./checkout/checkout.module.js";
import { validateEnvironment } from "./config.js";
import { HealthModule } from "./health/health.module.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { SecurityModule } from "./security/security.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    InfrastructureModule,
    SecurityModule,
    AuthModule,
    CatalogModule,
    CheckoutModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
