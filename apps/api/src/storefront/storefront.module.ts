import { Module } from "@nestjs/common";

import { AccountService } from "./account.service.js";
import { PublicStorefrontService } from "./public-storefront.service.js";
import {
  AccountController,
  ContactRequestsController,
  PublicStorefrontController,
} from "./storefront.controller.js";

@Module({
  controllers: [AccountController, ContactRequestsController, PublicStorefrontController],
  providers: [AccountService, PublicStorefrontService],
})
export class StorefrontModule {}
