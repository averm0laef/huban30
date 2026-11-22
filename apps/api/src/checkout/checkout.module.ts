import { Module } from "@nestjs/common";

import {
  CustomerCheckoutController,
  GuestCheckoutController,
  GuestOrdersController,
  OrdersController,
} from "./checkout.controller.js";
import { CheckoutService } from "./checkout.service.js";
import { OrderService } from "./order.service.js";

@Module({
  controllers: [
    CustomerCheckoutController,
    GuestCheckoutController,
    OrdersController,
    GuestOrdersController,
  ],
  providers: [CheckoutService, OrderService],
})
export class CheckoutModule {}
