import { Module } from "@nestjs/common";

import {
  CustomerCheckoutController,
  GuestCheckoutController,
  GuestOrdersController,
  OrdersController,
  PaymentsController,
  PaymentWebhooksController,
  SandboxPaymentsController,
} from "./checkout.controller.js";
import { CheckoutService } from "./checkout.service.js";
import { OrderService } from "./order.service.js";
import { PaymentService } from "./payment.service.js";
import { SandboxPaymentProvider } from "./sandbox-payment.provider.js";

@Module({
  controllers: [
    CustomerCheckoutController,
    GuestCheckoutController,
    OrdersController,
    GuestOrdersController,
    PaymentsController,
    SandboxPaymentsController,
    PaymentWebhooksController,
  ],
  providers: [CheckoutService, OrderService, PaymentService, SandboxPaymentProvider],
})
export class CheckoutModule {}
